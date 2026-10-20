"use client";

/**
 * WorkBuddyPoolCreditBadge — remaining-credit strip for one WorkBuddy connection row.
 *
 * WorkBuddy is absent from `USAGE_SUPPORTED_PROVIDERS`, so `supportsProviderQuota()` is false for
 * it and the Provider Quota panel never renders a card (plan §C4). This badge is therefore the
 * ONLY credits surface on the connection row, and it is inserted OUTSIDE the
 * `quotaPanelSupported` gate.
 *
 * The first paint asks the pool endpoint for `detail=fast`, which is a snapshot read with **no
 * upstream traffic** — a page with ten connections costs zero billing calls. Clicking the refresh
 * action repeats the same request with `refresh=1`, which is the explicit "re-read the billing
 * endpoint" path. An empty snapshot is rendered as `unknown`, never as a zero balance: a
 * fabricated `0` would read as "out of credits".
 *
 * Figures are wire-shaped by `GET /api/workbuddy/credits` (`src/app/api/workbuddy/credits/route.ts`).
 */

import { useCallback, useEffect, useState } from "react";

interface PoolAccountRow {
  cid: string | null;
  label?: string;
  status?: "ok" | "error" | "excluded" | "unknown";
  total?: number | null;
  expiringSoon?: number | null;
  nearestExpiry?: string | null;
  error?: string;
  diagnosis?: string;
  excludedBy?: string | null;
  pending?: boolean;
  stale?: boolean;
  cached?: boolean;
}

interface CreditsResponse {
  ok?: boolean;
  detail?: "full" | "fast";
  editions?: Array<{ accounts?: PoolAccountRow[]; pending?: number; error?: string }>;
}

type View =
  | { kind: "loading" }
  | { kind: "unknown"; reason: "pending" | "excluded" | "empty"; detail?: string }
  | { kind: "error"; message: string; diagnosis?: string }
  | {
      kind: "ok";
      total: number;
      expiringSoon: number;
      nearestExpiry: string | null;
      stale: boolean;
    };

export interface WorkBuddyPoolCreditBadgeProps {
  /** Connection row id — the badge answers for exactly this account. */
  connectionId?: string | null;
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatExpiry(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Pull the requested account out of the pool body (falls back to the only row). */
function pickAccount(body: CreditsResponse, connectionId: string | null): PoolAccountRow | null {
  const accounts = body.editions?.[0]?.accounts ?? [];
  if (connectionId) {
    const named = accounts.find((account) => account.cid === connectionId);
    if (named) return named;
  }
  return accounts.length === 1 ? accounts[0] : null;
}

function toView(body: CreditsResponse, connectionId: string | null): View {
  const account = pickAccount(body, connectionId);
  if (account === null) return { kind: "unknown", reason: "pending" };
  if (account.status === "excluded") {
    return { kind: "unknown", reason: "excluded", detail: account.excludedBy ?? undefined };
  }
  if (account.status === "error") {
    return {
      kind: "error",
      message: account.error || "Could not read credits.",
      diagnosis: account.diagnosis,
    };
  }
  if (account.status !== "ok" || typeof account.total !== "number") {
    return { kind: "unknown", reason: "pending" };
  }
  return {
    kind: "ok",
    total: account.total,
    expiringSoon: account.expiringSoon ?? 0,
    nearestExpiry: account.nearestExpiry ?? null,
    stale: account.stale === true,
  };
}

export function WorkBuddyPoolCreditBadge({ connectionId }: WorkBuddyPoolCreditBadgeProps) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!connectionId) {
        setView({ kind: "unknown", reason: "empty" });
        return;
      }
      const params = new URLSearchParams({
        all: "true",
        detail: "fast",
        connectionId,
      });
      if (refresh) params.set("refresh", "1");
      try {
        const response = await fetch(`/api/workbuddy/credits?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          setView({
            kind: "error",
            message:
              response.status === 404 ? "No WorkBuddy connection." : "Could not read credits.",
          });
          return;
        }
        const body = (await response.json()) as CreditsResponse;
        setView(toView(body, connectionId));
      } catch {
        setView({ kind: "error", message: "Could not read credits." });
      }
    },
    [connectionId]
  );

  useEffect(() => {
    const run = async () => {
      await load(false);
    };
    void run();
  }, [load]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const expiry = view.kind === "ok" ? formatExpiry(view.nearestExpiry) : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-sidebar/30 px-2.5 py-1.5 text-[11px]">
      <span className="material-symbols-outlined text-sm text-text-muted">payments</span>
      <span className="font-medium text-text-main">Credits</span>
      {view.kind === "loading" && <span className="text-text-muted">…</span>}
      {view.kind === "unknown" && (
        <span
          className="text-text-muted"
          title={
            view.reason === "excluded"
              ? `Excluded from the pool: ${view.detail ?? "policy"}`
              : "No credits snapshot yet — refresh to read the billing endpoint"
          }
        >
          unknown
        </span>
      )}
      {view.kind === "error" && (
        <span className="text-red-500" title={view.diagnosis ?? view.message}>
          unavailable
        </span>
      )}
      {view.kind === "ok" && (
        <>
          <span className="text-text-main">{formatCredits(view.total)}</span>
          {expiry && <span className="text-text-muted">· next expiry {expiry}</span>}
          {view.expiringSoon > 0 && (
            <span className="text-amber-500">
              · {formatCredits(view.expiringSoon)} expiring soon
            </span>
          )}
          {view.stale && <span className="text-text-muted">· stale</span>}
        </>
      )}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={refreshing}
        className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-muted hover:bg-sidebar hover:text-primary disabled:opacity-40"
        title="Refresh credits from the billing endpoint"
        aria-label="Refresh WorkBuddy credits"
      >
        <span className={`material-symbols-outlined text-sm ${refreshing ? "animate-spin" : ""}`}>
          refresh
        </span>
      </button>
    </div>
  );
}

export default WorkBuddyPoolCreditBadge;
