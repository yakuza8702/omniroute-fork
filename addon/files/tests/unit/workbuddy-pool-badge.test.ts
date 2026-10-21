/**
 * T8 — the credit badge's promotion rule (wave 4).
 *
 * `WorkBuddyPoolCreditBadge` first paint is `?detail=fast`, a snapshot-only read. A connection
 * row that has never been probed answers `pending: true` / `status: "unknown"`, and a badge that
 * stopped there sat at "Credits unknown" forever while the full probe the route already serves
 * was never requested. The rule below is the fix's only decision: given a fast body, probe once
 * more or not?
 *
 * It is pinned in isolation because it is the whole behaviour: the component's fetch, its
 * single-promotion memo and its in-flight guard exist to run this predicate at most once per
 * connection. The cases that must NOT promote are the ones that would turn a display bug into a
 * billing-call loop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { needsWorkBuddyFullCreditProbe } from "@/shared/utils/workBuddyCreditProbe";

describe("needsWorkBuddyFullCreditProbe — when a fast body earns one full probe", () => {
  it("promotes when the edition reports pending accounts (`pending: 1`)", () => {
    assert.equal(needsWorkBuddyFullCreditProbe({ editions: [{ pending: 1, accounts: [] }] }), true);
  });

  it("promotes when any account status is `unknown`", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({
        editions: [{ pending: 0, accounts: [{ status: "ok", total: 12 }, { status: "unknown" }] }],
      }),
      true
    );
  });

  it("promotes when a row carries no status at all", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({ editions: [{ accounts: [{ cid: "c1" }] }] }),
      true
    );
  });

  it("promotes on any edition, not only the first", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({
        editions: [{ accounts: [{ status: "ok", total: 400 }] }, { pending: 1, accounts: [] }],
      }),
      true
    );
  });

  it("does not promote once a verdict exists — an `ok` balance", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({
        editions: [{ pending: 0, accounts: [{ status: "ok", total: 400 }] }],
      }),
      false
    );
  });

  it("does not promote an explicit error or an excluded account", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({
        editions: [
          {
            accounts: [
              { status: "error", error: "billing read failed" },
              { status: "excluded", excludedBy: "policy" },
            ],
          },
        ],
      }),
      false
    );
  });

  it("does not promote an edition with no rows, nor an empty body", () => {
    assert.equal(
      needsWorkBuddyFullCreditProbe({ editions: [{ pending: 0, accounts: [] }] }),
      false
    );
    assert.equal(needsWorkBuddyFullCreditProbe({ editions: [] }), false);
    assert.equal(needsWorkBuddyFullCreditProbe({}), false);
    assert.equal(needsWorkBuddyFullCreditProbe(null), false);
    assert.equal(needsWorkBuddyFullCreditProbe(undefined), false);
  });
});
