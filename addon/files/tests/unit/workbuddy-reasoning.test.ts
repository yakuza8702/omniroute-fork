/**
 * T5 — WorkBuddy reasoning contract (plan §4 B1-B4, §9 T5).
 *
 * Two things are pinned here, because they fail differently:
 *
 *  - the pure rule (`normalizeWorkBuddyReasoning`): a model that declares no ladder must not
 *    see a reasoning field at all, a tier outside the declared set must be clamped UP (the
 *    platform's floor convention), and an explicit "off" becomes `none` only when the model
 *    accepts `none` — otherwise it degrades to the ladder's floor. Getting any of these
 *    wrong is a 400 from the gateway, not a cosmetic difference;
 *  - the source of the declaration (`resolveWorkBuddyReasoningContract`): a persisted
 *    operator override outranks the synced row (plan §D6/B2), and the single-edition id
 *    mapping never consults another edition's catalogue (plan §D1).
 *
 * B4 (executor map) is asserted here too: the two keys are the only way the executor is ever
 * reached, so a map that lost them would leave every rule above unreachable.
 *
 * Harness: the repo's `node:test` runner
 *   node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts \
 *        --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-reasoning.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.ts";
import { DefaultExecutor } from "../../open-sse/executors/default.ts";
import { WorkBuddyExecutor } from "../../open-sse/executors/workbuddy.ts";
import {
  resetWorkBuddyReasoningContractCache,
  resolveWorkBuddyReasoningContract,
} from "../../open-sse/executors/workbuddyReasoning.ts";
import { replaceSyncedAvailableModelsForConnection } from "@/lib/db/models";
import {
  removeModelCapabilityOverride,
  setModelCapabilityOverride,
} from "@/lib/db/modelCapabilityOverrides";
import { providerToWorkBuddyProviderId } from "@/lib/workbuddy/modelDiscovery";
import { normalizeWorkBuddyReasoning } from "@/lib/workbuddy/upstream";

const ROW_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

/** The body a client sends when it wants the most thinking the model can give. */
function chatBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "gpt-5.6-sol",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    ...extra,
  };
}

describe("normalizeWorkBuddyReasoning — the pure ladder rule", () => {
  it("strips every reasoning field when the model declares no ladder", () => {
    for (const contract of [undefined, null, {}, { supportedEfforts: [] }]) {
      const out = normalizeWorkBuddyReasoning(
        chatBody({ reasoning_effort: "max", thinking: { type: "enabled" } }),
        contract as never
      );
      assert.equal(
        "reasoning_effort" in out,
        false,
        `reasoning_effort leaked for ${String(contract)}`
      );
      assert.equal("thinking" in out, false, `thinking leaked for ${String(contract)}`);
      // Everything the gateway does understand survives untouched.
      assert.equal(out.model, "gpt-5.6-sol");
      assert.deepEqual(out.messages, [{ role: "user", content: "hi" }]);
    }
  });

  it("clamps UP to the nearest declared level and down from above the ceiling", () => {
    const ladder = { supportedEfforts: ["low", "medium", "high"] };
    // Below the floor → the floor (never a level the model does not declare).
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "minimal" }), ladder)
        .reasoning_effort,
      "low"
    );
    // Above the ceiling → the highest declared level, not a dropped field.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "xhigh" }), ladder).reasoning_effort,
      "high"
    );
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "max" }), ladder).reasoning_effort,
      "high"
    );
    // Inside the ladder → the requested level verbatim.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "medium" }), ladder)
        .reasoning_effort,
      "medium"
    );
  });

  it("turns an explicit off into `none` when the model allows it", () => {
    const allowing = { supportedEfforts: ["none", "low", "high"] };
    // `none` in the ladder and no refusal on record ⇒ the default is "it can be disabled".
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ thinking: false }), allowing).reasoning_effort,
      "none"
    );
    // The OpenAI spelling reaches the same branch, and `thinking` is never forwarded.
    const viaEffort = normalizeWorkBuddyReasoning(
      chatBody({ reasoning_effort: "none", thinking: { type: "enabled" } }),
      allowing
    );
    assert.equal(viaEffort.reasoning_effort, "none");
    assert.equal("thinking" in viaEffort, false);
    // An explicit `canDisableThinking: true` on a ladder without `none` cannot invent it —
    // "off" is only spellable when the model declares the word.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ thinking: false }), {
        supportedEfforts: ["low", "high"],
        canDisableThinking: true,
      }).reasoning_effort,
      "low"
    );
  });

  it("degrades an off to the ladder's floor when the model refuses it", () => {
    // The model declares `none` but is known to reject the "off" spelling.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ thinking: false }), {
        supportedEfforts: ["none", "low", "high"],
        refusesOff: true,
      }).reasoning_effort,
      "low"
    );
    // …or does not declare `none` at all.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ thinking: false }), {
        supportedEfforts: ["low", "medium"],
      }).reasoning_effort,
      "low"
    );
    // A row-driven `canDisableThinking: false` is the same refusal by another name.
    assert.equal(
      normalizeWorkBuddyReasoning(chatBody({ thinking: false }), {
        supportedEfforts: ["none", "low"],
        canDisableThinking: false,
      }).reasoning_effort,
      "low"
    );
  });

  it("drops a request that names no level and one that names an unknown word", () => {
    const ladder = { supportedEfforts: ["low", "high"] };
    // `thinking: {type: "enabled"}` says "think", not "think this hard" — no level invented.
    assert.equal(
      "reasoning_effort" in
        normalizeWorkBuddyReasoning(chatBody({ thinking: { type: "enabled" } }), ladder),
      false
    );
    // An unknown word answers a request this gateway has no name for: drop, do not clamp.
    assert.equal(
      "reasoning_effort" in
        normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "banana" }), ladder),
      false
    );
  });
});

