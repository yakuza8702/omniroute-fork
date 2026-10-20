/**
 * T6 — pooled credit engine (plan §9 T6, §C3/C4).
 *
 * Three properties the Provider Quota row and the pool table depend on, each asserted with a
 * counter rather than by inspection:
 *
 *  1. **TTL reuse** — a second `full` probe inside the 10-minute window makes no upstream read;
 *  2. **`detail: "fast"` never fetches** — it answers from the snapshot or says `unknown`, so a
 *     dashboard first paint costs zero billing calls;
 *  3. **`Promise.allSettled` isolation** — one dead token produces an `auth_rejected` row while
 *     its sibling is still read and reported.
 *
 * The engine takes its two I/O calls through `deps` (see `WorkBuddyPoolProbeDeps`): the harness
 * has no provider rows, so the test injects a connection list and a credit reader. Production
 * never passes them.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS,
  diagnoseWorkBuddyFailure,
  probeWorkBuddyPoolCredits,
  resetWorkBuddyQuotaSnapshots,
  selectWorkBuddyQuotaAccount,
  type WorkBuddyPoolProbeDeps,
} from "@/lib/workbuddy/poolQuota";

const NOW = 1_700_000_000_000;

function connection(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    provider: "workbuddy",
    displayName: `Account ${id}`,
    accessToken: `token-${id}`,
    isActive: 1,
    ...extra,
  };
}

function credits(total: number) {
  return {
    total,
    packages: [
      {
        packageName: `${total}-unit refill`,
        remain: total,
        size: total,
        monthly: true,
      },
    ],
    expiringSoon: 0,
    nearestExpiryMs: NOW + 86_400_000,
  };
}

function depsFor(
  rows: Array<Record<string, unknown>>,
  read: WorkBuddyPoolProbeDeps["readCredits"]
): { deps: WorkBuddyPoolProbeDeps; calls: () => number } {
  let calls = 0;
  return {
    deps: {
      listConnections: async () => rows,
      readCredits: async (credential) => {
        calls += 1;
        return read!(credential);
      },
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  resetWorkBuddyQuotaSnapshots();
});

describe("workbuddy pool quota — snapshot semantics", () => {
  it("reuses a reading inside the TTL instead of re-reading the billing endpoint", async () => {
    const { deps, calls } = depsFor([connection("c1")], async () => credits(42));
    const base = { now: () => NOW, deps };

    const first = await probeWorkBuddyPoolCredits("workbuddy", { ...base, detail: "full" });
    assert.equal(calls(), 1);
    assert.equal(first.editions[0].accounts[0].total, 42);
    assert.equal(first.editions[0].accounts[0].cached, false);

    const second = await probeWorkBuddyPoolCredits("workbuddy", {
      ...base,
      detail: "full",
      now: () => NOW + WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS - 1,
    });
    assert.equal(calls(), 1, "a warm snapshot must not cost a second upstream read");
    assert.equal(second.editions[0].accounts[0].total, 42);
    assert.equal(second.editions[0].accounts[0].cached, true);
    assert.equal(second.editions[0].cached, true);
  });

  it("re-reads once the snapshot is older than the TTL", async () => {
    const { deps, calls } = depsFor([connection("c1")], async () => credits(7));
    await probeWorkBuddyPoolCredits("workbuddy", { now: () => NOW, deps });
    await probeWorkBuddyPoolCredits("workbuddy", {
      now: () => NOW + WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS + 1,
      deps,
    });
    assert.equal(calls(), 2);
  });

  it("`refresh: true` bypasses a warm snapshot", async () => {
    const { deps, calls } = depsFor([connection("c1")], async () => credits(1));
    await probeWorkBuddyPoolCredits("workbuddy", { now: () => NOW, deps });
    await probeWorkBuddyPoolCredits("workbuddy", { now: () => NOW, deps, refresh: true });
    assert.equal(calls(), 2);
  });

  it("`detail: fast` never touches the network", async () => {
    const { deps, calls } = depsFor([connection("c1")], async () => credits(99));
    const report = await probeWorkBuddyPoolCredits("workbuddy", {
      now: () => NOW,
      deps,
      detail: "fast",
    });

    assert.equal(calls(), 0, "a snapshot-only read must not issue an upstream call");
    assert.equal(report.detail, "fast");
    assert.equal(report.editions[0].cached, true);
    assert.equal(report.editions[0].unknown, 1);
    const [account] = report.editions[0].accounts;
    assert.equal(account.status, "unknown");
    assert.equal(account.total, null, "an unread balance is null, never 0");
  });

  it("`detail: fast` answers from a snapshot warmed by a full read", async () => {
    const { deps, calls } = depsFor([connection("c1")], async () => credits(12));
    await probeWorkBuddyPoolCredits("workbuddy", { now: () => NOW, deps });
    const fast = await probeWorkBuddyPoolCredits("workbuddy", {
      now: () => NOW + 1_000,
      deps,
      detail: "fast",
    });
    assert.equal(calls(), 1);
    assert.equal(fast.editions[0].accounts[0].status, "ok");
    assert.equal(fast.editions[0].accounts[0].total, 12);
    assert.equal(fast.editions[0].unknown, 0);
  });
});

describe("workbuddy pool quota — per-account isolation", () => {
  it("reports a dead token as auth_rejected without blanking its sibling", async () => {
    const rows = [connection("dead"), connection("alive")];
    const { deps } = depsFor(rows, async (credential) => {
      if (credential.accessToken === "token-dead") {
        const error = new Error("WorkBuddy credit query failed (http 401)") as Error & {
          status?: number;
        };
        error.status = 401;
        throw error;
      }
      return credits(5);
    });

    const report = await probeWorkBuddyPoolCredits("workbuddy", { now: () => NOW, deps });
    const [dead, alive] = report.editions[0].accounts;

    assert.equal(dead.status, "error");
    assert.equal(dead.diagnosis, "auth_rejected");
    assert.equal(dead.total, null);

    assert.equal(alive.status, "ok");
    assert.equal(alive.total, 5);
  });

  it("classifies quota refusals apart from dead credentials", () => {
    const quota = Object.assign(new Error("http 429"), { status: 429 });
    const refused = Object.assign(new Error("balance exhausted"), { status: 402 });
    assert.equal(diagnoseWorkBuddyFailure(quota), "quota_refused");
    assert.equal(diagnoseWorkBuddyFailure(refused), "quota_refused");
    assert.equal(diagnoseWorkBuddyFailure(new Error("socket hang up")), "upstream_error");
  });

  it("lists an excluded account without spending a read on it", async () => {
    const rows = [connection("parked"), connection("live")];
    const { deps, calls } = depsFor(rows, async () => credits(3));

    const report = await probeWorkBuddyPoolCredits("workbuddy", {
      now: () => NOW,
      deps,
      exclusions: { parked: "out-of-credit" },
    });

    assert.equal(calls(), 1, "only the non-excluded account is read");
    const parked = report.editions[0].accounts.find((account) => account.cid === "parked");
    assert.equal(parked?.status, "excluded");
    assert.equal(parked?.excludedBy, "out-of-credit");
    assert.equal(parked?.total, null);
  });

  it("scopes the pool to one connection when asked", async () => {
    const rows = [connection("one"), connection("two")];
    const { deps, calls } = depsFor(rows, async () => credits(1));
    const report = await probeWorkBuddyPoolCredits("workbuddy", {
      now: () => NOW,
      deps,
      connectionId: "two",
    });
    assert.equal(calls(), 1);
    assert.deepEqual(
      report.editions[0].accounts.map((account) => account.cid),
      ["two"]
    );
  });
});

describe("workbuddy pool quota — account selection", () => {
  it("prefers the named connection, then the first active one", () => {
    const accounts = [
      {
        cid: "a",
        label: "A",
        active: false,
        total: 1,
        packages: [],
        expiringSoon: 0,
        nearestExpiryMs: null,
        status: "ok" as const,
      },
      {
        cid: "b",
        label: "B",
        active: true,
        total: 2,
        packages: [],
        expiringSoon: 0,
        nearestExpiryMs: null,
        status: "ok" as const,
      },
    ];
    assert.equal(selectWorkBuddyQuotaAccount(accounts, "a")?.cid, "a");
    assert.equal(selectWorkBuddyQuotaAccount(accounts)?.cid, "b");
  });
});
