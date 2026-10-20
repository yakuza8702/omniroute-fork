/**
 * WorkBuddy addon — pool-wide quota engine.
 *
 * The per-connection credits route answers for ONE connection, because the routing layer
 * reaches one connection first. An operator with several imported accounts needs the other
 * question: "what does each account have left, and which one expires first?" — and answering
 * it by looping the single-account route would cost one upstream billing read per account,
 * per poll.
 *
 * So this module is the pooled read, with three properties the route cannot have:
 *
 *  1. **One upstream read per account, on demand.** The dashboard opens a pool table when it
 *     wants it; nothing here runs on the chat hot path.
 *  2. **A snapshot, not a poll.** Readings are cached for {@link
 *     WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS} (10 minutes). Concurrent callers share the same
 *     in-flight promise per connection, so a burst of polls costs ONE batch, not N.
 *  3. **`detail: "fast"` never touches the network.** It answers from whatever snapshot exists
 *     (figures may be absent: those rows are `status: "unknown"`, never `0`).
 *
 * Failures are contained: every account settles on its own (`Promise.allSettled`), and a dead
 * token is reported as `status: "error"` with a `diagnosis` of `auth_rejected` rather than
 * blanking the table — the pool's job is to show which accounts exist.
 *
 * The snapshot lives in module memory on purpose, and is NOT `src/domain/quotaCache.ts`: that
 * cache is the routing layer's provider-level budget (persisted, keyed by provider, consulted
 * on every request). A billing readout per ACCOUNT with its own invalidation semantics is a
 * different object; wrapping one in the other would couple the routing hot path to a dashboard
 * table.
 *
 * Trimmed from `fork src/lib/workbuddy/poolQuota.ts:1-732` to the single edition (plan §D1),
 * plus one seam the fork did not need: {@link WorkBuddyPoolProbeDeps}. The fork's tests could
 * reach the DB; this port's T6 may not (the harness isolates `DATA_DIR` but has no connection
 * rows), so the two I/O calls are injectable. Production never passes them — the defaults are
 * the real modules.
 *
 * @module lib/workbuddy/poolQuota
 */

import {
  credentialFromWorkBuddyConnection,
  isWorkBuddyConnectionActive,
  listWorkBuddyConnections,
} from "./accounts";
import { fetchWorkBuddyCredits } from "./upstream";
import {
  WORKBUDDY_EDITIONS,
  resolveWorkBuddyEdition,
  type WorkBuddyCreditPackage,
  type WorkBuddyCredential,
  type WorkBuddyEdition,
} from "./types";

/** How long a per-account credit reading stays authoritative (10 minutes). */
export const WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS = 600_000;

/** Separator for the composite in-flight key (never appears in an id). */
const KEY_SEPARATOR = "\u0000";

/**
 * Why a credit read failed.
 *
 * - `auth_rejected` — the gateway refused the TOKEN itself (HTTP 401/403). No retry with the
 *   same token helps, so the connection is reported as not connected.
 * - `quota_refused` — the account answered but refused on quota grounds (402/429, or a billing
 *   refusal). The connection is healthy; its credits are the problem.
 * - `upstream_error` — anything else (network, 5xx, malformed envelope).
 */
export type WorkBuddyFailureDiagnosis = "auth_rejected" | "quota_refused" | "upstream_error";

/**
 * Verdict for one account in the pool.
 *
 * `excluded` means a pool policy skipped the account (no upstream read was made); `unknown`
 * means this call was `detail: "fast"` and no snapshot exists yet. Neither is an error, and
 * neither is reported as a zero balance.
 */
export type WorkBuddyQuotaStatus = "ok" | "error" | "excluded" | "unknown";

/** Dominant credit-package type of an account's current balance. */
export type WorkBuddyQuotaKind = "refill" | "one-off" | "mixed" | "none";

