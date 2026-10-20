/**
 * Shared helpers for the WorkBuddy addon routes.
 *
 * Every route in this subtree authenticates like any management route via
 * `requireManagementAuth` — there is no separate token, no loopback-only assumption and no
 * desktop-app reach: this port answers from the platform's own connection rows (plan §C3).
 *
 * Nothing here returns a token: routes expose labels, connected bits and credit numbers. The
 * server re-reads the credential from the row on every request.
 *
 * Trimmed from `fork src/app/api/workbuddy/_lib.ts:1-216` to the single edition and to the
 * connection-backed path (no desktop scan, no import/checkin).
 *
 * @module app/api/workbuddy/_lib
 */

import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  resolveWorkBuddyConnection,
  resolveWorkBuddyConnectionById,
} from "@/lib/workbuddy/accounts";
import {
  diagnoseWorkBuddyFailure,
  type WorkBuddyFailureDiagnosis,
} from "@/lib/workbuddy/poolQuota";
import {
  resolveWorkBuddyEdition,
  WORKBUDDY_EDITIONS,
  type WorkBuddyCreditPackage,
  type WorkBuddyEdition,
} from "@/lib/workbuddy/types";

/** Provider ids this addon owns, as a union for query validation. */
export const WORKBUDDY_ROUTE_PROVIDER_IDS = WORKBUDDY_EDITIONS.map((edition) => edition.providerId);

/** The resolved account of the served edition, when it has a connection. */
export interface WorkBuddyEditionContext {
  edition: WorkBuddyEdition;
  connected: boolean;
  /** Present only when a usable connection exists. */
  credential?: Awaited<ReturnType<typeof resolveWorkBuddyConnection>>;
}

/**
 * Auth gate + JSON error envelope for this subtree.
 *
 * Returns a `Response` when the request must be rejected, `null` when it may proceed — the same
 * contract `requireManagementAuth` uses, so a route reads as
 * `const denied = await guard(request); if (denied) return denied;`.
 */
export async function guardWorkBuddyRequest(request: Request): Promise<Response | null> {
  return requireManagementAuth(request);
}

/** Error body with the upstream/exception text sanitized (never a raw stack or body). */
export function workBuddyError(message: unknown, status = 500): NextResponse {
  const safe = sanitizeErrorMessage(message instanceof Error ? message.message : String(message));
  return NextResponse.json(
    { ok: false, error: safe || "WorkBuddy addon request failed." },
    { status }
  );
}

/**
 * Editions to act on: the requested one, or the served one when the query omits it.
 *
 * `null` means the caller named a provider this addon does not own — a 400, not an empty
 * answer, because silently answering for `workbuddy` when someone asked for another provider
 * would be a lie about what the route read.
 */
export function resolveRequestedEditions(providerParam: string | null): WorkBuddyEdition[] | null {
  if (providerParam === null || providerParam.trim() === "") return [...WORKBUDDY_EDITIONS];
  const edition = resolveWorkBuddyEdition(providerParam);
  return edition ? [edition] : null;
}

/**
 * Resolve the accounts an overview route should answer for.
 *
 * Without `connectionId`: one entry for the served edition, using its active/first connection —
 * the single-account case, unchanged.
 *
 * With `connectionId`: exactly that connection, and its OWN edition wins over the `provider`
 * filter, because a caller that named an account has already answered the question "which
 * account". An empty array means "no such WorkBuddy connection", which the caller reports as
 * 404 rather than as "not connected".
 */
export async function collectEditionContexts(
  editions: readonly WorkBuddyEdition[],
  connectionId?: string | null
): Promise<WorkBuddyEditionContext[]> {
  if (connectionId && connectionId.trim() !== "") {
    const resolved = await resolveWorkBuddyConnectionById(connectionId);
    return resolved === null
      ? []
      : [{ edition: resolved.edition, connected: true, credential: resolved }];
  }

  const contexts: WorkBuddyEditionContext[] = [];
  for (const edition of editions) {
    const credential = await resolveWorkBuddyConnection(edition.providerId);
    contexts.push({
      edition,
      connected: credential !== null,
      ...(credential === null ? {} : { credential }),
    });
  }
  return contexts;
}

/** 404 for a `connectionId` that does not name a WorkBuddy connection. */
export function connectionNotFound(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "connection_not_found",
      error: "No WorkBuddy connection with that id.",
    },
    { status: 404 }
  );
}

/**
 * Read the shared targeting parameters off a query string.
 *
 * `provider` selects the edition (accepted for symmetry with the fork, where two existed);
 * `connectionId` selects ONE imported account (see `collectEditionContexts`).
 */
export function parseWorkBuddyTargetQuery(url: URL): {
  editions: WorkBuddyEdition[] | null;
  connectionId: string | null;
} {
  return {
    editions: resolveRequestedEditions(url.searchParams.get("provider")),
    connectionId: url.searchParams.get("connectionId"),
  };
}

/** Standard "no account connected yet" body. */
export function notConnectedBody(edition: WorkBuddyEdition) {
  return {
    provider: edition.providerId,
    region: edition.region,
    connected: false,
    message: `No WorkBuddy account is connected for ${edition.providerId}. Sign one in from the provider page first.`,
  };
}

/** ISO timestamp for a millisecond value, or `null` when the upstream did not send one. */
export function isoOrNull(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

/** One credit package as the dashboard consumes it (recurring and one-off kept apart). */
export function shapeWorkBuddyCreditPackage(entry: WorkBuddyCreditPackage) {
  return {
    name: entry.packageName,
    remaining: entry.remain,
    size: entry.size,
    kind: entry.monthly ? "refill" : "one-off",
    refreshAt: isoOrNull(entry.refreshAtMs),
    expiresAt: isoOrNull(entry.expiresAtMs),
  };
}

/**
 * The shared credit fields of a successful per-account body.
 *
 * Both the single-account read and the pool table answer with the same field names and order,
 * so a caller can move between them without a per-endpoint mapper.
 */
export function shapeWorkBuddyCreditFields(credits: {
  total: number;
  packages: readonly WorkBuddyCreditPackage[];
  expiringSoon: number;
  nearestExpiryMs?: number | null;
}) {
  return {
    total: credits.total,
    expiringSoon: credits.expiringSoon,
    nearestExpiry: isoOrNull(credits.nearestExpiryMs),
    packages: credits.packages.map(shapeWorkBuddyCreditPackage),
  };
}

/**
 * Shape one edition's failure without failing the whole response.
 *
 * `connected` follows the diagnosis, not the request: the old body reported `connected: true`
 * for every upstream failure, including a token the gateway had just refused. `auth_rejected`
 * means the token is dead (re-import/re-sign-in); `quota_refused` and `upstream_error` leave the
 * connection usable. `error` is the only free-form field and stays sanitized.
 */
export function editionError(
  edition: WorkBuddyEdition,
  error: unknown,
  diagnosis?: WorkBuddyFailureDiagnosis
) {
  const verdict = diagnosis ?? diagnoseWorkBuddyFailure(error);
  return {
    provider: edition.providerId,
    region: edition.region,
    connected: verdict !== "auth_rejected",
    ok: false,
    diagnosis: verdict,
    error:
      sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) ||
      "Request failed.",
  };
}
