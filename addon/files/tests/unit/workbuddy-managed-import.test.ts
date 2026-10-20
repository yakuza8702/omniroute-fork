/**
 * T3 — managed import / sync projection (plan §3 A0, §9 T3).
 *
 * The enrichment only matters if it survives `normalizeDiscoveredModels`, the function that
 * rebuilds every synced row field by field — anything it does not copy is gone before the
 * catalog sees it. This test walks the real entry the discovery route uses
 * (`PROVIDER_MODELS_CONFIG.workbuddy.parseResponse`) and pins what the synced row carries,
 * then round-trips that row through JSON to prove a restart does not erase it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/discovery/providerModelsConfig";
import { normalizeSyncedAvailableModels } from "@/lib/db/models/synced";
import { normalizeDiscoveredModels } from "@/lib/providerModels/modelDiscovery";

/** A `/v3/config` answer for one account: one paid flagship, one free model. */
const DISCOVERY_PAYLOAD = {
  code: 0,
  msg: "OK",
  requestId: "8f5e0f38-2a58-4c0b-9d9b-000000000000",
  data: {
    agent: {},
    models: [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        maxInputTokens: 1_000_000,
        maxOutputTokens: 64_000,
        supportsToolCall: true,
        supportsImages: true,
        credits: "x0.03 credits",
        descriptionZh: "旗舰推理模型",
        reasoning: {
          supportedEfforts: ["low", "medium", "high"],
          defaultEffort: "medium",
          canDisableThinking: true,
        },
      },
      {
        id: "hy4-preview",
        name: "HY4 Preview",
        maxInputTokens: 262_144,
        maxOutputTokens: 32_768,
        credits: "x0.00 credits",
      },
    ],
    features: null,
  },
};

describe("workbuddy managed model import", () => {
  it("projects the enrichment into the synced row", () => {
    const records = PROVIDER_MODELS_CONFIG.workbuddy.parseResponse(DISCOVERY_PAYLOAD);
    const rows = normalizeDiscoveredModels(records, "workbuddy");
    const byId = new Map(rows.map((row) => [row.id, row]));

    const paid = byId.get("gpt-5.6-sol");
    assert.ok(paid);
    assert.equal(paid.inputTokenLimit, 1_000_000);
    assert.equal(paid.outputTokenLimit, 64_000);
    assert.deepEqual(paid.supportedThinkingEfforts, ["low", "medium", "high"]);
    assert.equal(paid.defaultThinkingEffort, "medium");
    assert.equal(paid.supportsThinking, true);
    assert.equal(paid.supportsTools, true);
    assert.equal(paid.supportsVision, true);
    assert.equal(paid.creditMultiplier, 0.03);
    // The discovery row never claims `isFree: true` for a paid rate (upstream only writes a
    // POSITIVE free verdict); the read path derives the false verdict from the rate itself,
    // which the round-trip test below asserts.
    assert.notEqual(paid.isFree, true);
    assert.equal(paid.description, "旗舰推理模型");

    const free = byId.get("hy4-preview");
    assert.ok(free);
    assert.equal(free.inputTokenLimit, 262_144);
    assert.equal(free.outputTokenLimit, 32_768);
    assert.equal(free.creditMultiplier, 0);
    assert.equal(free.isFree, true);
  });

  it("round-trips the rate through JSON and the synced read path", () => {
    const rows = normalizeDiscoveredModels(
      PROVIDER_MODELS_CONFIG.workbuddy.parseResponse(DISCOVERY_PAYLOAD),
      "workbuddy"
    );

    // The synced store is a JSON blob in `key_value`: what a restart hands back is the
    // serialized row, so the read path is asserted on exactly that.
    const restored = normalizeSyncedAvailableModels(JSON.parse(JSON.stringify(rows)), "workbuddy");
    const byId = new Map(restored.map((row) => [row.id, row]));

    assert.equal(byId.get("gpt-5.6-sol")?.creditMultiplier, 0.03);
    assert.equal(byId.get("gpt-5.6-sol")?.isFree, false, "a paid rate reads back as not-free");
    assert.equal(byId.get("gpt-5.6-sol")?.inputTokenLimit, 1_000_000);
    assert.equal(byId.get("hy4-preview")?.creditMultiplier, 0);
    assert.equal(byId.get("hy4-preview")?.isFree, true);
  });

  it("carries the desktop user agent on the catalogue read", () => {
    // The roster the gateway answers is selected by this product token; without the
    // desktop channel the free x0.00 tier is missing (plan §A2 / risk R5).
    assert.equal(PROVIDER_MODELS_CONFIG.workbuddy.headers["user-agent"], "WorkBuddy/5.5.2");
  });
});