describe("resolveWorkBuddyReasoningContract — where the declaration comes from", () => {
  it("override-first: a persisted effort override outranks the synced row", async () => {
    await replaceSyncedAvailableModelsForConnection("workbuddy", "conn-t5", [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        source: "api-sync",
        supportedThinkingEfforts: [...ROW_LADDER],
      },
    ]);
    resetWorkBuddyReasoningContractCache();

    const fromRow = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "gpt-5.6-sol",
      connectionId: "conn-t5",
    });
    assert.deepEqual(fromRow?.supportedEfforts, [...ROW_LADDER]);

    // The operator narrows the ladder through the capability API (§D7's storage path).
    assert.equal(
      setModelCapabilityOverride("workbuddy/gpt-5.6-sol", "reasoning_efforts", "low,high"),
      true
    );

    // No cache reset between the two reads: the override is read BEFORE the cached rows, so
    // the very next request already sees it (the 15 s row cache cannot hide it).
    const overridden = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "gpt-5.6-sol",
      connectionId: "conn-t5",
    });
    assert.deepEqual(overridden?.supportedEfforts, ["low", "high"]);

    // …and the wire obeys the override, not the row: `max` on a `low,high` model clamps.
    const shaped = normalizeWorkBuddyReasoning(chatBody({ reasoning_effort: "max" }), overridden);
    assert.equal(shaped.reasoning_effort, "high");

    // Erasing the override returns the row's declaration.
    assert.equal(removeModelCapabilityOverride("workbuddy/gpt-5.6-sol", "reasoning_efforts"), true);
    resetWorkBuddyReasoningContractCache();
    const backToRow = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "gpt-5.6-sol",
      connectionId: "conn-t5",
    });
    assert.deepEqual(backToRow?.supportedEfforts, [...ROW_LADDER]);
  });

  it("uses a pre-loaded bulk override map without another query", async () => {
    // No persisted override exists for this id; only the caller's snapshot says anything.
    const bulk = new Map<string, Map<string, readonly string[]>>([
      ["workbuddy", new Map([["bulk-only-model", ["medium", "high"]]])],
    ]);
    const contract = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "bulk-only-model",
      bulkEffortOverrides: bulk as never,
    });
    assert.deepEqual(contract?.supportedEfforts, ["medium", "high"]);
  });

  it("prefers the request's own connection, then a sibling's row", async () => {
    await replaceSyncedAvailableModelsForConnection("workbuddy", "conn-t5-a", [
      {
        id: "conn-scoped",
        name: "Conn Scoped",
        source: "api-sync",
        supportedThinkingEfforts: ["low"],
      },
    ]);
    await replaceSyncedAvailableModelsForConnection("workbuddy", "conn-t5-b", [
      {
        id: "conn-scoped",
        name: "Conn Scoped",
        source: "api-sync",
        supportedThinkingEfforts: ["high", "max"],
      },
    ]);
    resetWorkBuddyReasoningContractCache();

    const own = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "conn-scoped",
      connectionId: "conn-t5-b",
    });
    assert.deepEqual(own?.supportedEfforts, ["high", "max"]);

    // A different account still finds the model — but through its own row first.
    const sibling = await resolveWorkBuddyReasoningContract({
      provider: "workbuddy",
      model: "conn-scoped",
      connectionId: "conn-t5-a",
    });
    assert.deepEqual(sibling?.supportedEfforts, ["low"]);
  });

  it("folds the `-<tier>` suffix onto the base model and maps ids single-edition", async () => {
    const suffixed = await resolveWorkBuddyReasoningContract({
      provider: "wb",
      model: "gpt-5.6-sol-high",
      connectionId: "conn-t5",
    });
    assert.deepEqual(suffixed?.supportedEfforts, [...ROW_LADDER]);

    // D1: `workbuddy` is the single edition; the fork's second id has no branch here.
    assert.equal(providerToWorkBuddyProviderId("workbuddy"), "workbuddy");
    assert.equal(providerToWorkBuddyProviderId("wb"), "workbuddy");
    assert.equal(providerToWorkBuddyProviderId("workbuddy-global"), null);
    assert.equal(providerToWorkBuddyProviderId("wbg"), null);
    assert.equal(providerToWorkBuddyProviderId("openai"), null);

    // A provider outside the addon declares nothing, even for a model this catalogue knows.
    const other = await resolveWorkBuddyReasoningContract({
      provider: "openai",
      model: "gpt-5.6-sol",
      connectionId: "conn-t5",
    });
    assert.equal(other, undefined);
  });
});

