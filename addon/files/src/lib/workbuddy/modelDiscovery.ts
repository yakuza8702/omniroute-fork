/**
 * WorkBuddy addon — model discovery mapping and cache invalidation.
 *
 * Wave 2 created this module with only the two functions the reasoning contract needed
 * ({@link providerToWorkBuddyProviderId} and {@link invalidateWorkBuddyModelCaches}); wave 3
 * completes the **mapping half** the plan assigned to §C3:
 *
 *   - {@link workBuddyModelPriceTier} — the free/paid/unknown classification of one entry;
 *   - {@link workBuddyModelsToSyncedInput} — catalogue entries → synced-catalogue rows, with
 *     the credit rate and its derived `isFree` verdict carried through in full;
 *   - {@link fetchWorkBuddySyncModels} — the same mapping over a live `/v3/config` read, for a
 *     caller that wants to write the roster itself.
 *
 * Note what is deliberately absent: no route calls {@link fetchWorkBuddySyncModels}. Upstream's
 * generic discovery entry already fetches **and** persists this provider's roster
 * (`providerModelsConfig.ts` + `route.ts:396-415`, plan §D2), and wave 1 enriched the
 * normalizer that path runs through, so a second fetcher would only duplicate the request.
 * The mapping exists because it is the *contract* the generic path must agree with — it is
 * exercised by the normalizer tests and available to an operator tool — not because the sync
 * route needs a shortcut around the platform.
 *
 * The sync route may not import an executor directly (the route layer owns the service layer,
 * not the wire layer), so the invalidation is surfaced here and the executor is loaded lazily —
 * the same shape the fork used, and the reason that one is `async`.
 *
 * Ported from `fork src/lib/workbuddy/modelDiscovery.ts:27-146`, collapsed to the single
 * edition (no `workbuddy-global` branch, per plan §D1).
 *
 * @module lib/workbuddy/modelDiscovery
 */

import { credentialFromWorkBuddyConnection } from "./accounts";
import { fetchWorkBuddyModels } from "./upstream";
import { WORKBUDDY_PROVIDER_ALIAS, WORKBUDDY_PROVIDER_ID, type WorkBuddyModel } from "./types";
import type { SyncedAvailableModelInput } from "@/lib/db/models/synced";
import { workBuddyPriceTier, type WorkBuddyPriceTier } from "@/shared/utils/workBuddyCredit";

export type { WorkBuddyPriceTier };

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

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
 * Price tier of one discovered model: `"free"` iff the declared rate is exactly 0, `"paid"` for
 * a positive rate, `"unknown"` when the upstream declared none.
 *
 * Exposed next to the mapping (rather than only inline) so a caller can classify a model it
 * already holds without re-deriving the free rule.
 */
export function workBuddyModelPriceTier(
  model: Pick<WorkBuddyModel, "creditMultiplier">
): WorkBuddyPriceTier {
  return workBuddyPriceTier(model.creditMultiplier);
}

/**
 * Map a WorkBuddy catalogue onto synced-catalogue rows.
 *
 * Tokens: `maxInputTokens` is imported AS-IS into both the context window and the input limit —
 * no down-scoping here. The upstream's number is the account's real ceiling, and a lower value
 * applied at import time would be indistinguishable from a provider that genuinely has a
 * smaller window; the request-time chain may still `min()` it later.
 *
 * A rate of `0` is the ONLY free verdict (plan §D4). An absent rate is omitted, never written
 * as `false`, because `false` would assert "this bills" where the upstream simply said nothing.
 */
export function workBuddyModelsToSyncedInput(
  models: readonly WorkBuddyModel[]
): SyncedAvailableModelInput[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    source: "api-sync",
    apiFormat: "chat-completions",
    contextWindow: model.contextLength,
    outputTokenLimit: model.maxOutputTokens,
    inputTokenLimit: model.contextLength,
    ...(model.supportsVision === undefined ? {} : { supportsVision: model.supportsVision }),
    // `supportsImages` is an IMAGE-INPUT claim, so it is carried twice: as the capability flag
    // and as the input-type list the cache/vision surfaces read. Declared false means text-only
    // rather than "unknown"; absent means the upstream said nothing at all.
    ...(model.supportsVision === true ? { supportedInputTypes: ["text", "image"] } : {}),
    ...(model.supportsVision === false ? { supportedInputTypes: ["text"] } : {}),
    ...(model.supportsToolCall === undefined ? {} : { supportsTools: model.supportsToolCall }),
    ...(model.reasoning?.supportedEfforts === undefined
      ? {}
      : { supportedThinkingEfforts: model.reasoning.supportedEfforts }),
    ...(model.reasoning?.defaultEffort === undefined
      ? {}
      : { defaultThinkingEffort: model.reasoning.defaultEffort }),
    // The rate itself is carried (nullability is the schema's job), so the dashboard can show
    // the price instead of a bare free/paid bit, and `isFree` stays derived from the ONE rule:
    // exactly 0 is free.
    ...(model.creditMultiplier === undefined ? {} : { creditMultiplier: model.creditMultiplier }),
    ...(model.creditMultiplier === undefined
      ? {}
      : { isFree: workBuddyPriceTier(model.creditMultiplier) === "free" }),
    ...(model.descriptionEn === undefined && model.descriptionZh === undefined
      ? {}
      : { description: model.descriptionEn ?? model.descriptionZh }),
  }));
}

/**
 * Fetch the live catalogue for a connection, ready for the synced-catalogue write.
 *
 * Throws with a bounded message when the connection carries no credential or the upstream
 * refuses — a caller turns that into a 401/502 without echoing the upstream body. Not called by
 * the sync route: the platform's generic discovery entry owns the fetch (see the module header),
 * so this exists for an operator tool and for the contract tests.
 */
export async function fetchWorkBuddySyncModels(
  providerId: string,
  connection: unknown
): Promise<SyncedAvailableModelInput[]> {
  const resolvedProviderId = providerToWorkBuddyProviderId(providerId);
  if (!resolvedProviderId) throw new Error(`Not a WorkBuddy provider: ${providerId}`);

  const credential = credentialFromWorkBuddyConnection(asRecord(connection));
  if (!credential) {
    throw new Error("WorkBuddy connection has no access token — sign the account in again");
  }

  const models = await fetchWorkBuddyModels(credential);
  return workBuddyModelsToSyncedInput(models);
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
