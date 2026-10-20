/**
 * WorkBuddy addon — per-connection exclusion windows (pool state).
 *
 * The credits table needs one fact the upstream cannot give it: "this account is parked"
 * (out of credit, dead sign-in, rate limited). The fork wrote that from its request path, which
 * this port deliberately does NOT ship (plan §D5/§12: no failure classification, no fallback
 * stack) — so the writer here is **off by default** and the module is primarily a READER for
 * `poolQuota`'s exclusions column.
 *
 * Design points, each with a reason:
 *
 *  1. **One small JSON document under the app's data directory.** The state is a handful of rows
 *     per operator, so SQLite (and a migration) would be overkill, and the file is
 *     readable/diagnosable by an operator with `cat`.
 *  2. **Atomic replace, mode 0600, no symlink follow.** A torn write would make the next read
 *     see "nothing excluded" and re-send to a dead account; the temp-file + rename pair makes
 *     the document either fully old or fully new. The file names accounts (not tokens), but it
 *     is operator-private data, so it is created 0600 under a 0700 dir.
 *  3. **Fail-open everywhere.** A missing, unreadable, malformed or version-mismatched file all
 *     mean "nothing measured yet" — a state the pool renders as a candidate, never as an error.
 *  4. **The writer is behind `WORKBUDDY_POOL_STATE=1` (default `0`).** Plan §C3/§R4: the image
 *     must never create files on the data volume unless an operator asked for it. A write
 *     attempt while disabled is a silent no-op that reports `undefined`, never a throw.
 *
 * Trimmed from `fork src/lib/workbuddy/poolState.ts:1-453`: the failure-kind vocabulary, the
 * merge rule and the sync critical section all belonged to the executor path that is not
 * ported; the document shape stays compatible with the fork's so a volume written by the fork
 * still reads here.
 *
 * @module lib/workbuddy/poolState
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveDataDir } from "@/lib/dataPaths";

/** File name inside the app's data directory. */
export const WORKBUDDY_POOL_STATE_FILE = "workbuddy-pool-state.json";

/** Bumped only when the on-disk shape changes incompatibly; unknown versions read empty. */
export const WORKBUDDY_POOL_STATE_VERSION = 1;

/** One connection's exclusion window. */
export interface WorkBuddyAccountExclusion {
  /** Connection id this window belongs to (repeated inside the record so a reader can
   * understand a row without its key). */
  connectionId: string;
  /** Operator-facing reason (`out-of-credit`, `credential-rejected`, `rate-limited`, …). */
  reason: string;
  /**
   * Epoch ms the connection may be tried again.
   *
   * `null` = indefinitely (a dead sign-in); `undefined` = no window was stated, so the record
   * does not exclude anything by itself.
   */
  retryDueMs?: number | null;
  /** When this record was last written (epoch ms). */
  updatedAt: number;
}

/** On-disk document. */
export interface WorkBuddyPoolStateDocument {
  version: number;
  exclusions: Record<string, WorkBuddyAccountExclusion>;
}

/** Absolute path of the pool-state document (exported for diagnostics/tests). */
export function workBuddyPoolStatePath(): string {
  return path.join(resolveDataDir(), WORKBUDDY_POOL_STATE_FILE);
}

/**
 * Whether this process may WRITE the document.
 *
 * Read per call, not cached: the image ships with the writer off (§R4) and an operator who
 * flips the switch should not have to rebuild the bundle. `"1"` is the only enabling value —
 * anything else (unset, `""`, `"true"`, `"0"`) keeps the data volume untouched, which is the
 * conservative reading of an off-by-default writer.
 */
export function workBuddyPoolStateWriterEnabled(): boolean {
  return (process.env.WORKBUDDY_POOL_STATE ?? "0").trim() === "1";
}

