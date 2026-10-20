/**
 * T4 — credit-rate precedence round trip (plan §3 A4/A5, §8).
 *
 * One rule, asserted at both layers that implement it:
 *
 *   - `normalizeDiscoveredModels` (write path): an explicit rate decides `isFree`; without
 *     a rate the payload's own free evidence stands.
 *   - `normalizeSyncedAvailableModels` (read path): the rate is re-read on every load, so a
 *     restart cannot erase the verdict — and the legacy `isFree` bit of other providers is
 *     left exactly as it was.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSyncedAvailableModels } from "@/lib/db/models/synced";
import { normalizeDiscoveredModels } from "@/lib/providerModels/modelDiscovery";

/** One discovery record, as the WorkBuddy normalizer emits it. */
function record(extra: Record<string, unknown>) {
  return { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", owned_by: "workbuddy", ...extra };
}

describe("workbuddy synced credit precedence", () => {
  it("lets an explicit positive rate beat payload free evidence", () => {
    const [row] = normalizeDiscoveredModels(
      [record({ creditMultiplier: 0.03, isFree: true })],
      "workbuddy"
    );

    assert.equal(row.creditMultiplier, 0.03);
    assert.notEqual(row.isFree, true, "a paid rate must override an optimistic free flag");

    // The false verdict is materialized by the read path, not by the discovery row: upstream
    // only ever writes a POSITIVE free verdict into a synced row.
    const [restored] = normalizeSyncedAvailableModels(
      JSON.parse(JSON.stringify([row])),
      "workbuddy"
    );
    assert.equal(restored.isFree, false);
    assert.equal(restored.creditMultiplier, 0.03);
  });

  it("derives free from a zero rate", () => {
    const [row] = normalizeDiscoveredModels([record({ creditMultiplier: 0 })], "workbuddy");

    assert.equal(row.creditMultiplier, 0);
    assert.equal(row.isFree, true);
  });

  it("keeps the legacy bit when the payload declares no rate", () => {
    const [freeRow] = normalizeDiscoveredModels([record({ isFree: true })], "workbuddy");
    assert.equal(freeRow.creditMultiplier, undefined);
    assert.equal(freeRow.isFree, true);

    const [unknownRow] = normalizeDiscoveredModels([record({})], "workbuddy");
    assert.equal(unknownRow.creditMultiplier, undefined);
    assert.equal(unknownRow.isFree, undefined, "no rate and no evidence is unknown, not free");
  });

  it("round-trips rate and verdict through JSON", () => {
    const rows = normalizeDiscoveredModels(
      [
        record({ id: "paid", creditMultiplier: 0.03, isFree: true }),
        record({ id: "free", creditMultiplier: 0 }),
        record({ id: "legacy-free", isFree: true }),
        record({ id: "unknown" }),
      ],
      "workbuddy"
    );

    const restored = normalizeSyncedAvailableModels(JSON.parse(JSON.stringify(rows)), "workbuddy");
    const byId = new Map(restored.map((row) => [row.id, row]));

    // §8: write 0.03 → { isFree: false }; write 0 → { isFree: true }; write nothing → untouched.
    assert.equal(byId.get("paid")?.creditMultiplier, 0.03);
    assert.equal(byId.get("paid")?.isFree, false);
    assert.equal(byId.get("free")?.creditMultiplier, 0);
    assert.equal(byId.get("free")?.isFree, true);
    assert.equal(byId.get("legacy-free")?.creditMultiplier, undefined);
    assert.equal(byId.get("legacy-free")?.isFree, true);
    assert.equal(byId.get("unknown")?.creditMultiplier, undefined);
    assert.equal(byId.get("unknown")?.isFree, undefined);
  });

  it("drops a rate that does not parse instead of keeping an unsupported free claim", () => {
    const [row] = normalizeSyncedAvailableModels(
      [{ id: "bogus", name: "Bogus", creditMultiplier: -1, isFree: true }],
      "workbuddy"
    );

    assert.equal(row.creditMultiplier, undefined);
    assert.equal(row.isFree, undefined, "a claimed-but-unparsable rate forfeits the free bit");
  });

  it("preserves an explicit paid verdict for other providers", () => {
    // Upstream stores `isFree: false` for a provider whose payload carried paid evidence;
    // the read path must not launder that into "unknown".
    const [row] = normalizeSyncedAvailableModels(
      [{ id: "paid-elsewhere", name: "Paid", isFree: false }],
      "siliconflow"
    );

    assert.equal(row.isFree, false);
    assert.equal(row.creditMultiplier, undefined);
  });
});