/** One account's pooled credit reading. */
export interface WorkBuddyPoolQuotaAccount {
  /** Connection id, or `null` for a row the platform stored without one. */
  cid: string | null;
  /** Dashboard-facing account label (never a token, never a fingerprint). */
  label: string;
  /** Whether the routing layer may select this connection. */
  active: boolean;
  /** Remaining credits; `null` unless `status` is `ok`. */
  total: number | null;
  packages: WorkBuddyCreditPackage[];
  expiringSoon: number | null;
  nearestExpiryMs: number | null;
  status: WorkBuddyQuotaStatus;
  /** Present only when a balance was read. */
  kind?: WorkBuddyQuotaKind;
  /** Sanitized upstream message, when `status` is `error`. */
  error?: string;
  diagnosis?: WorkBuddyFailureDiagnosis;
  /** Why a pool policy excluded the account, when `status` is `excluded`. */
  excludedBy?: string;
  fetchedAtMs?: number;
  /** True when these figures came from the snapshot instead of a fresh read. */
  cached?: boolean;
  /** True when the snapshot is older than the TTL (kept, but flagged). */
  stale?: boolean;
}

/** One edition's slice of the pool table. */
export interface WorkBuddyPoolQuotaEdition {
  provider: string;
  region: string;
  accounts: WorkBuddyPoolQuotaAccount[];
  /** Newest reading in this block, or `null` when nothing has been read yet. */
  fetchedAtMs: number | null;
  /** True when this call made no upstream read at all. */
  cached: boolean;
  /** Rows `detail: "fast"` could not answer (no snapshot yet). */
  unknown: number;
  /** Set only when the connection list itself could not be read. */
  error?: string;
}

/** Pool-wide report, one block per requested edition. */
export interface WorkBuddyPoolQuotaReport {
  ok: true;
  detail: "full" | "fast";
  editions: WorkBuddyPoolQuotaEdition[];
}

/**
 * The two I/O calls the probe makes.
 *
 * Defaults are the real modules; the parameter exists so a unit test can drive the engine
 * without a database (see T6). Anything injected must obey the same contracts: connections are
 * plain rows (as `getProviderConnections` returns them) and credits may throw.
 */
export interface WorkBuddyPoolProbeDeps {
  listConnections?: (providerId: string) => Promise<Record<string, unknown>[]>;
  readCredits?: (credential: WorkBuddyCredential) => Promise<{
    total: number;
    packages: WorkBuddyCreditPackage[];
    expiringSoon: number;
    nearestExpiryMs?: number;
  }>;
}

/** Options for {@link probeWorkBuddyPoolCredits}. */
export interface WorkBuddyPoolProbeOptions {
  /** `fast` answers from the snapshot only — no upstream read. Default `full`. */
  detail?: "full" | "fast";
  /** Ignore the snapshot and re-read every account (the explicit "refresh" action). */
  refresh?: boolean;
  /** Snapshot TTL override (milliseconds). */
  ttlMs?: number;
  /** Clock injection, for deterministic tests. */
  now?: () => number;
  /** Restrict the table to one connection. */
  connectionId?: string | null;
  /**
   * Explicit exclusions (`connectionId -> reason`), merged over anything the optional
   * pool-state module reports. Excluded accounts are listed without an upstream read.
   */
  exclusions?: Record<string, string>;
  /** Test seam — production leaves this unset (see {@link WorkBuddyPoolProbeDeps}). */
  deps?: WorkBuddyPoolProbeDeps;
}

/** Figures cached for one connection; identity is rebuilt per call from the live row. */
interface SnapshotEntry {
  status: "ok" | "error";
  total: number | null;
  packages: WorkBuddyCreditPackage[];
  expiringSoon: number | null;
  nearestExpiryMs: number | null;
  error?: string;
  diagnosis?: WorkBuddyFailureDiagnosis;
  fetchedAtMs: number;
}

interface PoolSnapshot {
  /** `cid` (or a synthetic key for id-less rows) -> figures. */
  entries: Map<string, SnapshotEntry>;
  /**
   * Bumped by {@link invalidateWorkBuddyQuotaSnapshot}. An in-flight read that started before
   * an invalidation is still returned to ITS callers, but is not written back.
   */
  revision: number;
}

