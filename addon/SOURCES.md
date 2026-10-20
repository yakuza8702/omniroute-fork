# SOURCES.md — what every overlay file was rebased from

The addon is not a copy of the fork: the fork (`/workspace/Omniroute-fork/omniroute-workbuddy`,
uncommitted diff off `1d6d1483`) was written against a tree that predates 3.8.53 and carries a
**two-edition** provider (`workbuddy` = CN, `workbuddy-global` = global). Upstream 3.8.53
(`e9cb075cf6db161661b01f5dde2a1f0b033f7660`) already registers `workbuddy` as the **global**
edition, and every deployed data volume holds connection rows and synced-cache keys under that
id. This overlay therefore keeps **one** edition and rebases each fork file onto the upstream
anchors instead of transplanting the fork's id mapping.

Citation convention: `path:lines` is relative to the overlay target (the upstream checkout);
`fork <path>:lines` is relative to the fork repository.

## New files (`addon/files/` — copied verbatim by `overlay.sh`)

| Fork source | Destination | Rebase notes |
|---|---|---|
| `src/lib/workbuddy/types.ts:1-333` | `src/lib/workbuddy/types.ts` | **Rewritten, not copied.** One edition (`WORKBUDDY_EDITIONS` = the global entry, `providerId: "workbuddy"`, `configPath: "/v3/config"`, `catalogUserAgent: "WorkBuddy/5.5.2"`, `supportsCheckin: false`). The CN constants (`WORKBUDDY_CN_*`, `WORKBUDDY_MODELS_PATH`, check-in paths), `WorkBuddyCredential`/credits/check-in types and the region resolvers were dropped because nothing in this port uses them (single edition, no desktop import, no check-in) — they are listed under DEFERRED. Added the D9 gate `workBuddyAddonEnabled()` (server-only) and `isWorkBuddyProviderId()` (client-safe), per plan §A1. `WORKBUDDY_GLOBAL_PROVIDER_ID` is gone: `resolveWorkBuddyEdition` accepts `workbuddy`/`wb` only. **Wave 3 (§C3) added the read-side contract this module had trimmed away**: `WorkBuddyCredential`, `WorkBuddyCreditPackage`, `WorkBuddyCredits`, `WORKBUDDY_CONNECTION_KEYS`, and the gateway resolvers (`resolveWorkBuddyGlobalBase` / `workBuddyChatBase` / `workBuddyBillingBase`). Those resolvers have NO domestic branch: an unknown/empty domain falls back to `www.workbuddy.ai`, which is correct only because the addon serves one edition (D1). The check-in types stay out (DEFERRED). |
| `src/lib/workbuddy/upstream.ts:281-390` (parser cluster) | `src/lib/workbuddy/upstream.ts` | Trimmed to the **pure parsers**: `parseWorkBuddyCreditMultiplier`, `isSingularWorkBuddyEffortForm`, `parseWorkBuddyReasoning`, `parseWorkBuddyModel` (strict, unchanged semantics), plus the **new** `parseWorkBuddyModelLoose` (§A3/R8: keeps an entry whose token limits are absent, returns `contextLength`/`maxOutputTokens` = 0 and lets the caller omit the window). The I/O half of the fork file (envelope reads, fetch, credits, check-in, token refresh) is still not ported. **Wave 2 appended the reasoning half to this same copied file**: `WORKBUDDY_THINKING_LADDER` / `WorkBuddyEffortLevel` / `WorkBuddyReasoningContract`, `canonicalEffortWord`, `declaredEffortLadder`, `requestedThinking`, `clampToLadder` and `normalizeWorkBuddyReasoning` — a line-for-line port of `fork upstream.ts:890-1058` including the `ultra`/`maximum`→`max`, `minimum`→`minimal` and `off`/`disabled`/`false`→`none` canonicalizations, because an effort override is validated against the wider vocabulary (`shared/reasoning/reasoningEffortsOverride.ts` adds `ultra`). **Wave 3 (§C3) appended the READ half** — `WorkBuddyUpstreamError`/`WorkBuddyEmptyCatalogError`, `readWorkBuddyEnvelope`, `buildWorkBuddyBillingHeaders`, `selectWorkBuddyCatalogModels`, `foldWorkBuddyCreditPackages`, `fetchWorkBuddyModels` and `fetchWorkBuddyCredits` (fork `upstream.ts:48-140,405-684`). This half IS I/O (network) and throws only bounded, sanitized errors; the parsers above stay pure. Not ported: chat-body shaping, token refresh, check-in and failure classification (DEFERRED). |
| `src/lib/workbuddy/addonInfo.ts:1-259` | `src/lib/workbuddy/addonInfo.ts` | **Minimal** description of the shipped surface only (catalogue, credits, chat, this description). Dropped: the CN/`workbuddy-global` provider rows, the desktop credential-source scan, the check-in capability and the two-edition guarantees — advertising a capability the addon refuses to perform is worse than saying nothing. `WORKBUDDY_ADDON_PROVIDER_IDS` now has just `{ global }`. |
| — | `tests/unit/workbuddy-normalizer.test.ts` | New (plan §9 T2). |
| — | `tests/unit/workbuddy-managed-import.test.ts` | New (plan §9 T3). |
| — | `tests/unit/workbuddy-synced-credit.test.ts` | New (plan §9 T4). |
| `src/lib/workbuddy/modelDiscovery.ts:27-40,142-146` (identity + invalidation only) | `src/lib/workbuddy/modelDiscovery.ts` | **Resolved in wave 2, minimal by design.** Wave 1 did not add the fork's discovery adapter (the mapping half is DEFERRED to wave 3 — upstream's generic discovery entry already fetches and persists, plan §D2). What B5 needs from that module is the pair the sync route calls after a write, so this file carries exactly `providerToWorkBuddyProviderId()` (single edition: `workbuddy`/`wb` → `workbuddy`, everything else `null`; no `workbuddy-global` branch) and `invalidateWorkBuddyModelCaches()` (lazy `import()` of the executor's cache reset, fork `modelDiscovery.ts:142-146`, fail-open). **Wave 3 completed the mapping half**: `workBuddyModelPriceTier`, `workBuddyModelsToSyncedInput` (catalogue → synced rows, rate + derived `isFree` carried in full) and `fetchWorkBuddySyncModels` (fork `:27-146`). No route calls the fetcher — upstream's generic discovery entry still owns the fetch and persist (§D2); the mapping is the contract that path must agree with. |
| `src/lib/workbuddy/accounts.ts:47-69,258-324` (connection half only) | `src/lib/workbuddy/accounts.ts` | Trimmed to `credentialFromWorkBuddyConnection`, `isWorkBuddyConnectionActive`, `listWorkBuddyConnections` (platform preference order preserved), `resolveWorkBuddyConnection` / `...ById` and `describeWorkBuddyConnection`. Dropped: the desktop-file scan, the import payload builder, the probe/health writer and the pool-park clear (all DEFERRED, plan §12). |
| `src/lib/workbuddy/freeModel.ts:1-89` | `src/lib/workbuddy/freeModel.ts` | Verbatim: `selectWorkBuddyFreeModel` (largest window wins; `undefined` is NOT free), `listWorkBuddyFreeModels`, `rankWorkBuddyModelsByCost`, `describeWorkBuddyFreeModel`. |
| `src/lib/workbuddy/poolQuota.ts:1-732` (trimmed) | `src/lib/workbuddy/poolQuota.ts` | Single edition. Keeps the 10-minute snapshot TTL (`WORKBUDDY_QUOTA_SNAPSHOT_TTL_MS`), per-connection in-flight dedupe (`batchFor`), `Promise.allSettled` per-account isolation, `diagnoseWorkBuddyFailure`, `invalidateWorkBuddyQuotaSnapshot` and `selectWorkBuddyQuotaAccount`. ADDED a `deps` seam (`WorkBuddyPoolProbeDeps`: `listConnections`/`readCredits`) so T6 can drive the engine without a database — production never passes it. Dropped: the multi-edition loop, the shape-walking pool-state reader (replaced by one typed sibling call) and the check-in invalidation call. |
| `src/lib/workbuddy/poolState.ts:1-453` (reader + gated writer) | `src/lib/workbuddy/poolState.ts` | The document shape is fork-compatible (`version` + `cid → {connectionId, reason, retryDueMs, updatedAt}`), the read uses `O_NOFOLLOW` and is fail-open, the write is atomic (0600 + rename). Trimmed: the failure-kind vocabulary and the merge rule belonged to the executor path this port does not ship. **The writer is off by default**: `workBuddyPoolStateWriterEnabled()` is true only for `WORKBUDDY_POOL_STATE=1` (plan §C3/§R4), so the image never creates files on the data volume unless asked. |
| `src/shared/utils/workBuddyCredit.ts:27-78` | `src/shared/utils/workBuddyCredit.ts` | Verbatim and client-safe (no DB, no env): `isWorkBuddyProviderId`, `declaredWorkBuddyCreditMultiplier`, `workBuddyPriceTier`, `formatWorkBuddyCreditBadge`. |
| — (new) | `src/shared/utils/workBuddyEfforts.ts` | The override vocabulary = INTERSECTION of the gateway ladder (adds `minimal`) and the override parser (adds `ultra`): `none, low, medium, high, xhigh, max` (plan §6/R7), plus parse/serialize/toggle/format helpers. |
| `src/app/api/workbuddy/_lib.ts:1-216` | `src/app/api/workbuddy/_lib.ts` | Single edition, `requireManagementAuth` guard, sanitized error bodies, edition/account resolution, credit shaping. Dropped: the `loopbackOnly` claim (these routes are management-authenticated, not loopback-only) and the accounts/import/checkin route table. |
| `src/app/api/workbuddy/models/route.ts`, `free-model/route.ts` | same paths | Verbatim shape, single-edition copy ("Unknown provider. Use workbuddy."). |
| `src/app/api/workbuddy/credits/route.ts:1-302` | `src/app/api/workbuddy/credits/route.ts` | Same query surface (`?all`, `?detail=fast`, `?refresh`, `?connectionId`), served through the pool engine so the single-account read shares the snapshot. |
| `src/app/api/workbuddy/info/route.ts:1-55` | `src/app/api/workbuddy/info/route.ts` | `describeWorkBuddyAddon()` + a network-free connection count; the deferred routes are absent from the route table. |
| `.../components/WorkBuddyCreditBadge.tsx:1-64` | `.../components/WorkBuddyCreditBadge.tsx` | Verbatim. Renders nothing unless the provider is this addon's AND a rate is declared. |
| — (new) | `.../components/WorkBuddyPoolCreditBadge.tsx` | Plan §C4 badge: first paint is `?all=true&detail=fast` (snapshot only, zero upstream calls), the refresh action repeats with `?refresh=1`, `unknown` is never rendered as `0`. |
| — (new) | `.../components/WorkBuddyReasoningEffortEditor.tsx` | Plan §6 effort editor: draft seeded on OPEN (no setState-in-effect), six-level vocabulary, Save → PATCH, Clear → DELETE. |
| — (new) | `.../hooks/useModelContextOverrides.ts` | The `CompatibleModelsSection` read/save pair lifted into a hook for the passthrough section (plan §6). |
| — | `tests/unit/workbuddy-credit.test.ts` | New (plan §9 T1): tier, caption, declared-rate reader and the id gate. |
| — | `tests/unit/workbuddy-pool-quota.test.ts` | New (plan §9 T6): TTL reuse, `detail=fast` never fetches, `refresh` bypass, `allSettled` isolation of a dead token, exclusions, single-connection scoping, account selection. |
| — | `tests/unit/workbuddy-catalog-projection.test.ts` | New (plan §9 T7): `toDiscoveryCatalogModel` carries `creditMultiplier`/`isFree`, omits both when there is no claim, and leaves the pre-existing projection byte-identical. |
| — | `tests/unit/workbuddy-reasoning.test.ts` | New (plan §9 T5). Twelve cases: the pure ladder rule (strip / clamp up / off→`none` / off→floor / unknown word / `thinking` never forwarded), the override-first contract (B2, incl. the bulk-map path and connection-scoped row precedence), the single-edition id mapping, and B3/B4 wiring (both map keys resolve to `WorkBuddyExecutor`; the wire body is clamped end-to-end; the D9 gate leaves the body untouched). |

Tests live under `addon/files/tests/unit/` on purpose: `overlay.sh` copies them into the
checkout's `tests/unit/`, which is the only location the repo's harness globs
(`package.json` → `test:unit`). A `tests/` directory in the fork-ci repository would never be
compiled or run.

## Modified files (`addon/patches/0001-workbuddy-enrichment.patch`)

| Upstream anchor | Change | Fork origin |
|---|---|---|
| `src/app/api/providers/[id]/models/discovery/normalizers.ts:349-372` | `normalizeWorkbuddyModelsResponse` now emits an **enriched** record (`context_length`, `max_input_tokens`, `max_output_tokens`, `supportsVision`, `supportsTools`, `supportsThinking` + `supportedThinkingEfforts`/`defaultThinkingEffort`, `creditMultiplier`/`isFree`, `description`, preview-only `tags`). Media exclusion and the id drop are untouched; the parse is `parseWorkBuddyModelLoose`. | plan §A3; fork `upstream.ts:344-390` |
| `src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts:961-968` | `"user-agent": "WorkBuddy/5.5.2"` added to the `workbuddy` discovery headers (desktop channel; the CLI channel omits the free `x0.00` tier). | plan §A2; fork `upstream.ts:78-88`, `addonInfo.ts:100-110` |
| `src/lib/providerModels/modelDiscovery.ts:686-687`, `:741` | Forward a declared `creditMultiplier` into the explicit row rebuild; `isFree` is derived from it and beats the `-free`-suffix heuristic. | plan §A4; fork `db/models/synced.ts:67-81` |
| `src/lib/db/models/synced.ts:38`, `:76-95`, `:159-161` | `creditMultiplier?: number` field; read-path rule (rate decides `isFree`; unparsable rate drops the claim; absent rate keeps the legacy bit verbatim, `false` included); write path copies the field. | plan §A5; fork `db/models/synced.ts:33`, `:67-85`, `:126-127` |
| `src/app/api/providers/[id]/models/discovery/catalogModels.ts:11-23` | `toDiscoveryCatalogModel` passes `creditMultiplier` and a positive `isFree` through to the preview projection. | plan §A6 |
| `src/app/(dashboard)/dashboard/providers/[id]/hooks/useModelImportHandlers.ts:284-296` | The manual "add custom model" POST body forwards the raw discovery window (`context_length` → `max_input_tokens`) and `max_output_tokens`. | plan §A7 |
| `tests/unit/workbuddy-provider.test.ts:386-417` | The "real catalogue entry, fields and all" pin asserted the OLD id/name/owned_by-only projection; it now asserts the enriched record. Every other assertion in that file reads single fields, so it was already enrichment-tolerant. | consequence of §A3 |

## Modified files (`addon/patches/0002-workbuddy-reasoning.patch` — wave 2, Feature B)

| Upstream anchor | Change | Fork origin |
|---|---|---|
| — (new file) | `open-sse/executors/workbuddyReasoning.ts` — the contract resolver: `resolveWorkBuddyReasoningContract({provider, model, connectionId, bulkEffortOverrides?})`, the 15 s per-provider row cache and `resetWorkBuddyReasoningContractCache()`. Reads the synced rows through `getSyncedAvailableModelsByConnection` and maps provider → synced ids **collapsed to the single `workbuddy` id** (D1: no `workbuddy-global` branch, no `cn`/`global` words). | fork `open-sse/executors/workbuddyReasoning.ts:1-157`; plan §B1 |
| — (new file) | **B2 override-first**: before any row lookup, `getReasoningEffortsOverride(provider, modelId, bulk)` (`src/lib/db/modelCapabilityOverrides.ts:132-153`) is consulted for every candidate model id (the request id, its `/`-leaf, and the base id with a `-<tier>` suffix stripped) and a non-empty result short-circuits to `{ supportedEfforts: [...override] }`. The optional `bulkEffortOverrides` parameter takes the pre-loaded snapshot map so the capability path adds no query; on the null-bulk path the helper does the same direct SQL read `modelCapabilities.ts:1021-1024` uses. `set`/`remove` already invalidate the `"model-capabilities"` cache (`:182`/`:199`), and because the override is read **before** the cached rows it is visible on the very next request — no TTL wait. | plan §B2/D6 |
| — (new file) | `open-sse/executors/workbuddy.ts` — thin `WorkBuddyExecutor extends DefaultExecutor`, overriding only `transformRequest`: `super.transformRequest(...)`, then the D9 gate `workBuddyAddonEnabled()`, then `normalizeWorkBuddyReasoning(out, contract)`. Nothing else is ported: no headers, no URL selection, no failure classification, no fallback stack (D5). | fork `open-sse/executors/workbuddy.ts` (transport half **not** ported); plan §B3 |
| `open-sse/executors/index.ts:169-171` | Two lazy keys added in map order next to the CodeBuddy family: `workbuddy: () => import("./workbuddy.ts").then((m) => new m.WorkBuddyExecutor())` and `wb: …` (alias). `getExecutor` already falls back to `DefaultExecutor`, so nothing else changes. | plan §B4 |
| `src/app/api/providers/[id]/sync-models/route.ts:24-31, 641-656` | After `await importManagedModels(...)` and guarded by `providerToWorkBuddyProviderId(logProvider)`, `await invalidateWorkBuddyModelCaches()`. The 15 s ladder cache is dropped the moment the rows change, so a just-synced ladder is honoured immediately; other providers pay one string compare. The helper is fail-open. | fork `src/app/api/providers/[id]/sync-models/route.ts` (guarded form is the plan's §B5 wording); plan §B5 |
| `tests/snapshots/executors/executor-map.json` (frozen golden) | `keyCount` 140 → 142, plus the two entries `{"className":"WorkBuddyExecutor","provider":"workbuddy","configSource":"workbuddy"}`; `sharedInstances` unchanged (each key keeps its own instance). Regenerated with `UPDATE_GOLDEN=1` against the overlaid tree, **not** hand-edited. | plan §B4; §9 matrix row for `executor-map-golden.test.ts` |
| `src/lib/workbuddy/upstream.ts` (copied file, not a patch) | The reasoning half is appended to the wave-1 copy — see the "New files" row above. | fork `upstream.ts:890-1058` |
| `addon/overlay.sh` (governance) | Twelve post-condition markers added for 0002 (executor class, ladder export, override read, cache reset, both map keys, sync-route call, golden snapshot, T5 file), so a patch that applies but stops short fails the build. | plan §2 ("assert every post-condition marker") |

## Modified files (`addon/patches/0003-workbuddy-credits-ui.patch` — wave 3, Feature C)

| Upstream anchor | Change | Fork origin |
|---|---|---|
| `.../components/ModelRow.tsx:263-264`, `:377` | `ModelRowProps.model` gains `creditMultiplier?: number`; the row renders `<WorkBuddyCreditBadge provider={provider} creditMultiplier={model.creditMultiplier} />` immediately after `ModelSourceBadge`. The badge gates itself on the provider id and on a declared rate, so every other provider renders byte-identically. | plan §C2; fork `ModelRow.tsx` (badge insertion only — the fork's layout rewrite is **not** ported) |
| `.../components/PassthroughModelRow.tsx:23-60`, `:246-256` | New `creditMultiplier?: number | null` prop, rendered after `ModelSourceBadge` inside the tag row. | plan §C2 |
| `.../components/PassthroughModelsSection.tsx:236-244`, `:272`, `:317-324`, `:452-512` | The row type carries `creditMultiplier`, both row builders attach `declaredWorkBuddyCreditMultiplier(row)`, and the JSX threads it into the row. **No new filter code**: `isModelFreeBadge`'s strict path already consumes the discovery row's `isFree` (now rate-derived by 0001), so `freeFilter`/`sortFreeFirst` become correct without a second predicate. | plan §C2/D4 |
| `.../components/CompatibleModelsSection.tsx:252`, `:281`, `:324`, `:564-623` | Same mapping (`declaredWorkBuddyCreditMultiplier`) and the row already receives `provider={providerStorageAlias}`; `supportsVision` threading is untouched. | plan §C2 |
| `.../components/ConnectionRow.tsx:837-847` | `<WorkBuddyPoolCreditBadge connectionId={connection.id} />` inserted **outside** the `quotaPanelSupported` gate (workbuddy is absent from `USAGE_SUPPORTED_PROVIDERS` and is not an `openai-compatible-*` id, so the Provider Limits panel never renders a card for it). | plan §C4 |

## Modified files (`addon/patches/0004-workbuddy-capability-ui.patch` — wave 3, Feature D)

| Upstream anchor | Change | Fork origin |
|---|---|---|
| `.../components/PassthroughModelsSection.tsx` (state after `:148`; JSX `:452-512`) | Threads `contextWindowOverride` + `onSaveContextWindowOverride` + `savingContextOverride` (via the new `useModelContextOverrides` hook), `supportsVision` + `onSaveSupportsVision`, and the WorkBuddy-only effort props (`reasoningEfforts`, `onSaveReasoningEfforts`, `onClearReasoningEfforts`, `savingReasoningEfforts`). Loads ctx/vision from `GET /api/provider-models?provider=` and efforts from `GET /api/model-capability-overrides` (client-side filter by `${providerId}/` prefix). | plan §6; no fork equivalent (the fork predates the upstream override APIs) |
| `.../components/PassthroughModelRow.tsx` | New optional props: `onSaveSupportsVision`/`savingVision` render a small eye toggle next to the vision badge, and `onSaveReasoningEfforts`/`onClearReasoningEfforts`/`reasoningEfforts`/`savingReasoningEfforts` mount `WorkBuddyReasoningEffortEditor`. Absent handlers leave the row unchanged, so compat callers behave exactly as before. | plan §6 |
| `addon/overlay.sh` (governance) | Eight post-condition markers added for 0003/0004 (credit helper, discovery mapping, pool probe, credits route, the ConnectionRow badge, the effort vocabulary, the section's effort wiring, the row's vision toggle) — 24 → 32 assertions. | plan §2 |

### Deliberate deviations from the plan text (reported, not silent)

**Wave 1:**


1. **§A3 emits the window conditionally.** The plan's snippet writes
   `context_length: m.contextLength` unconditionally; with the loose parse that would publish
   `0` for a limit-less entry. The record therefore omits the window fields when the parsed
   limit is not positive, which is what §R8 ("enrichment leaves `context_length` absent → the
   existing fallback applies") actually requires.
2. **§A7 forwards the window under the wire name the API accepts.** `providerModelMutationSchema`
   (`src/shared/validation/schemas/provider.ts:275-313`) has `max_input_tokens` /
   `max_output_tokens` and no `context_length` key — Zod would strip a literal `context_length`
   and the import would still lose the window. The raw `context_length` is mapped onto
   `max_input_tokens`.
3. **§A5 writes `isFree: false` back.** The fork's write path emitted only `isFree: true`
   (`...(freeFlag ? … : {})`), which would launder upstream's explicit paid verdict
   (`modelDiscovery.ts:687` `explicitlyPaid`) into "unknown" on the next load. The read path
   here keeps `false` when nothing overrides it, which is also what §8's round-trip
   (`write 0.03 → { isFree: false }`) asserts.
4. **The existing catalogue pin moved with the projection.** `tests/unit/workbuddy-provider.test.ts:416`
   asserted `deepEqual(models, [{id,name,owned_by}])`; with the enriched record that assertion is
   false by construction, so `0001` updates it to the enriched shape (the plan's §9 test matrix
   does not list the pre-existing file). Leaving it would have made the source build's test gate
   red for the exact change the plan asks for.
5. **`supportsVision: false` is a claim, the synced row is not tri-state.** A catalogue entry
   that says `supportsImages: false` yields `supportsVision: false` in the discovery record (the
   preview projection can show it) but the synced row keeps upstream's positive-only rule, so
   the row has no vision flag. Pinned in T2 so either side changing is visible.

**Wave 2:**

6. **The two new executor modules travel INSIDE `0002`, not in `addon/files/`.** Wave 1's rule is
   "new files are copied verbatim, existing files are patched"; wave 2 states the deliverable as a
   patch that *adds* `workbuddyReasoning.ts` and `workbuddy.ts`, so they are added-file diffs. The
   split is deliberate and documented rather than accidental: `git apply --check` then covers them
   too, so a re-run of the overlay fails closed on them as well (proved in the transcript), and the
   B1–B5 surface is reviewable as one artifact.
7. **The golden *test* file is unchanged; the golden *snapshot* is what moved.** The task text
   describes `tests/unit/executor-map-golden.test.ts:36-49` as if it pinned the map literal. It does
   read the literal — but it extracts the keys dynamically and compares against
   `tests/snapshots/executors/executor-map.json` via `goldenSnapshot()`. Adding assertions there
   would be an addon-specific assertion inside an upstream characterization lock, so the snapshot is
   updated instead (regenerated, never hand-written), and the two new keys are additionally asserted
   from the addon's own T5 file (`hasSpecializedExecutor("workbuddy"|"wb")`, instance per key).
8. **Both map keys construct the class with the CANONICAL provider id.** `new m.WorkBuddyExecutor()`
   defaults to `workbuddy` for the `wb` key as well, because the registry entry that supplies
   `baseUrl`/`forceStream` and the synced-catalogue key the ladder is read from are both keyed by
   `workbuddy`; an instance reporting `wb` would resolve neither. The alias key exists for routing,
   not for a second provider identity. The golden snapshot records `provider: "workbuddy"` for both
   keys, and T5 pins it.
9. **`transformRequest` guards the non-object body.** The plan's snippet passes `out` straight to
   `normalizeWorkBuddyReasoning`, which destructures it; on a string/array/`null` body that would
   fabricate an object. One guard line returns such a body untouched (the method is typed
   `unknown`), and the addon-off test exercises the same path.
10. **B5's import resolved to a NEW minimal `lib/workbuddy/modelDiscovery.ts`.** 0001 did not add the
    fork's discovery adapter (it is DEFERRED to wave 3), so there was no existing file to extend.
    The new module carries only the provider-id mapping and the lazy invalidation call — no discovery
    mapping, no upstream fetch (§C3 owns those).
11. **`Dockerfile.source` needed no migration copy.** Verified in the upstream tree rather than
    assumed: `scripts/build/assembleStandalone.mjs:304` lists
    `{ label: "migrations", src: ["src","lib","db","migrations"], dest: ["migrations"] }` in
    `EXTRA_MODULE_ENTRIES`, and `Dockerfile:284-291` states the same ("migrations land at
    <standalone>/migrations via assembleStandalone"). The runner stage already copies the whole
    standalone tree and sets `OMNIROUTE_MIGRATIONS_DIR=/app/migrations`, so the runtime contract is
    identical to the prebuilt image and no line was added. No deviation from the plan — the plan's
    §7.2 sketch ("mount migrations from <standalone>/migrations") is what actually happens.

**Wave 3:**

12. **The discovery mapping lives in the COPIED module, not in a patch hunk.** The task text says to
    "extend the wave-2 minimal module upstream-side via patch". `src/lib/workbuddy/modelDiscovery.ts`
    is not an upstream file: wave 2 created it by copying `addon/files/`, and wave 2's own deviation
    #10 established that extension-by-append happens in the copy (`upstream.ts`'s reasoning half).
    Patching a file the overlay re-copies on every run would also make that one hunk silently
    re-applicable on a re-run, unlike every other patch — so the mapping half was appended to the
    copy and is covered by a post-condition marker plus the type gate instead. Everything else in
    `0003`/`0004` is a patch against a genuine upstream file.
13. **The overlay preflight is now CUMULATIVE (index-based), not per-patch `--check`.** From wave 3
    on, a later patch builds on an earlier one (0004 edits the same two components 0003 touched), so
    checking every patch against the unpatched work tree false-fails a correct series — observed on
    the first oracle run (`0004 … patch does not apply`). The preflight replays the series against a
    throwaway `GIT_INDEX_FILE` seeded from `HEAD`, using `git apply --cached`: the work tree is still
    never touched before every patch has been accepted, and the first rejection still aborts with
    "nothing was applied". Because the replay models the work tree as `HEAD`, a checkout with tracked
    modifications is refused UP FRONT (`git diff --quiet HEAD --`), which is also what makes a
    re-run fail closed with a clear message instead of dying inside the apply phase.
14. **`WorkBuddyReasoningEffortEditor` seeds its draft on OPEN, not from an effect.** The obvious
    `useEffect(() => setDraft(selected))` is rejected by the repo's `react-hooks/set-state-in-effect`
    rule (and by React's own guidance). The editor therefore seeds the draft in the click that opens
    it; the saved value stays the source of truth between edits, and every save closes the panel.
15. **The vision affordance is a two-state toggle, not a tri-state menu.** The PUT accepts
    `true | false | null`, but a visible toggle that sometimes silently clears is worse than one that
    always states a value. Clearing remains available through the compat override reset surface that
    already exists for custom rows; the toggle never writes `null` itself. Documented rather than
    hidden, because the plan's wording ("small eye toggle") left the clear gesture open.
16. **`useModelContextOverrides` duplicates one stable pattern instead of rewriting
    `CompatibleModelsSection`.** That component already had the fetch/save pair inline; the plan
    offers "lift into providerPageHelpers **or** a `useModelContextOverrides` hook". The hook is
    added and used by the passthrough section; the compat component keeps its inline copy for this
    wave (rewriting a working, unrelated component is not part of the deliverable, and the two copies
    differ only in where the toast is raised). A follow-up can collapse them.
17. **Pool reads are made testable through a `deps` seam.** `probeWorkBuddyPoolCredits` accepts
    `deps.listConnections`/`deps.readCredits`, defaulting to the real modules. The harness isolates
    `DATA_DIR` but has no connection rows, so T6 could not otherwise exercise TTL reuse, `detail=fast`
    or `allSettled` isolation without writing fixtures into the DB. Production passes nothing.
18. **`poolState.ts` is shipped as a reader with a DISABLED writer.** The fork's writer is called by
    its executor/failure path, which this port deliberately does not ship (§D5), so shipping the
    writer enabled would create a file on the data volume that no code path can justify. The writer
    no-ops unless `WORKBUDDY_POOL_STATE=1` (§R4), and the document shape stays fork-compatible so a
    volume written by the fork still reads here.
19. **No new i18n keys were added.** The plan says new keys must land in all 67
    `src/i18n/messages/*.json` files. The credits badge and the two editors therefore use literal
    diagnostic strings (like the fork's own badge) and reuse the existing keys that do exist
    (`contextWindowOverrideLabel`/`Hint`/`Invalid`, `freeBadge`, `visionCapableLabel`,
    `savedModelEndpointSettings`) via `providerText(t, key, fallback)`. Nothing new to translate, and
    the parity gates cannot regress.
20. **The credits pool route serves the single-account read too.** The plan's `?all` table and the
    single-account body share one engine, so a single-account poll reuses the same 10-minute snapshot
    instead of hitting the billing endpoint per request; the single-account body keeps its old field
    names. This is the fork's own design, kept because it makes the C4 badge cheap.
21. **`http 401` token rejection is reported, not rewritten.** `editionError` derives `connected`
    from the diagnosis (`auth_rejected` ⇒ false); a dead token therefore answers `connected: false`
    with `diagnosis: "auth_rejected"` instead of the fork's earlier "connected but failed" body.

## DEFERRED (plan §12 — explicitly out of this port)

* **CN edition + `workbuddy-global` provider id.** Needs a *new* id, not a rename: `workbuddy`
  is the global edition upstream (D1) and is already written into live connection rows, synced
  cache keys and the provider registry.
* **Desktop account scan / `api/workbuddy/{accounts,import,checkin}`.** State-mutating and
  filesystem-reading; also the only consumer of the fork's `accounts.ts`, `credentials.ts` and
  the check-in paths.
* **Fork executor failure classification + `accountFallback.ts` pool parking** (fork diff: 236
  lines). `0002` ships only the thin `WorkBuddyExecutor` (reasoning ladder on top of
  `DefaultExecutor`); the fork's `execute()` override, its `workBuddyFailure` signal, the
  cooldown/fallback-state modules and the `accountFallback.ts` parking stay out (plan §D5).
* **The fork's discovery ADAPTER as a route input.** The mapping itself now ships
  (`workBuddyModelPriceTier`, `workBuddyModelsToSyncedInput`, `fetchWorkBuddySyncModels`), but no
  route calls the fetcher: upstream's generic discovery entry already fetches and persists the
  roster (§D2), and the sync route only invalidates the ladder cache. Wiring a second fetch path in
  would duplicate the request without changing what the catalogue stores.
* **`prepareWorkBuddyChatBody`'s non-reasoning rules.** Upstream's registry entry already
  carries `forceStream`, `strictChatHistory` and `bodyStringReplacements`
  (`open-sse/config/providers/registry/workbuddy/index.ts`), so re-applying them would
  double-shape the body.
* **Fork's `GET /models` workbuddy branch and the v4 `C2` stream force.** Obsolete in 3.8.53:
  the generic discovery entry already fetches and persists, and
  `opencodeFreeTierContract.ts` already sets `stream: true`.
* **`addonInfo.ts`'s check-in surface, `credentials.ts`, and the three mutating routes.** Wave 3
  shipped the read-only surface (`models`, `credits`, `free-model`, `info`); account import,
  check-in and the desktop credential scan remain out (§12).
* **`WORKBUDDY_POOL_STATE` writes.** The pool-state READER ships (so a fork-written document still
  explains an excluded account), and the writer exists behind `WORKBUDDY_POOL_STATE=1`, but nothing
  in this port calls it: the failure path that produced those records is the fork executor that
  §D5 keeps out.

## Provenance / rebase procedure

1. Take the fork file, read only the named line ranges.
2. Re-derive every import from the upstream module it now lives next to (no `workbuddy-global`
   alias survives).
3. Apply the change as a *patch against the cited anchor*, then prove it with
   `git apply --check` on a pristine `3.8.53` checkout **before** it is committed here.
4. Re-run `bash addon/overlay.sh <checkout>`: `overlay ok` means every anchor still exists and
   every post-condition marker is in place.

## Verification performed for wave 1 (not a promise — the transcript is in the hand-off)

| Check | Command | Result |
|---|---|---|
| Patch applies | `bash addon/overlay.sh /workspace/pkgtest_scratch6` on a pristine `3.8.53` copy | `overlay ok — 1 patch(es), 6 file(s)`, 12 post-condition assertions passed, exit 0 |
| Fail-closed | same command a second time | exit 1, `git apply --check` rejected every hunk, `nothing was applied` |
| Unit tests | `node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-*.test.ts tests/unit/workbuddy-provider.test.ts` in the overlaid checkout | 44/44 pass (T2 7, T3 3, T4 6, pre-existing workbuddy 28) |
| Typecheck | `tsc -p <scoped tsconfig: addon files + touched modules + the three new tests>` | exit 0 |
| Regression | pre-existing `tests/unit/workbuddy-provider.test.ts` | green with the updated catalogue pin |

The typecheck used the dependency tree of the fork checkout (this repo has no `node_modules`),
so it is a *scoped* typecheck, not the full `npm run typecheck:core` matrix. The full matrix runs
in CI once the source image is built (plan §9 gates).

## Verification performed for wave 2 (not a promise — the transcript is in the hand-off)

| Check | Command | Result |
|---|---|---|
| Both patches apply | `bash addon/overlay.sh /workspace/pkgtest_scratch7` on a fresh pristine `3.8.53` copy (`rsync` + `git init`, `/workspace/pkgtest_scratch7`) | `overlay: applied 0001-workbuddy-enrichment.patch`, `overlay: applied 0002-workbuddy-reasoning.patch`, **24 post-condition assertions passed**, `overlay ok — 2 patch(es), 8 file(s)`, exit 0 |
| Fail-closed | same command a second time | exit 1: `0001 … does not apply cleanly` (7 hunks), `0002 … does not apply cleanly` (both added files already exist + 3 hunks), `2 patch(es) failed git apply --check; nothing was applied` |
| Unit tests (T5 + golden + wave-1 suite) | `node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-reasoning.test.ts tests/unit/workbuddy-{normalizer,managed-import,synced-credit,provider}.test.ts tests/unit/executor-map-golden.test.ts tests/unit/executor-registry.test.ts` in the overlaid tree | **63/63 pass**, exit 0 (T5 12, T2 7, T3 3, T4 6, pre-existing workbuddy 33, golden 2, registry 6) |
| open-sse typecheck gate (CI-real) | `node scripts/check/check-open-sse-typecheck.mjs` | `openSseTypecheckErrors=0`, `OK — 0 pre-existing error(s), all within frozen baseline`, exit 0 |
| Core typecheck gate | `npm run typecheck:core` | exit 0 |
| Scoped project typecheck | `tsc -p tsconfig.wb-wave2.json` (new executor modules + touched route/modules + T5) | 13 diagnostics, **byte-identical to the pristine worktree baseline** with the pre-existing subset (`diff` of the two error sets is empty); none in an addon or touched file |
| Addon modules under `strict` | `tsc -p tsconfig.wb-pure-strict.json` (`types`/`upstream`/`modelDiscovery`, `strict: true`), filtered to addon paths | no diagnostics in `src/lib/workbuddy/**` or `open-sse/executors/workbuddy*` |
| Naming / gates | `grep -rn` of the overlaid tree | `workBuddyAddonEnabled()` has exactly one call site outside its definition: `open-sse/executors/workbuddy.ts:60` (the executor path). `workbuddy-global` has **no executable branch**: the only hits are prose comments, one `addonInfo.ts` disclaimer string, and the T5 assertion that the id maps to `null` |

The 63-test run borrowed the fork checkout's `node_modules` via a symlink and pointed `TMPDIR` at
the workspace disk, exactly as wave 1 did (`/workspace/.tmp_wave2`). No commit was made in this
repository for wave 2.

## Verification performed for wave 3 (not a promise — the transcript is in the hand-off)

| Check | Command | Result |
|---|---|---|
| Full series applies | `bash addon/overlay.sh /workspace/pkgtest_scratch9` on a fresh pristine `3.8.53` copy (`rsync` + `git init`) | `overlay: preflight passed for 4 patch(es)`, `overlay: applied 0001…0004`, **32 post-condition assertions passed**, `overlay ok — 4 patch(es), 26 file(s)`, exit 0 |
| Fail-closed | same command a second time | `overlay: preflight passed for 4 patch(es)` then exit **1** with `patch does not apply` for 0001's hunks; nothing was applied to the work tree |
| Unit tests (T1–T7 + pre-existing + golden) | `node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-*.test.ts tests/unit/executor-map-golden.test.ts tests/unit/executor-registry.test.ts` | **96/96 pass**, exit 0 — T1 10, T6 10, T7 4, T2 7, T3 3, T4 6, T5 12, pre-existing workbuddy 28, gateway-compliance 9, golden 2, registry 5 |
| open-sse typecheck gate (CI-real) | `node scripts/check/check-open-sse-typecheck.mjs` | `openSseTypecheckErrors=0`, `OK — 0 pre-existing error(s), all within frozen baseline`, exit 0 |
| Core typecheck gate | `npm run typecheck:core` | exit 0 |
| Dashboard typecheck gate | `npm run check:dashboard-typecheck` | `OK — 196 pre-existing error(s), all within frozen baseline`, exit 0 (the touched dashboard files reduced the frozen baseline: `CompatibleModelsSection.tsx TS2741 2 → 0`) |
| Scoped project typecheck | `tsc --pretty false -p tsconfig.wb-wave3.json` (all wave-3 modules, routes, components, hook, T1/T6/T7 + the 5 patched components) | 38 diagnostics, **all of them pre-existing classes** also counted by the dashboard gate; filtered to the touched paths the count is **0** |
| Route smoke (module load + envelopes) | four handlers invoked in-process with a plain `Request` inside the overlaid tree (`info`, `models`, `credits`, `free-model`, plus the pool/404 query paths) | `info` 200 (`ok:true`, contract version 1.0.0), the other three 200 with `connected:false` bodies (`No WorkBuddy account is connected…`); `?all=true&detail=fast` 200 with an empty pool and `cached:true`; `?all=true&detail=fast&connectionId=does-not-exist` **404** `connection_not_found`; `?all=true` 200 `detail:"full"` |
| Format / lint | `prettier --check` (repo config) over every touched file, `eslint` over every ADDED module/component/route/test | clean. The only prettier warning is the pre-existing dirty `addon/files/src/lib/workbuddy/addonInfo.ts` (wave-1 file, intentionally untouched). ESLint reports 6 errors, all **pre-existing** in upstream files (verified by linting the pristine copies: `PassthroughModelRowProps`/`CompatByProtocolMap`/`testProgress`/`e` unused, `cliproxyapiEnabled`/`onToggleCliProxyapiMode` unused) |

The 96-test run borrowed the fork checkout's `node_modules` via a symlink and pointed `TMPDIR` at
`/workspace/.tmp_wave3` (the host `/tmp` is a 2 GB tmpfs and was full), exactly as waves 1–2 did.
No commit was made in this repository for wave 3.
