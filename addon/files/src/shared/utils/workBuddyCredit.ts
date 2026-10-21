/**
 * WorkBuddy addon — credit-rate surface shared by the catalogue mapping and the dashboard.
 *
 * WorkBuddy prices a model as a MULTIPLIER of the account's credit meter, which the upstream
 * spells as a `credits` string (`"x0.03 credits"`, `"x0.00 credits"`). Exactly one value is
 * load-bearing: `0` is the upstream's own statement that the model bills nothing. Anything
 * else is a paid rate, and an absent rate is UNKNOWN — never "free", and never a guessed
 * number.
 *
 * This module is pure and dependency-free on purpose: the synced-catalogue mapping
 * (`src/lib/workbuddy/modelDiscovery.ts`, server) and the model-list badge
 * (`ModelRow` / `PassthroughModelRow`, client) both import it, so the two can never
 * disagree about which models are free — and the client bundle never has to pull in the
 * DB-touching workbuddy modules.
 *
 * Ported from `fork src/shared/utils/workBuddyCredit.ts:27-78`, verbatim except for the
 * single-edition note on the id gate. No DB import, no `process.env`, no React.
 *
 * @module shared/utils/workBuddyCredit
 */

/** Price classification of one model, as the upstream declared it. */
export type WorkBuddyPriceTier = "free" | "paid" | "unknown";

/**
 * Whether a provider id (canonical or short alias, either edition) belongs to this addon.
 *
 * Kept here rather than imported from `lib/workbuddy/types` because the dashboard component
 * renders badges on the client and that module is the server-side contract module.
 */
export function isWorkBuddyProviderId(providerId: string | undefined | null): boolean {
  const id = (providerId ?? "").trim().toLowerCase();
  if (id === "") return false;
  // Canonical ids (and any future `<canonical>-<edition>` spelling) plus the short
  // aliases the registry accepts. Bare region words ("cn"/"global") belong to the
  // edition resolver, not to a provider id — accepting them here made every provider
  // literally named "cn" or "global" render this addon's badges.
  return id === "wb" || id === "wbg" || id === "workbuddy" || id.startsWith("workbuddy-");
}

/**
 * Read the declared rate off a catalogue/synced row.
 *
 * Absent, non-numeric, non-finite and negative values all mean "no declared rate" — the same
 * rule the synced-store normalizer applies, so a malformed claim never reaches a badge.
 */
export function declaredWorkBuddyCreditMultiplier(row: unknown): number | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = (row as { creditMultiplier?: unknown }).creditMultiplier;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Classify a declared credit multiplier.
 *
 * `"free"` requires the multiplier to be EXACTLY `0` — the same rule the upstream applies.
 * A negative or non-finite value is `"unknown"` rather than free, because a malformed rate
 * is missing evidence, not a discount.
 */
export function workBuddyPriceTier(
  creditMultiplier: number | null | undefined
): WorkBuddyPriceTier {
  if (typeof creditMultiplier !== "number" || !Number.isFinite(creditMultiplier)) return "unknown";
  if (creditMultiplier < 0) return "unknown";
  return creditMultiplier === 0 ? "free" : "paid";
}

/**
 * Badge caption for a model list row: `"free (0.00x)"`, `"paid (0.03x)"`, or `null`.
 *
 * `null` means "render nothing": an unknown rate must not become a badge, because a badge
 * is read as a price claim and "unknown" is not one the upstream made.
 */
export function formatWorkBuddyCreditBadge(
  creditMultiplier: number | null | undefined
): string | null {
  if (typeof creditMultiplier !== "number") return null;
  const tier = workBuddyPriceTier(creditMultiplier);
  if (tier === "unknown") return null;
  return `${tier} (${creditMultiplier.toFixed(2)}x)`;
}

/**
 * Which connection a Provider Quota card should carry a credits strip for, or `null` (wave 5).
 *
 * WorkBuddy is not a quota provider: it is absent from `USAGE_SUPPORTED_PROVIDERS`, so
 * `supportsProviderQuota()` answers false and the Provider Quota panel used to drop the
 * connection from the page entirely. Its credit meter is the only budget it has, so the card is
 * admitted by this predicate instead — and the same call supplies the badge's `connectionId`.
 *
 * Returning the id (not a boolean) is deliberate: the gate and the badge argument are then one
 * decision, so a card can never render with an empty strip or a strip with no card. An id is
 * trimmed and required: without it the pool endpoint (`?connectionId=`) would probe every
 * connection the instance has, which is a billing call per account the operator never asked for.
 */
export function workBuddyCreditsForDisplay(
  connection: { provider?: unknown; id?: unknown } | null | undefined
): string | null {
  if (!connection) return null;
  const providerId = typeof connection.provider === "string" ? connection.provider : "";
  if (!isWorkBuddyProviderId(providerId)) return null;
  const connectionId = typeof connection.id === "string" ? connection.id.trim() : "";
  return connectionId.length > 0 ? connectionId : null;
}

/**
 * Whether the Provider Quota panel may issue the generic per-connection usage fetch
 * (`GET /api/usage/{id}`) for a provider (wave 6).
 *
 * WorkBuddy has no usage backend: the route answers `400 {"error":"Usage not available for this
 * connection"}`, and the panel renders that string as a red error banner on the card — a card
 * whose only real meter is the pooled credit strip beneath it. Its quota is reported by
 * `GET /api/workbuddy/credits` (the pool snapshot), so the generic fetch is not merely useless
 * there, it *is* the bug. Every other provider keeps the fetch.
 *
 * The gate is this module's own family predicate rather than `lib/workbuddy/types`, because it
 * is the same predicate the card is admitted by ({@link workBuddyCreditsForDisplay}): one family
 * definition for both halves, so a card can never be admitted while its usage fetch still fires.
 *
 * Fails open for unknown values on purpose — dropping a live usage card is worse than an error
 * line for a provider id this list has never seen.
 */
export function shouldFetchUsage(providerId: unknown): boolean {
  return !isWorkBuddyProviderId(typeof providerId === "string" ? providerId : null);
}