/** Per-provider snapshot, module-scoped: the addon is a single-process admin surface. */
const snapshots = new Map<string, PoolSnapshot>();
/** `${providerId}\0${key}` -> the batch this connection is already in. */
const inFlight = new Map<string, Promise<SnapshotEntry>>();

function poolSnapshot(providerId: string): PoolSnapshot {
  const existing = snapshots.get(providerId);
  if (existing) return existing;
  const created: PoolSnapshot = { entries: new Map(), revision: 0 };
  snapshots.set(providerId, created);
  return created;
}

/* ------------------------------------------------------------------ *
 * Failure classification
 * ------------------------------------------------------------------ */

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error ?? "");
}

function statusOf(error: unknown): number | undefined {
  const direct = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const match = /\bhttp\s+(\d{3})\b/iu.exec(errorText(error));
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Classify a credits failure as a dead session, a quota refusal or a plain upstream fault.
 *
 * 401/403 is the gateway refusing the CREDENTIAL (including the HTML 401 the international
 * edge returns). 402/429 is a quota answer — the account is fine, its balance is not. Reading
 * the status off the error object (and falling back to the message) keeps the classification
 * working when the throwing and the inspecting module end up as different instances.
 */
export function diagnoseWorkBuddyFailure(error: unknown): WorkBuddyFailureDiagnosis {
  const status = statusOf(error);
  if (status === 401 || status === 403) return "auth_rejected";
  if (status === 402 || status === 429) return "quota_refused";
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    /quota|insufficient|exceed|balance|no credit/iu.test(errorText(error))
  ) {
    return "quota_refused";
  }
  return "upstream_error";
}

/** Whether an error says the stored token is no longer accepted upstream. */
export function isWorkBuddyCredentialRejection(error: unknown): boolean {
  return diagnoseWorkBuddyFailure(error) === "auth_rejected";
}

/* ------------------------------------------------------------------ *
 * Optional pool state (exclusions)
 * ------------------------------------------------------------------ */

type PoolStateModule = typeof import("./poolState");

let poolStatePromise: Promise<PoolStateModule | null> | null = null;

/**
 * Load the optional `./poolState` sibling MODULE (cached), not its values.
 *
 * The import is dynamic and wrapped: the quota table must keep answering even when the
 * pool-state document cannot be read, and a caller that injects its own `exclusions` must not
 * depend on the sibling at all. The specifier is a literal so the bundler can still resolve it
 * statically — a computed specifier compiles into an unresolved request and would silently
 * never load in a production build.
 *
 * The module is cached; the DOCUMENT is read on every probe. Caching the values instead would
 * mean an operator who parks or clears an account (or a volume written by the fork) is served a
 * stale exclusion forever, because nothing in this process would invalidate it.
 */
function loadPoolStateModule(): Promise<PoolStateModule | null> {
  if (poolStatePromise === null) {
    poolStatePromise = import("./poolState").catch(() => null);
  }
  return poolStatePromise;
}

