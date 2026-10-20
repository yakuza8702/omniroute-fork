/**
 * T1 — credit-rate surface (plan §9 T1).
 *
 * The pure rules the whole credits feature rests on, pinned where they cannot be confused with
 * the UI that renders them:
 *
 *  - tier: `0` is the ONLY free value; a positive rate is paid; absent, negative, NaN and
 *    Infinity are UNKNOWN (missing evidence, never a discount);
 *  - caption: `"free (0.00x)"` / `"paid (0.03x)"` / `null` — and `null` means "render nothing",
 *    because a badge is read as a price claim;
 *  - id gate: canonical ids and the short aliases are the addon's, bare region words are not.
 *
 * Harness: `node --import tsx/esm --import ./tests/_setup/isolateDataDir.ts --test
 * tests/unit/workbuddy-credit.test.ts`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  declaredWorkBuddyCreditMultiplier,
  formatWorkBuddyCreditBadge,
  isWorkBuddyProviderId,
  workBuddyPriceTier,
} from "@/shared/utils/workBuddyCredit";

describe("workbuddy credit — price tier", () => {
  it("treats exactly 0 as free", () => {
    assert.equal(workBuddyPriceTier(0), "free");
  });

  it("treats any positive rate as paid", () => {
    assert.equal(workBuddyPriceTier(0.03), "paid");
    assert.equal(workBuddyPriceTier(3), "paid");
  });

  it("treats absent, negative and non-finite rates as unknown", () => {
    assert.equal(workBuddyPriceTier(undefined), "unknown");
    assert.equal(workBuddyPriceTier(null), "unknown");
    assert.equal(workBuddyPriceTier(-0.5), "unknown");
    assert.equal(workBuddyPriceTier(Number.NaN), "unknown");
    assert.equal(workBuddyPriceTier(Number.POSITIVE_INFINITY), "unknown");
  });
});

describe("workbuddy credit — badge caption", () => {
  it("formats a free rate with two decimals", () => {
    assert.equal(formatWorkBuddyCreditBadge(0), "free (0.00x)");
  });

  it("formats a paid rate with two decimals", () => {
    assert.equal(formatWorkBuddyCreditBadge(0.03), "paid (0.03x)");
    assert.equal(formatWorkBuddyCreditBadge(0.5), "paid (0.50x)");
  });

  it("renders nothing when the rate is unknown", () => {
    assert.equal(formatWorkBuddyCreditBadge(undefined), null);
    assert.equal(formatWorkBuddyCreditBadge(null), null);
    assert.equal(formatWorkBuddyCreditBadge(Number.NaN), null);
    assert.equal(formatWorkBuddyCreditBadge(-1), null);
  });
});

describe("workbuddy credit — declared rate reader", () => {
  it("reads a finite non-negative number off a row", () => {
    assert.equal(declaredWorkBuddyCreditMultiplier({ creditMultiplier: 0 }), 0);
    assert.equal(declaredWorkBuddyCreditMultiplier({ creditMultiplier: 0.79 }), 0.79);
  });

  it("drops malformed values instead of guessing", () => {
    assert.equal(declaredWorkBuddyCreditMultiplier({}), undefined);
    assert.equal(declaredWorkBuddyCreditMultiplier(null), undefined);
    assert.equal(declaredWorkBuddyCreditMultiplier("0.03"), undefined);
    assert.equal(declaredWorkBuddyCreditMultiplier({ creditMultiplier: -2 }), undefined);
    assert.equal(declaredWorkBuddyCreditMultiplier({ creditMultiplier: Number.NaN }), undefined);
  });
});

describe("workbuddy credit — provider id gate", () => {
  it("accepts the canonical id, the alias and any edition spelling", () => {
    for (const id of ["workbuddy", "wb", "wbg", "workbuddy-global", "WorkBuddy", " WB "]) {
      assert.equal(isWorkBuddyProviderId(id), true, `${id} should be accepted`);
    }
  });

  it("rejects bare region words and other providers", () => {
    for (const id of ["cn", "global", "openai", "wbx", "", null, undefined]) {
      assert.equal(isWorkBuddyProviderId(id), false, `${String(id)} should be rejected`);
    }
  });
});