function emptyDocument(): WorkBuddyPoolStateDocument {
  return { version: WORKBUDDY_POOL_STATE_VERSION, exclusions: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read one record, rejecting anything the writer would not have produced. */
function readExclusion(connectionId: string, value: unknown): WorkBuddyAccountExclusion | null {
  if (!isRecord(value)) return null;
  const reason = typeof value.reason === "string" && value.reason !== "" ? value.reason : null;
  const updatedAt =
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : null;
  if (reason === null || updatedAt === null) return null;

  const rawDue = value.retryDueMs;
  let retryDueMs: number | null | undefined;
  if (rawDue === null) retryDueMs = null;
  else if (typeof rawDue === "number" && Number.isFinite(rawDue)) retryDueMs = rawDue;
  else retryDueMs = undefined;

  return {
    connectionId,
    reason,
    ...(retryDueMs === undefined ? {} : { retryDueMs }),
    updatedAt,
  };
}

/**
 * Read the document. The open uses `O_NOFOLLOW`: if something planted a symlink at our path,
 * following it would make us read (and later write) outside the data directory.
 */
function readDocument(): WorkBuddyPoolStateDocument {
  const target = workBuddyPoolStatePath();
  // A cheap stat before the open: the common case on a healthy install is "no file yet".
  try {
    if (!fs.existsSync(target)) return emptyDocument();
  } catch {
    return emptyDocument();
  }
  let raw: string;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    raw = fs.readFileSync(descriptor, "utf8");
  } catch {
    return emptyDocument();
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // ignore — the read already finished or failed
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDocument();
  }
  if (!isRecord(parsed)) return emptyDocument();
  if (parsed.version !== WORKBUDDY_POOL_STATE_VERSION) return emptyDocument();
  if (!isRecord(parsed.exclusions)) return emptyDocument();

  const exclusions: Record<string, WorkBuddyAccountExclusion> = {};
  for (const [cid, value] of Object.entries(parsed.exclusions)) {
    const record = readExclusion(cid, value);
    if (record !== null) exclusions[cid] = record;
  }
  return { version: WORKBUDDY_POOL_STATE_VERSION, exclusions };
}

/**
 * Atomically replace the document, best effort.
 *
 * Temp file in the SAME directory (a rename across filesystems is not atomic), created 0600
 * with `O_EXCL` before anything is written, fsynced, then renamed over the target. A failure
 * is swallowed on purpose: the caller is an operator surface, and losing one measurement is
 * strictly better than failing a request that already succeeded.
 */
function writeDocument(document: WorkBuddyPoolStateDocument): void {
  const target = workBuddyPoolStatePath();
  let temporary: string | undefined;
  let descriptor: number | undefined;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    );
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    temporary = undefined;
  } catch {
    // Best effort: see the doc comment.
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // ignore
      }
    }
    if (temporary !== undefined) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // ignore — nothing was created, or the rename already consumed it
      }
    }
  }
}

/** Whether a record still excludes its connection at `nowMs`. */
function isActive(record: WorkBuddyAccountExclusion, nowMs: number): boolean {
  if (record.retryDueMs === undefined) return false;
  if (record.retryDueMs === null) return true;
  return nowMs < record.retryDueMs;
}

/** Drop windows that have elapsed; indefinite and future ones stay. */
function pruneExpired(
  exclusions: Record<string, WorkBuddyAccountExclusion>,
  nowMs: number
): Record<string, WorkBuddyAccountExclusion> {
  const kept: Record<string, WorkBuddyAccountExclusion> = {};
  for (const [cid, record] of Object.entries(exclusions)) {
    if (record.retryDueMs !== undefined && isActive(record, nowMs)) kept[cid] = record;
  }
  return kept;
}