describe("WorkBuddyExecutor — B3/B4 wiring", () => {
  it("is reachable through both map keys as its own instance", async () => {
    assert.equal(hasSpecializedExecutor("workbuddy"), true);
    assert.equal(hasSpecializedExecutor("wb"), true);

    const canonical = await getExecutor("workbuddy");
    const alias = await getExecutor("wb");
    assert.ok(canonical instanceof WorkBuddyExecutor);
    assert.ok(alias instanceof WorkBuddyExecutor);
    assert.ok(canonical instanceof DefaultExecutor);
    // Aliases never share an instance in this map (executor golden contract).
    assert.notEqual(canonical, alias);
    // Both keys carry the CANONICAL provider identity: the registry entry (baseUrl,
    // forceStream) and the synced catalogue are keyed by it, so an alias that reported `wb`
    // would resolve neither. The alias key exists for routing only.
    assert.equal(canonical.getProvider(), "workbuddy");
    assert.equal(alias.getProvider(), "workbuddy");
  });

  it("shapes the wire body through the resolved contract", async () => {
    // Its OWN connection and ladder, so this test stands alone (no ordering with the
    // override-first case above).
    await replaceSyncedAvailableModelsForConnection("workbuddy", "conn-t5-wire", [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        source: "api-sync",
        supportedThinkingEfforts: ["low", "medium"],
      },
    ]);
    resetWorkBuddyReasoningContractCache();

    const executor = new WorkBuddyExecutor();
    const out = (await executor.transformRequest(
      "gpt-5.6-sol",
      chatBody({ reasoning_effort: "max", thinking: { type: "enabled" } }),
      true,
      { accessToken: "test-token", connectionId: "conn-t5-wire" }
    )) as Record<string, unknown>;
    // The row's ceiling is `medium`, so a client asking for `max` gets `medium` — the value
    // on the wire is a declared level, and `thinking` never reaches an OpenAI-format body.
    assert.equal(out.reasoning_effort, "medium");
    assert.equal("thinking" in out, false);
  });

  it("leaves the body alone when the addon is switched off (D9)", async () => {
    const previous = process.env.WORKBUDDY_ADDON;
    process.env.WORKBUDDY_ADDON = "0";
    try {
      const executor = new WorkBuddyExecutor();
      const body = chatBody({ reasoning_effort: "not-a-level" });
      const out = (await executor.transformRequest("gpt-5.6-sol", body, true, {
        accessToken: "test-token",
      })) as Record<string, unknown>;
      // No ladder applied: the gate leaves whatever the base class produced untouched.
      assert.equal(out.reasoning_effort, "not-a-level");
    } finally {
      if (previous === undefined) delete process.env.WORKBUDDY_ADDON;
      else process.env.WORKBUDDY_ADDON = previous;
    }
  });
});
