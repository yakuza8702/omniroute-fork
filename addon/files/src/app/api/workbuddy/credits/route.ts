/**
 * GET /api/workbuddy/credits — remaining credits.
 *
 * The credit meter is the reason this addon exists rather than a plain gateway entry: WorkBuddy
 * spends CREDITS, and a model's rate converts a request into a spend, so "how much is left, and
 * what expires first" is the question an operator actually has.
 *
 * Packages are returned unmerged (recurring refills and one-off bonuses side by side, with
 * their own dates) because collapsing them loses exactly the dates a decision needs.
 *
 * Read-only: nothing here spends or claims (the daily check-in is DEFERRED, plan §12).
 *
 * Query:
 *  - `?provider=workbuddy` — edition filter (accepted for symmetry; one edition exists).
 *  - `?connectionId=<id>` — one named account.
 *  - `?all=true` — the POOL-WIDE table: one row per imported account, with its own balance,
 *    expiry and verdict. One upstream read per account, cached for 10 minutes and shared
 *    between concurrent callers (see `lib/workbuddy/poolQuota`).
 *  - `?detail=fast` — snapshot only: NEVER reads upstream. Rows with no snapshot yet are
 *    reported as `status: "unknown"` (never as a zero balance).
 *  - `?refresh=true` — ignore the snapshot and re-read (the explicit manual refresh).
 *
 * The default (no `all`/`detail`) answer is the single-account body, served through the same
 * snapshot so polling it does not re-read the billing endpoint on every request.
 *
 * Ported from `fork src/app/api/workbuddy/credits/route.ts:1-302`, single edition.
 */

import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import {
  collectEditionContexts,
  connectionNotFound,
  editionError,
  guardWorkBuddyRequest,
  isoOrNull,
  notConnectedBody,
  parseWorkBuddyTargetQuery,
  shapeWorkBuddyCreditFields,
  shapeWorkBuddyCreditPackage,
  workBuddyError,
  type WorkBuddyEditionContext,
} from "../_lib";
import {
  probeWorkBuddyPoolCredits,
  selectWorkBuddyQuotaAccount,
  type WorkBuddyPoolProbeOptions,
  type WorkBuddyPoolQuotaAccount,
  type WorkBuddyPoolQuotaEdition,
} from "@/lib/workbuddy/poolQuota";
import { fetchWorkBuddyCredits } from "@/lib/workbuddy/upstream";
import { resolveWorkBuddyConnectionById } from "@/lib/workbuddy/accounts";

/** `?flag` / `?flag=1` / `?flag=true` — so the admin panel can pass a bare flag. */
function isEnabledFlag(value: string | null): boolean {
  if (value === null) return false;
  const key = value.trim().toLowerCase();
  return key === "" || key === "1" || key === "true" || key === "yes" || key === "on";
}

