/**
 * WorkBuddy addon — provider identity and cache invalidation for the sync path.
 *
 * Why this module exists at all (wave-2 resolution of an ambiguity in the plan): wave 1 did
 * **not** add `src/lib/workbuddy/modelDiscovery.ts` — the fork's discovery adapter
 * (`workBuddyModelsToSyncedInput`, `fetchWorkBuddySyncModels`, the credit tier mapping) is
 * DEFERRED to wave 3, because upstream's generic discovery entry
 * (`providerModelsConfig.ts`, `route.ts:396-415`) already fetches and persists the roster
 * (plan §D2). What the reasoning contract DOES need from the fork's module is the pair the
 * sync route calls after a write, so 0002 adds exactly that pair and nothing more:
 *
 *   - {@link providerToWorkBuddyProviderId} — the guard the route branches on, so a sync of
 *     any other provider pays neither a cache read nor an executor import;
 *   - {@link invalidateWorkBuddyModelCaches} — drops the executor's per-provider ladder
 *     cache after the synced rows changed (fork `modelDiscovery.ts:142-146`).
 *
 * The sync route may not import an executor directly (the route layer owns the service
 * layer, not the wire layer), so the invalidation is surfaced here and the executor is
 * loaded lazily — the same shape the fork used, and the reason this is `async`.
 *
 * @module lib/workbuddy/modelDiscovery
 */

import { WORKBUDDY_PROVIDER_ALIAS, WORKBUDDY_PROVIDER_ID } from "./types";

/**
 * Provider id → the id this addon's synced catalogue is stored under, or `null` for any
 * other provider.
 *
 * Both the canonical id and the short alias are accepted, because the executor map
 * registers both spellings (plan §B4) and a sync that silently did nothing would look like
 * an empty catalogue rather than a routing mistake. There is no `workbuddy-global` branch:
 * this addon serves exactly one edition and `workbuddy` IS the global one upstream (plan
 * §D1) — the fork's second id would be a new provider, not an alias.
 */
export function providerToWorkBuddyProviderId(providerId: string): string | null {
  const id = (providerId ?? "").trim().toLowerCase();
  if (id === WORKBUDDY_PROVIDER_ID || id === WORKBUDDY_PROVIDER_ALIAS) {
    return WORKBUDDY_PROVIDER_ID;
  }
  return null;
}

/**
 * Drop the executor's cached thinking ladders for this addon.
 *
 * A successful sync replaces the synced rows, but the request path reuses each provider's
 * ladder for 15 s (`open-sse/executors/workbuddyReasoning.ts`). Without this the catalogue
 * an operator just synced would keep rejecting (or accepting) `reasoning_effort` for up to
 * a TTL — so the sync route calls this once the write lands.
 *
 * Fail-open: an executor that cannot be loaded means there is no cache to drop, which is
 * never a reason to fail a sync that already succeeded.
 */
export async function invalidateWorkBuddyModelCaches(): Promise<void> {
  try {
    const { resetWorkBuddyReasoningContractCache } =
      await import("@omniroute/open-sse/executors/workbuddyReasoning.ts");
    resetWorkBuddyReasoningContractCache();
  } catch {
    // No executor graph in this process (e.g. an isolated unit test) — nothing to drop.
  }
}
