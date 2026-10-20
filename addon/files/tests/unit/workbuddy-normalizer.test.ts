/**
 * T2 — WorkBuddy catalogue enrichment (plan §3 A3, §9 T2).
 *
 * The 200k fallback the port exists to kill only disappears when the ENRICHED record
 * survives the whole path, so this file pins the record the normalizer emits (snapshot),
 * the two parses (strict drops a limit-less entry, loose keeps it), and the media
 * exclusion. The managed-import projection is T3, the rate precedence T4.
 *
 * Harness: the repo's `node:test` runner
 *   node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts \
 *        --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-*.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeWorkbuddyModelsResponse } from "@/app/api/providers/[id]/models/discovery/normalizers";
import { normalizeDiscoveredModels } from "@/lib/providerModels/modelDiscovery";
import { parseWorkBuddyModel, parseWorkBuddyModelLoose } from "@/lib/workbuddy/upstream";

/** One full catalogue entry, in the shape `/v3/config` answers with. */
const FULL_ENTRY = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  maxInputTokens: 1_000_000,
  maxOutputTokens: 65_536,
  supportsToolCall: true,
  supportsImages: true,
  credits: "x0.03 credits",
  descriptionEn: "Flagship reasoning model for agentic work.",
  tags: ["craft"],
  reasoning: {
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
};

describe("workbuddy catalogue enrichment", () => {
  it("emits the enriched discovery record (snapshot)", () => {
    const records = normalizeWorkbuddyModelsResponse({
      code: 0,
      msg: "OK",
      data: { models: [FULL_ENTRY] },
    });

    assert.deepEqual(records, [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        owned_by: "workbuddy",
        context_length: 1_000_000,
        max_input_tokens: 1_000_000,
        max_output_tokens: 65_536,
        supportsVision: true,
        supportsTools: true,
        supportsThinking: true,
        supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
        defaultThinkingEffort: "medium",
        creditMultiplier: 0.03,
        isFree: false,
        description: "Flagship reasoning model for agentic work.",
        tags: ["craft"],
      },
    ]);
  });

  it("keeps the 1M window and the 64k output ceiling", () => {
    const [record] = normalizeWorkbuddyModelsResponse({
      data: { models: [{ id: "m", maxInputTokens: 1_000_000, maxOutputTokens: 64_000 }] },
    });

    assert.equal(record.context_length, 1_000_000);
    assert.equal(record.max_input_tokens, 1_000_000);
    assert.equal(record.max_output_tokens, 64_000);
  });

  it("documents the explicit-false vision asymmetry", () => {
    // A catalogue entry that says `supportsImages: false` is a CLAIM (that is why the
    // record carries it) while the synced row only ever stores a positive vision flag —
    // upstream normalizes vision as evidence, not as a tri-state. Both halves are asserted
    // here so a future change to either side is visible.
    const [record] = normalizeWorkbuddyModelsResponse({
      data: {
        models: [
          {
            id: "text-only",
            maxInputTokens: 128_000,
            maxOutputTokens: 8_192,
            supportsImages: false,
          },
        ],
      },
    });
    assert.equal(record.supportsVision, false);

    const [row] = normalizeDiscoveredModels([record], "workbuddy");
    assert.equal(row.supportsVision, undefined);
  });

  it("drops media-generation entries and entries without an id", () => {
    const records = normalizeWorkbuddyModelsResponse({
      data: {
        models: [
          { id: "keep-me", maxInputTokens: 128_000, maxOutputTokens: 8_192 },
          { id: "gemini-3.0-pro-image", tags: ["text-to-image"] },
          { id: "hunyuan-image-v3.0", tags: ["text-to-image", "image-to-image"] },
          { name: "no-id-anywhere" },
        ],
      },
    });

    assert.deepEqual(
      records.map((record) => record.id),
      ["keep-me"]
    );
  });

  it("loose parse keeps a limit-less id, strict parse drops it", () => {
    const limitLess = {
      id: "mystery-model",
      name: "Mystery",
      supportsToolCall: true,
      credits: "x0.00",
    };

    assert.equal(parseWorkBuddyModel(limitLess), undefined);

    const loose = parseWorkBuddyModelLoose(limitLess);
    assert.ok(loose, "loose parse must keep an entry whose limits are absent");
    assert.equal(loose.id, "mystery-model");
    assert.equal(loose.contextLength, 0);
    assert.equal(loose.maxOutputTokens, 0);
    assert.equal(loose.creditMultiplier, 0);
    assert.equal(loose.supportsToolCall, true);

    // And through the normalizer: the id survives, but no window is claimed, so the
    // catalog's existing default-window fallback still applies (R8).
    const [record] = normalizeWorkbuddyModelsResponse({
      data: { models: [limitLess] },
    });
    assert.equal(record.id, "mystery-model");
    assert.equal(record.context_length, undefined);
    assert.equal(record.max_output_tokens, undefined);
    assert.equal(record.isFree, true);
  });

  it("still drops a server-disabled entry", () => {
    assert.equal(parseWorkBuddyModelLoose({ id: "off", disabled: true }), undefined);
  });

  it("accepts an object map, using the key as the id", () => {
    const records = normalizeWorkbuddyModelsResponse({
      data: { models: { "deepseek-v4.1-flash": { name: "DeepSeek V4.1 Flash" } } },
    });

    assert.deepEqual(records, [
      { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", owned_by: "workbuddy" },
    ]);
  });
});