/** The connection id a resolved context answers for, when the row carries one. */
function contextConnectionId(context: WorkBuddyEditionContext): string | null {
  const id = context.credential?.connection.id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

/**
 * Read (or read from snapshot) the one account this context answers for.
 *
 * The probe is addressed to that connection, so a single-account request still costs ONE
 * upstream read — the pool table's rows for its siblings are not priced into it.
 */
async function accountFor(
  context: WorkBuddyEditionContext,
  options: WorkBuddyPoolProbeOptions
): Promise<WorkBuddyPoolQuotaAccount | undefined> {
  const cid = contextConnectionId(context);
  const report = await probeWorkBuddyPoolCredits(context.edition, {
    ...options,
    ...(cid === null ? {} : { connectionId: cid }),
  });
  return selectWorkBuddyQuotaAccount(report.editions[0]?.accounts ?? [], cid);
}

/** Wire shape of one pool row. Figures are `null` (never `0`) unless the read succeeded. */
function poolAccountBody(account: WorkBuddyPoolQuotaAccount) {
  return {
    cid: account.cid,
    label: account.label,
    active: account.active,
    status: account.status,
    ...(account.kind === undefined ? {} : { kind: account.kind }),
    total: account.total,
    expiringSoon: account.expiringSoon,
    nearestExpiry: isoOrNull(account.nearestExpiryMs),
    packages: account.packages.map(shapeWorkBuddyCreditPackage),
    ...(account.error === undefined
      ? {}
      : { error: sanitizeErrorMessage(account.error) || "Request failed." }),
    ...(account.diagnosis === undefined ? {} : { diagnosis: account.diagnosis }),
    ...(account.excludedBy === undefined ? {} : { excludedBy: account.excludedBy }),
    snapshotAt: isoOrNull(account.fetchedAtMs),
    cached: account.cached === true,
    stale: account.stale === true,
  };
}

/** Wire shape of one edition's slice of the pool table. */
function poolEditionBody(edition: WorkBuddyPoolQuotaEdition) {
  return {
    provider: edition.provider,
    region: edition.region,
    accounts: edition.accounts.map(poolAccountBody),
    snapshotAt: isoOrNull(edition.fetchedAtMs),
    cached: edition.cached,
    pending: edition.unknown,
    ...(edition.error === undefined ? {} : { error: edition.error }),
  };
}

/**
 * Snapshot-only body for one edition.
 *
 * `detail=fast` exists so a first paint never waits on a billing endpoint: when the snapshot has
 * no verdict yet the row says so (`pending: true`) instead of reporting a made-up zero balance
 * or a fake error.
 */
function fastEditionBody(
  context: WorkBuddyEditionContext,
  account: WorkBuddyPoolQuotaAccount | undefined
) {
  const base = { provider: context.edition.providerId, region: context.edition.region };
  if (account === undefined) {
    return {
      ...base,
      connected: true,
      ok: false,
      pending: true,
      message: "No credits snapshot yet. Warm it with GET /api/workbuddy/credits?all=true.",
    };
  }
  if (account.status === "excluded") {
    return {
      ...base,
      connected: true,
      ok: false,
      excluded: true,
      excludedBy: account.excludedBy ?? null,
      connectionId: account.cid,
      account: account.label,
      message: "This account is excluded from the WorkBuddy pool.",
    };
  }
  if (account.status === "error") {
    return editionError(context.edition, account.error ?? "Request failed.", account.diagnosis);
  }
  if (account.status !== "ok" || account.total === null) {
    return {
      ...base,
      connected: true,
      ok: false,
      pending: true,
      connectionId: account.cid,
      account: account.label,
      message:
        "No credits snapshot for this account yet. Warm it with GET /api/workbuddy/credits?all=true.",
    };
  }
  return {
    ...base,
    connected: true,
    ok: true,
    connectionId: account.cid,
    account: account.label,
    ...shapeWorkBuddyCreditFields({
      total: account.total,
      packages: account.packages,
      expiringSoon: account.expiringSoon ?? 0,
      nearestExpiryMs: account.nearestExpiryMs,
    }),
    snapshotAt: isoOrNull(account.fetchedAtMs),
    cached: true,
    stale: account.stale === true,
  };
}

export async function GET(request: Request): Promise<Response> {
  const denied = await guardWorkBuddyRequest(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const { editions, connectionId } = parseWorkBuddyTargetQuery(url);
  if (!editions) {
    return workBuddyError("Unknown provider. Use workbuddy.", 400);
  }

  const poolWide = isEnabledFlag(url.searchParams.get("all"));
  const snapshotOnly = (url.searchParams.get("detail") ?? "").trim().toLowerCase() === "fast";
  const refresh = isEnabledFlag(url.searchParams.get("refresh"));
  const probeOptions: WorkBuddyPoolProbeOptions = {
    detail: snapshotOnly ? "fast" : "full",
    refresh,
    ...(connectionId === null || connectionId.trim() === ""
      ? {}
      : { connectionId: connectionId.trim() }),
  };

  try {
    if (poolWide) {
      // A caller that named an account has already answered "which edition": its own edition
      // wins over `provider`, exactly as the single-account path does.
      let targets = editions;
      if (connectionId && connectionId.trim() !== "") {
        const named = await resolveWorkBuddyConnectionById(connectionId.trim());
        if (named === null) return connectionNotFound();
        targets = [named.edition];
      }
      const report = await probeWorkBuddyPoolCredits(targets, probeOptions);
      if (connectionId && report.editions.every((edition) => edition.accounts.length === 0)) {
        return connectionNotFound();
      }
      return NextResponse.json({
        ok: true,
        detail: report.detail,
        editions: report.editions.map(poolEditionBody),
      });
    }

    const contexts = await collectEditionContexts(editions, connectionId);
    if (connectionId && contexts.length === 0) return connectionNotFound();

    const results: unknown[] = [];
    for (const context of contexts) {
      const credential = context.credential;
      if (!credential) {
        results.push(notConnectedBody(context.edition));
        continue;
      }
      const account = await accountFor(context, probeOptions);
      if (snapshotOnly) {
        results.push(fastEditionBody(context, account));
        continue;
      }
      if (account !== undefined && account.status === "ok" && account.total !== null) {
        results.push({
          provider: context.edition.providerId,
          region: context.edition.region,
          connected: true,
          ok: true,
          connectionId: credential.connection.id ?? null,
          account: credential.connection.displayName ?? null,
          ...shapeWorkBuddyCreditFields({
            total: account.total,
            packages: account.packages,
            expiringSoon: account.expiringSoon ?? 0,
            nearestExpiryMs: account.nearestExpiryMs,
          }),
        });
        continue;
      }
      if (account !== undefined && account.status === "error" && account.error !== undefined) {
        results.push(editionError(context.edition, account.error, account.diagnosis));
        continue;
      }
      if (account !== undefined && account.status === "excluded") {
        // A pool exclusion is a statement about THIS account (dead sign-in, empty balance), so
        // the single-account surface must not spend a billing read to rediscover it — it
        // reports the exclusion instead of a fabricated balance.
        results.push({
          provider: context.edition.providerId,
          region: context.edition.region,
          connected: true,
          ok: false,
          excluded: true,
          excludedBy: account.excludedBy ?? null,
          connectionId: credential.connection.id ?? null,
          account: credential.connection.displayName ?? null,
          message: "This account is excluded from the WorkBuddy pool.",
        });
        continue;
      }
      // No verdict from the pool (a row that vanished between the two reads): answer from the
      // upstream directly, exactly as before.
      try {
        const credits = await fetchWorkBuddyCredits(credential.credential);
        results.push({
          provider: context.edition.providerId,
          region: context.edition.region,
          connected: true,
          ok: true,
          connectionId: credential.connection.id ?? null,
          account: credential.connection.displayName ?? null,
          ...shapeWorkBuddyCreditFields(credits),
        });
      } catch (error) {
        results.push(editionError(context.edition, error));
      }
    }
    return NextResponse.json({ ok: true, editions: results });
  } catch (error) {
    return workBuddyError(error);
  }
}