function normalizeConnectionId(cid: unknown): string | null {
  if (typeof cid !== "string") return null;
  const trimmed = cid.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The raw document with only ACTIVE windows, for pool readers.
 *
 * Exported under this name because the quota table (`./poolQuota`) probes the sibling module
 * for exactly this shape and renders each active `cid -> reason` as an `excluded` row without
 * spending an upstream billing read on it.
 */
export function getWorkBuddyPoolState(nowMs: number = Date.now()): WorkBuddyPoolStateDocument {
  try {
    const document = readDocument();
    return {
      version: WORKBUDDY_POOL_STATE_VERSION,
      exclusions: pruneExpired(document.exclusions, nowMs),
    };
  } catch {
    return emptyDocument();
  }
}

/**
 * Active exclusions as `connectionId -> reason` (the flat shape a pool row wants).
 *
 * Deliberately loses `retryDueMs`: a table that needs the countdown reads
 * {@link workBuddyAccountExclusion} for that row instead of re-deriving it from a string.
 */
export function getWorkBuddyPoolExclusions(nowMs: number = Date.now()): Record<string, string> {
  const exclusions: Record<string, string> = {};
  for (const [cid, record] of Object.entries(getWorkBuddyPoolState(nowMs).exclusions)) {
    exclusions[cid] = record.reason;
  }
  return exclusions;
}

/**
 * Read one connection's ACTIVE exclusion window.
 *
 * `undefined` means "this connection is a candidate": no record, no window stated, or the
 * window has elapsed.
 */
export function workBuddyAccountExclusion(
  cid: string,
  nowMs: number = Date.now()
): WorkBuddyAccountExclusion | undefined {
  const connectionId = normalizeConnectionId(cid);
  if (connectionId === null) return undefined;
  try {
    const record = readDocument().exclusions[connectionId];
    if (record === undefined || !isActive(record, nowMs)) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

/**
 * Record a failure window for one connection.
 *
 * **No-op unless `WORKBUDDY_POOL_STATE=1`** (§R4). The signature keeps the fork's
 * `(cid, reason, retryDueMs)` shape so a future executor can call it without a rewrite; today
 * nothing in this port does, which is why the default is off rather than merely unused.
 */
export function recordWorkBuddyAccountFailure(
  cid: string,
  reason: string,
  retryDueMs?: number | null
): WorkBuddyAccountExclusion | undefined {
  if (!workBuddyPoolStateWriterEnabled()) return undefined;
  const connectionId = normalizeConnectionId(cid);
  if (connectionId === null) return undefined;
  const update: WorkBuddyAccountExclusion = {
    connectionId,
    reason: reason.trim() || "failed",
    ...(retryDueMs === undefined ? {} : { retryDueMs }),
    updatedAt: Date.now(),
  };
  try {
    const document = readDocument();
    const next: WorkBuddyPoolStateDocument = {
      version: WORKBUDDY_POOL_STATE_VERSION,
      exclusions: pruneExpired(
        { ...document.exclusions, [connectionId]: update },
        update.updatedAt
      ),
    };
    writeDocument(next);
    // Return what the document actually holds: a record whose only window had already
    // elapsed is pruned on write and is therefore NOT an exclusion.
    return next.exclusions[connectionId];
  } catch {
    return undefined;
  }
}

/**
 * Forget one connection's window (the operator re-authenticated it, or a request for it
 * succeeded). Returns whether a record was actually removed. Same writer gate as above.
 */
export function clearWorkBuddyAccountExclusion(cid: string): boolean {
  if (!workBuddyPoolStateWriterEnabled()) return false;
  const connectionId = normalizeConnectionId(cid);
  if (connectionId === null) return false;
  try {
    const document = readDocument();
    if (document.exclusions[connectionId] === undefined) return false;
    const exclusions = { ...document.exclusions };
    delete exclusions[connectionId];
    writeDocument({ version: WORKBUDDY_POOL_STATE_VERSION, exclusions });
    return true;
  } catch {
    return false;
  }
}

/** Pure helpers exposed for the unit tests; not part of the module's public contract. */
export const __testing = {
  isActive,
  pruneExpired,
  emptyDocument,
};
