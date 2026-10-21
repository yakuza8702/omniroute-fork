/**
 * 0010 (wave 6) — the Provider Quota usage-fetch gate.
 *
 * `GET /api/usage/{connectionId}` answers `400 {"error":"Usage not available for this
 * connection"}` for a workbuddy connection: it is an OAuth provider with no usage backend, and
 * the only quota it reports is the pooled credit snapshot (`GET /api/workbuddy/credits`). The
 * panel drew that 400 as a red banner on the card whose credits strip was the real meter, so the
 * per-connection fetch is now gated by `shouldFetchUsage()`.
 *
 * The suite is in two halves, because either one alone is blind:
 *
 *  1. the PREDICATE — the whole workbuddy family (canonical id, the `wb`/`wbg` aliases, any
 *     `workbuddy-*` spelling, case and padding included) is skipped, every real quota provider is
 *     not, and an unknown/malformed id FAILS OPEN: losing a live usage card is worse than an
 *     error line for a provider id this list has never seen;
 *  2. the CALL SITE — a source-level pin that the gate sits inside `fetchQuota`, before the
 *     `/api/usage/` request and before the loading/error state is touched. A correct predicate
 *     that is called after the fetch (or not at all) satisfies (1) and still shows the banner,
 *     and the component harness renders no client components, so this is the only place the
 *     wiring itself can be asserted.
 *
 * The card body is pinned too: a credits-slot card must not render the generic quota body, which
 * would put a "no quota data" line over a live credit balance.
 *
 * Harness: `node --import tsx/esm --import ./tests/_setup/isolateDataDir.ts --test
 * tests/unit/workbuddy-quota-usage-skip.test.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { shouldFetchUsage } from "@/shared/utils/workBuddyCredit";

const read = (rel: string): string =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const PANEL = "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx";
const CARD = "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCard.tsx";

describe("shouldFetchUsage — the workbuddy family is skipped", () => {
  it("skips the canonical id", () => {
    assert.equal(shouldFetchUsage("workbuddy"), false);
  });

  it("skips the executor aliases", () => {
    assert.equal(shouldFetchUsage("wb"), false);
    assert.equal(shouldFetchUsage("wbg"), false);
  });

  it("skips any workbuddy-* spelling, whatever the case or padding", () => {
    for (const id of ["workbuddy-cn", "workbuddy-global", "WorkBuddy", " WORKBUDDY ", "wb "]) {
      assert.equal(shouldFetchUsage(id), false, id);
    }
  });
});

describe("shouldFetchUsage — every other provider keeps its usage fetch", () => {
  it("keeps the fetch for providers with a usage backend", () => {
    for (const id of [
      "codex",
      "anthropic",
      "claude",
      "openai",
      "gemini",
      "antigravity",
      "agy",
      "opencode",
      "kilocode",
      "openai-compatible-x",
    ]) {
      assert.equal(shouldFetchUsage(id), true, id);
    }
  });

  it("fails open for an unknown or malformed id", () => {
    // A near-miss is NOT the family: only a real `workbuddy-` prefix or an alias is.
    for (const id of ["workbuddyx", "work", "w", "", "   "]) {
      assert.equal(shouldFetchUsage(id), true, id);
    }
    for (const value of [undefined, null, 42, {}, []]) {
      assert.equal(shouldFetchUsage(value), true, String(value));
    }
  });
});

describe("index.tsx — the gate runs before the usage request", () => {
  const source = read(PANEL);

  it("gates inside fetchQuota, before the request and before any loading/error state", () => {
    const fetchQuotaAt = source.indexOf("const fetchQuota = useCallback(");
    const gateAt = source.indexOf("if (!shouldFetchUsage(provider)) return;");
    const requestAt = source.indexOf("/api/usage/${connectionId}");
    const loadingAt = source.indexOf("setLoading((prev) => ({ ...prev, [connectionId]: true }))");
    const clearingAt = source.indexOf("setErrors((prev) => ({ ...prev, [connectionId]: null }))");

    assert.ok(fetchQuotaAt > 0, "fetchQuota is gone");
    assert.ok(gateAt > fetchQuotaAt, "the gate is outside fetchQuota");
    assert.ok(requestAt > gateAt, "the usage request still fires before the gate");
    assert.ok(loadingAt > gateAt, "loading state is set before the gate");
    assert.ok(clearingAt > gateAt, "error state is reset before the gate");
  });

  it("gates exactly once (one choke point, every caller funnels through it)", () => {
    assert.equal(source.split("if (!shouldFetchUsage(provider)) return;").length, 2);
  });

  it("says where workbuddy quota actually comes from", () => {
    assert.ok(source.includes("reports quota via /api/workbuddy/credits"));
  });
});

describe("QuotaCard.tsx — a credits-slot card shows only the slot", () => {
  const source = read(CARD);

  it("does not render the generic quota body when a credits slot is present", () => {
    assert.ok(source.includes("{creditsSlot ? null : ("));
    assert.ok(source.includes("{creditsSlot ? ("));
  });
});
