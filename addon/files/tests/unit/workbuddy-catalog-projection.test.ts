/**
 * T7 — preview projection carries the credit rate (plan §9 T7, §A6).
 *
 * `toDiscoveryCatalogModel` whitelists fields. Without `creditMultiplier` and `isFree` on that
 * whitelist, a synced WorkBuddy row that stores a rate reaches the dashboard's model preview
 * with no rate at all — the badge disappears even though the data is present. This test pins the
 * two fields, and pins that they stay ABSENT when the row has no claim: an `isFree: false`
 * written into every non-free row would be a fabricated "this bills" statement for providers
 * that simply said nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toDiscoveryCatalogModel } from "@/app/api/providers/[id]/models/discovery/catalogModels";

describe("workbuddy catalogue projection — credit fields", () => {
  it("carries the declared rate and the free verdict", () => {
    const projected = toDiscoveryCatalogModel({
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      creditMultiplier: 0,
      isFree: true,
    });

    assert.equal(projected.id, "gpt-5.6-sol");
    assert.equal(projected.creditMultiplier, 0);
    assert.equal(projected.isFree, true);
  });

  it("carries a paid rate without inventing a free verdict", () => {
    const projected = toDiscoveryCatalogModel({
      id: "gpt-5.6-pro",
      creditMultiplier: 0.03,
      isFree: false,
    });

    assert.equal(projected.creditMultiplier, 0.03);
    assert.equal("isFree" in projected, false, "an explicit false must not be projected");
  });

  it("omits both fields for a row with no declared rate", () => {
    const projected = toDiscoveryCatalogModel({ id: "mystery-model" });

    assert.equal("creditMultiplier" in projected, false);
    assert.equal("isFree" in projected, false);
  });

  it("keeps the pre-existing projection untouched", () => {
    const projected = toDiscoveryCatalogModel(
      {
        id: "claude-x",
        name: "Claude X",
        apiFormat: "anthropic",
        supportedEndpoints: ["chat"],
        endpointCapabilitySource: "declared",
        supportsVision: false,
      },
      "anthropic"
    );

    assert.deepEqual(projected, {
      id: "claude-x",
      name: "Claude X",
      apiFormat: "anthropic",
      supportedEndpoints: ["chat"],
      endpointCapabilitySource: "declared",
      supportsVision: false,
      owned_by: "anthropic",
    });
  });
});
