"use client";

/**
 * WorkBuddyCreditBadge — the credit-rate badge on a WorkBuddy model row.
 *
 * WorkBuddy bills each model as a multiplier of the account's credit meter, and the upstream
 * declares it per model (`"x0.00 credits"` … `"x0.79 credits"`). The one number an operator
 * actually needs while picking a model is that rate, so the row states it in full.
 *
 * Rendered ONLY for this addon's providers, and ONLY when a rate is known: an absent rate means
 * the upstream said nothing, and a badge would turn "unknown" into a price claim. The formatting
 * and tier rules live in the shared helper so the catalogue mapping and this badge cannot drift
 * apart.
 *
 * Ported from `fork .../components/WorkBuddyCreditBadge.tsx:1-64`. The two tooltip strings are
 * deliberately literals: the addon owns no message keys (a new key would have to land in every
 * `src/i18n/messages/*.json`, plan §9/R11), and they are diagnostic text, not a product label.
 */

import {
  formatWorkBuddyCreditBadge,
  isWorkBuddyProviderId,
  workBuddyPriceTier,
} from "@/shared/utils/workBuddyCredit";

export interface WorkBuddyCreditBadgeProps {
  /** Provider id of the row (canonical id or short alias). */
  provider?: string | null;
  /** Rate declared by the upstream catalogue; absent when discovery carried none. */
  creditMultiplier?: number | null;
}

export function WorkBuddyCreditBadge({ provider, creditMultiplier }: WorkBuddyCreditBadgeProps) {
  if (!isWorkBuddyProviderId(provider)) return null;
  const label = formatWorkBuddyCreditBadge(creditMultiplier);
  if (label === null) return null;

  const free = workBuddyPriceTier(creditMultiplier) === "free";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
        free
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : "border-border bg-black/[0.02] dark:bg-white/[0.03] text-text-muted"
      }`}
      title={
        free
          ? "Upstream declares this model at x0.00 credits — it bills nothing"
          : "Upstream credit rate per request, as declared by the catalogue"
      }
    >
      {label}
    </span>
  );
}

export default WorkBuddyCreditBadge;
