/**
 * workBuddyCreditProbe — the promotion rule behind `WorkBuddyPoolCreditBadge`, kept pure so it
 * can be pinned without a DOM.
 *
 * `GET /api/workbuddy/credits?detail=fast` is the snapshot-only read: the first paint never
 * waits on a billing endpoint, and an account with no snapshot answers `pending: 1` /
 * `status: "unknown"` (never a fabricated `0`). That is right for a first paint and wrong as a
 * resting state — the snapshot is only warmed by a FULL probe, so a card that asks for the fast
 * view and stops sits at "Credits unknown" forever. The badge therefore promotes itself once
 * per connection: when the fast body carries no verdict, it repeats the request without
 * `detail=fast` (the route's default full probe) and renders that answer instead.
 *
 * This module holds the decision only. The component holds the fetch, the single-promotion
 * memo and the in-flight guard; the route holds what a full probe costs.
 */

/** The fields of one pool row the promotion rule reads. */
export interface WorkBuddyCreditProbeAccount {
  status?: string;
  total?: number | null;
}

/** The fields of one edition the promotion rule reads. */
export interface WorkBuddyCreditProbeEdition {
  /**
   * How many accounts the fast read could not answer for. The route writes a COUNT (`pending: 1`),
   * not a boolean, so the check is truthiness — `0`, `false` and an absent field all mean "the
   * snapshot answered for every row".
   */
  pending?: number | boolean;
  accounts?: readonly WorkBuddyCreditProbeAccount[];
}

/** The fields of the credits body the promotion rule reads. */
export interface WorkBuddyCreditProbeBody {
  editions?: readonly WorkBuddyCreditProbeEdition[];
}

/**
 * Whether a `detail=fast` body has no verdict for at least one account, so the badge should
 * make ONE full probe.
 *
 * Promotion is driven by the absence of evidence, never by a negative answer: `status: "error"`
 * is an answer (the billing read failed and its diagnosis is worth showing), and an edition
 * with no rows is a connection problem the probe cannot settle. `pending: 1`, an account
 * whose status is `"unknown"`, and a status that is simply absent are the states only a full
 * probe can turn into a balance.
 */
export function needsWorkBuddyFullCreditProbe(
  body: WorkBuddyCreditProbeBody | null | undefined
): boolean {
  const editions = body?.editions;
  if (!Array.isArray(editions) || editions.length === 0) return false;
  return editions.some((edition) => {
    if (edition?.pending) return true;
    const accounts = edition?.accounts;
    if (!Array.isArray(accounts) || accounts.length === 0) return false;
    return accounts.some((account) => account.status === undefined || account.status === "unknown");
  });
}