async function loadPoolExclusions(): Promise<Record<string, string>> {
  try {
    const stateModule = await loadPoolStateModule();
    return stateModule === null ? {} : stateModule.getWorkBuddyPoolExclusions();
  } catch {
    // A broken pool-state document must not take the quota table down with it.
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Public probe
 * ------------------------------------------------------------------ */

function selectedEditions(
  input: string | WorkBuddyEdition | readonly (string | WorkBuddyEdition)[] | null | undefined
): WorkBuddyEdition[] {
  if (input === null || input === undefined) return [...WORKBUDDY_EDITIONS];
  const items = Array.isArray(input) ? input : [input as string | WorkBuddyEdition];
  const editions: WorkBuddyEdition[] = [];
  for (const item of items) {
    const edition = typeof item === "string" ? resolveWorkBuddyEdition(item) : item;
    if (edition && !editions.some((entry) => entry.providerId === edition.providerId)) {
      editions.push(edition);
    }
  }
  return editions;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function readRow(row: Record<string, unknown>): {
  cid: string | null;
  label: string;
  active: boolean;
} {
  const cid = firstString(row.id) ?? null;
  const label = firstString(row.displayName, row.name) ?? "WorkBuddy account";
  let active = false;
  try {
    active = isWorkBuddyConnectionActive(row);
  } catch {
    active = false;
  }
  return { cid, label, active };
}

function packageKind(packages: readonly WorkBuddyCreditPackage[]): WorkBuddyQuotaKind {
  if (packages.length === 0) return "none";
  const recurring = packages.filter((entry) => entry.monthly).length;
  if (recurring === 0) return "one-off";
  return recurring === packages.length ? "refill" : "mixed";
}

function rowFromEntry(
  identity: { cid: string | null; label: string; active: boolean },
  entry: SnapshotEntry,
  cached: boolean,
  stale: boolean
): WorkBuddyPoolQuotaAccount {
  if (entry.status === "error") {
    return {
      ...identity,
      total: null,
      packages: [],
      expiringSoon: null,
      nearestExpiryMs: null,
      status: "error",
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.diagnosis === undefined ? {} : { diagnosis: entry.diagnosis }),
      fetchedAtMs: entry.fetchedAtMs,
      cached,
      stale,
    };
  }
  return {
    ...identity,
    total: entry.total,
    packages: entry.packages,
    expiringSoon: entry.expiringSoon,
    nearestExpiryMs: entry.nearestExpiryMs,
    status: "ok",
    kind: packageKind(entry.packages),
    fetchedAtMs: entry.fetchedAtMs,
    cached,
    stale,
  };
}

function emptyRow(
  identity: { cid: string | null; label: string; active: boolean },
  status: "excluded" | "unknown",
  extra: Partial<WorkBuddyPoolQuotaAccount> = {}
): WorkBuddyPoolQuotaAccount {
  return {
    ...identity,
    total: null,
    packages: [],
    expiringSoon: null,
    nearestExpiryMs: null,
    status,
    ...extra,
  };
}

function errorRow(
  identity: { cid: string | null; label: string; active: boolean },
  error: unknown,
  fetchedAtMs?: number
): WorkBuddyPoolQuotaAccount {
  return {
    ...identity,
    total: null,
    packages: [],
    expiringSoon: null,
    nearestExpiryMs: null,
    status: "error",
    error: errorText(error) || "Request failed.",
    diagnosis: diagnoseWorkBuddyFailure(error),
    ...(fetchedAtMs === undefined ? {} : { fetchedAtMs }),
  };
}

/** Read one account's credits and cache the figures (unless invalidated meanwhile). */
async function readAccount(
  providerId: string,
  key: string,
  credential: WorkBuddyCredential,
  now: () => number,
  deps: WorkBuddyPoolProbeDeps
): Promise<SnapshotEntry> {
  const snapshot = poolSnapshot(providerId);
  const revision = snapshot.revision;
  const readCredits = deps.readCredits ?? fetchWorkBuddyCredits;
  let entry: SnapshotEntry;
  try {
    const credits = await readCredits(credential);
    entry = {
      status: "ok",
      total: credits.total,
      packages: credits.packages,
      expiringSoon: credits.expiringSoon,
      nearestExpiryMs: credits.nearestExpiryMs ?? null,
      fetchedAtMs: now(),
    };
  } catch (error) {
    entry = {
      status: "error",
      total: null,
      packages: [],
      expiringSoon: null,
      nearestExpiryMs: null,
      error: errorText(error) || "Request failed.",
      diagnosis: diagnoseWorkBuddyFailure(error),
      fetchedAtMs: now(),
    };
  }
  // An invalidation that landed while this read was in flight wins: the callers below still
  // get the answer they asked for, but the next probe re-reads instead of reusing it.
  if (snapshot.revision === revision) snapshot.entries.set(key, entry);
  return entry;
}

/**
 * Join the batch for one connection, or start it.
 *
 * This is the dedupe: two routes polling the same pool at the same second share ONE upstream
 * billing read per account, and the second caller waits on the first's promise instead of
 * issuing its own.
 */
function batchFor(
  providerId: string,
  key: string,
  credential: WorkBuddyCredential,
  now: () => number,
  deps: WorkBuddyPoolProbeDeps
): Promise<SnapshotEntry> {
  const flightKey = `${providerId}${KEY_SEPARATOR}${key}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const flight = readAccount(providerId, key, credential, now, deps).finally(() => {
    if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
  });
  inFlight.set(flightKey, flight);
  return flight;
}

async function probeEdition(
  edition: WorkBuddyEdition,
  context: {
    detail: "full" | "fast";
    refresh: boolean;
    ttlMs: number;
    now: () => number;
    connectionId: string | null;
    exclusions: Record<string, string>;
    deps: WorkBuddyPoolProbeDeps;
  }
): Promise<WorkBuddyPoolQuotaEdition> {
  const base: WorkBuddyPoolQuotaEdition = {
    provider: edition.providerId,
    region: edition.region,
    accounts: [],
    fetchedAtMs: null,
    cached: true,
    unknown: 0,
  };

  let rows: Record<string, unknown>[];
  try {
    const list = context.deps.listConnections ?? listWorkBuddyConnections;
    rows = await list(edition.providerId);
  } catch (error) {
    return { ...base, error: errorText(error) || "Could not list WorkBuddy connections." };
  }

  const wanted =
    context.connectionId === null
      ? rows
      : rows.filter((row) => firstString(row.id) === context.connectionId);

  const snapshot = poolSnapshot(edition.providerId);
  const slots: Array<WorkBuddyPoolQuotaAccount | null> = new Array(wanted.length).fill(null);
  const pending: Array<{ index: number; promise: Promise<SnapshotEntry> }> = [];

  wanted.forEach((row, index) => {
    let identity: { cid: string | null; label: string; active: boolean };
    try {
      identity = readRow(row);
    } catch {
      slots[index] = errorRow(
        { cid: null, label: "WorkBuddy account", active: false },
        "Unreadable connection row."
      );
      return;
    }

    const key = identity.cid ?? `row:${index}`;
    const excludedBy = identity.cid === null ? undefined : context.exclusions[identity.cid];
    if (excludedBy !== undefined) {
      slots[index] = emptyRow(identity, "excluded", { excludedBy });
      return;
    }

    let credential: WorkBuddyCredential | null = null;
    try {
      credential = credentialFromWorkBuddyConnection(row);
    } catch {
      credential = null;
    }
    if (credential === null) {
      slots[index] = errorRow(identity, "Connection carries no usable access token.");
      return;
    }

    if (context.detail === "fast") {
      const entry = snapshot.entries.get(key);
      slots[index] =
        entry === undefined
          ? emptyRow(identity, "unknown")
          : rowFromEntry(identity, entry, true, context.now() - entry.fetchedAtMs >= context.ttlMs);
      return;
    }

    const entry = snapshot.entries.get(key);
    const fresh =
      entry !== undefined && !context.refresh && context.now() - entry.fetchedAtMs < context.ttlMs;
    if (entry !== undefined && fresh) {
      slots[index] = rowFromEntry(identity, entry, true, false);
      return;
    }

    pending.push({
      index,
      promise: batchFor(edition.providerId, key, credential, context.now, context.deps),
    });
  });

  if (pending.length > 0) {
    // One account failing must never blank the table for the accounts that are fine.
    const settled = await Promise.allSettled(pending.map((item) => item.promise));
    settled.forEach((outcome, position) => {
      const slot = pending[position];
      let identity: { cid: string | null; label: string; active: boolean };
      try {
        identity = readRow(wanted[slot.index]);
      } catch {
        identity = { cid: null, label: "WorkBuddy account", active: false };
      }
      slots[slot.index] =
        outcome.status === "fulfilled"
          ? rowFromEntry(identity, outcome.value, false, false)
          : errorRow(identity, outcome.reason);
    });
  }

  const accounts = slots.filter((row): row is WorkBuddyPoolQuotaAccount => row !== null);
  let fetchedAtMs: number | null = null;
  for (const account of accounts) {
    const at = account.fetchedAtMs;
    if (at !== undefined && (fetchedAtMs === null || at > fetchedAtMs)) fetchedAtMs = at;
  }

  return {
    ...base,
    accounts,
    fetchedAtMs,
    cached: pending.length === 0,
    unknown: accounts.filter((account) => account.status === "unknown").length,
  };
}

/**
 * Read the credit balance of EVERY account of the requested editions.
 *
 * Order is the platform's own preference order (`listWorkBuddyConnections`), never re-sorted:
 * the "current account" in this table has to mean the same thing it means to the router. Pass
 * `detail: "fast"` for a snapshot-only read (no upstream traffic), `refresh: true` to bypass a
 * warm snapshot, and `exclusions` to list accounts as excluded without reading them.
 */
export async function probeWorkBuddyPoolCredits(
  edition?: string | WorkBuddyEdition | readonly (string | WorkBuddyEdition)[] | null,
  opts: WorkBuddyPoolProbeOptions = {}
): Promise<WorkBuddyPoolQuotaReport> {
  const detail = opts.detail === "fast" ? "fast" : "full";
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS;
  const deps = opts.deps ?? {};

  const exclusions: Record<string, string> = {
    ...(await loadPoolExclusions()),
    ...(opts.exclusions ?? {}),
  };
  const context = {
    detail,
    refresh: opts.refresh === true,
    ttlMs,
    now,
    connectionId: opts.connectionId ?? null,
    exclusions,
    deps,
  } as const;

  const editions: WorkBuddyPoolQuotaEdition[] = [];
  for (const target of selectedEditions(edition)) {
    editions.push(await probeEdition(target, context));
  }
  return { ok: true, detail, editions };
}

/**
 * Drop cached readings, either for ONE connection or for the whole pool.
 *
 * The manual refresh action calls it; `cid` omitted clears everything. Values are still
 * returned to callers that were already awaiting them, but they are no longer served from the
 * snapshot.
 */
export function invalidateWorkBuddyQuotaSnapshot(cid?: string | null): void {
  const target = typeof cid === "string" ? cid.trim() : "";
  for (const [providerId, snapshot] of snapshots) {
    let touched = false;
    if (target === "") {
      if (snapshot.entries.size > 0) touched = true;
      snapshot.entries.clear();
    } else if (snapshot.entries.delete(target)) {
      touched = true;
    }
    for (const flightKey of [...inFlight.keys()]) {
      const [flightProvider, flightTarget] = flightKey.split(KEY_SEPARATOR);
      if (flightProvider !== providerId) continue;
      if (target !== "" && flightTarget !== target) continue;
      inFlight.delete(flightKey);
      touched = true;
    }
    if (touched) snapshot.revision += 1;
  }
}

/** Test seam: forget every snapshot and every in-flight batch (T6 isolation). */
export function resetWorkBuddyQuotaSnapshots(): void {
  snapshots.clear();
  inFlight.clear();
}

/**
 * Pick the account a single-account surface should answer for.
 *
 * Mirrors `resolveWorkBuddyConnection`: the named connection when one is named, else the first
 * ENABLED row (the account the router reaches first), else the first row.
 */
export function selectWorkBuddyQuotaAccount(
  accounts: readonly WorkBuddyPoolQuotaAccount[],
  cid?: string | null
): WorkBuddyPoolQuotaAccount | undefined {
  const named = typeof cid === "string" ? cid.trim() : "";
  if (named !== "") return accounts.find((account) => account.cid === named);
  return accounts.find((account) => account.active) ?? accounts[0];
}
