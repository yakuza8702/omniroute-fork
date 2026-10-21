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
| `src/shared/utils/workBuddyCredit.ts:27-78` | `src/shared/utils/workBuddyCredit.ts` | Verbatim and client-safe (no DB, no env): `isWorkBuddyProviderId`, `declaredWorkBuddyCreditMultiplier`, `workBuddyPriceTier`, `formatWorkBuddyCreditBadge`. **Wave 5** appended `workBuddyCreditsForDisplay(connection)` — the Provider Quota admission gate that returns the connection id to probe (family match + non-empty id) or `null`, so admitting a card and scoping its badge are one decision. **Wave 6** appended `shouldFetchUsage(providerId)` — the complement of that gate for the card's usage fetch (`GET /api/usage/{id}` answers 400 for this provider); see `0010`. |
| — (new) | `src/shared/utils/workBuddyEfforts.ts` | The override vocabulary = INTERSECTION of the gateway ladder (adds `minimal`) and the override parser (adds `ultra`): `none, low, medium, high, xhigh, max` (plan §6/R7), plus parse/serialize/toggle/format helpers. |
| `src/app/api/workbuddy/_lib.ts:1-216` | `src/app/api/workbuddy/_lib.ts` | Single edition, `requireManagementAuth` guard, sanitized error bodies, edition/account resolution, credit shaping. Dropped: the `loopbackOnly` claim (these routes are management-authenticated, not loopback-only) and the accounts/import/checkin route table. |
| `src/app/api/workbuddy/models/route.ts`, `free-model/route.ts` | same paths | Verbatim shape, single-edition copy ("Unknown provider. Use workbuddy."). |
| `src/app/api/workbuddy/credits/route.ts:1-302` | `src/app/api/workbuddy/credits/route.ts` | Same query surface (`?all`, `?detail=fast`, `?refresh`, `?connectionId`), served through the pool engine so the single-account read shares the snapshot. |
| `src/app/api/workbuddy/info/route.ts:1-55` | `src/app/api/workbuddy/info/route.ts` | `describeWorkBuddyAddon()` + a network-free connection count; the deferred routes are absent from the route table. |
| `.../components/WorkBuddyCreditBadge.tsx:1-64` | `.../components/WorkBuddyCreditBadge.tsx` | Verbatim. Renders nothing unless the provider is this addon's AND a rate is declared. |
| — (new) | `.../components/WorkBuddyPoolCreditBadge.tsx` | Plan §C4 badge: first paint is `?all=true&detail=fast` (snapshot only, zero upstream calls), the refresh action asks for the full probe with `?refresh=1`, `unknown` is never rendered as `0`. **Wave 4:** when that fast body has no verdict (`pending`, or any account `unknown`), the badge promotes itself ONCE per connection to the full probe (`?all=true&connectionId=…`, no `detail=fast`) and renders that answer — the connection card showed "Credits unknown" because nothing on the page ever asked for the full read the route already serves. The promotion is memoized per connection and guarded by an in-flight ref, so a double effect or a re-render cannot loop it. |
| — (new) | `.../components/WorkBuddyReasoningEffortEditor.tsx` | Plan §6 effort editor: draft seeded on OPEN (no setState-in-effect), six-level vocabulary, Save → PATCH, Clear → DELETE. |
| — (new) | `.../hooks/useModelContextOverrides.ts` | The `CompatibleModelsSection` read/save pair lifted into a hook for the passthrough section (plan §6). |
| — | `tests/unit/workbuddy-credit.test.ts` | New (plan §9 T1): tier, caption, declared-rate reader and the id gate. |
| — | `tests/unit/workbuddy-pool-quota.test.ts` | New (plan §9 T6): TTL reuse, `detail=fast` never fetches, `refresh` bypass, `allSettled` isolation of a dead token, exclusions, single-connection scoping, account selection. |
| — | `tests/unit/workbuddy-catalog-projection.test.ts` | New (plan §9 T7): `toDiscoveryCatalogModel` carries `creditMultiplier`/`isFree`, omits both when there is no claim, and leaves the pre-existing projection byte-identical. |
| — | `tests/unit/workbuddy-reasoning.test.ts` | New (plan §9 T5). Twelve cases: the pure ladder rule (strip / clamp up / off→`none` / off→floor / unknown word / `thinking` never forwarded), the override-first contract (B2, incl. the bulk-map path and connection-scoped row precedence), the single-edition id mapping, and B3/B4 wiring (both map keys resolve to `WorkBuddyExecutor`; the wire body is clamped end-to-end; the D9 gate leaves the body untouched). |
| — (new) | `src/shared/utils/workBuddyCreditProbe.ts` | **Wave 4 (§C4 follow-up).** The badge's promotion rule as a pure predicate: `needsWorkBuddyFullCreditProbe(body)` is true when any edition reports `pending` or any account's `status` is `unknown` (or absent), and false for `ok`/`error`/`excluded`, an edition with no rows, and an empty body. Client-safe (no env, no DB), so the component and T8 share one source of truth instead of an inline condition the test would have to restate. |
| — | `tests/unit/workbuddy-pool-badge.test.ts` | New (wave 4, T8): the promotion predicate — promotes on `pending: 1`, on any `unknown` row, on a status-less row and on a later edition; does **not** promote on `ok`/`error`/`excluded`, on an edition with no rows, or on an empty/absent body (those would be billing-call loops, not display fixes). |
| — (new) | `docs/reference/WORKBUDDY_ADDON.md` | **Wave 5 operator brief.** What ships per wave, upstream-vs-patched (device code, B1v2 key, known-free rule, compact trigger, the missing quota card), the known gaps (workbuddy-global, desktop scan, env-doc debt, no aggregate bar), removal via `WORKBUDDY_ADDON=0`, the five-step resume, and the D-1..D-36 index. Copy-delivered (it is documentation, not a hunk) and indexed by `0008`; mirrored at `.handoff/HANDOFF-WORKBUDDY.md` in the fork-ci repo, which no build step consumes. |
| — | `tests/unit/workbuddy-quota-usage-skip.test.ts` | New (wave 6, `0010`): the Provider Quota usage-fetch gate. Two halves — the pure predicate (`shouldFetchUsage`: the whole workbuddy family is skipped, every real quota provider is not, unknown/malformed ids fail OPEN) and the call site, pinned at source level because the harness renders no components (`index.tsx` calls the gate inside `fetchQuota`, before `/api/usage/${connectionId}` and before the loading/error state; `QuotaCard.tsx` does not render the generic quota body when a credits slot is present). See the wave-6 deviation on why the wiring needs a source-level pin. |
| — | `tests/unit/workbuddy-opencode-premium.test.ts` | New (wave 4, `0005`): the free-lane rule at source level — the `-free` suffix and the legacy free ids stay free under a catalog that omits them, the catalog still decides for ids that make no free claim, an unknown id is premium with no synced catalog, and `opencode-go` stays fully keyed; plus the anonymous-key header contract (gated free request → env key; paid model, `/zen/go` surface and blank env → connection key; no credential and no env → no `Authorization`; zen Responses surface → `x-api-key`). |

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

## Modified files (`addon/patches/0005-opencode-free-lane.patch` — wave 4, opencode free lane)

The plan (§2) has named `0005-opencode-free-lane.patch` since wave 1 but never shipped it: waves
1–3 shipped `0001`–`0004`, so the source image inherited 3.8.53's **catalog-first**
`isPremiumOpencodeModel` and lost the keyed-lane override that the prebuilt 3.8.52 image carried
as a `Dockerfile` splice (patch-spec §8, deployed as `l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a)`).
Two user-verified symptoms follow from that: an OpenCode Zen free request 403s after an
"Import from `/models`" (the imported rows carry no free flag, so `catalog.has(id)` is false and
`big-pickle` is classified premium), and `big-pickle` reports "model not found" (the request goes
out on the keyed lane instead of the anonymous one). `0005` restores both as source hunks.

| Upstream anchor | Change | Origin |
|---|---|---|
| `open-sse/executors/opencodeFreeTierContract.ts:192-203` (`isPremiumOpencodeModel`) | Insert the known-free guard **before** the catalog return: `if (id.endsWith("-free") \|\| OPENCODE_LEGACY_FREE_MODELS.has(id)) return false;`, then `if (catalog) return !catalog.has(id);`, then the legacy fallback (which is now reached only for ids that made no free claim, i.e. premium). This is the 3.8.52 C1 semantics (`r.endsWith("-free") \|\| E.has(r) ? false : n ? !n.has(r) : …`, patch-spec §10.3) expressed in source. `opencode-go` still returns `true` before any of it. The doc-comment records why: discovery writes the catalog, an import from `GET /models` does not preserve the free flag, and a declarative free id must not be demoted by a snapshot that missed it. | patch-spec §10.2/§10.3 (C1); bug 1 of the wave-4 brief |
| `open-sse/executors/opencode.ts:1349-1358` (`buildHeaders`) | After `const key = resolveEffectiveKey(...) \|\| credentials.accessToken`, compute `gatedScope` (already there), then `const anonymousFreeTierKey = gatedScope ? (process.env.OPENCODE_ANONYMOUS_KEY ?? "").trim() : "";` and emit `headerKey = anonymousFreeTierKey \|\| key` in place of `key`. So a configured anonymous key REPLACES the connection key on gated requests only; paid models, the `go` surface and `opencode-go` keep the resolved key, and an unset/blank env is byte-identical to upstream. The env is read per request (lazy), so the lane can be flipped without a rebuild. | patch-spec §8 (v2 deployed semantics); bug 1 of the wave-4 brief |
| `.env.example:938-950` | Documents `OPENCODE_ANONYMOUS_KEY=public` next to the other free-tier knobs (commented, empty by default). Not decoration: `scripts/check/check-env-doc-sync.mjs` fails the join when a `process.env.X` reference has no `.env.example` + `ENVIRONMENT.md` row. | this port (fork-only knob) |
| `docs/reference/ENVIRONMENT.md:373-374` | One row for the same variable (default `_(unset)_`, source `open-sse/executors/opencode.ts`, gated-requests-only scope). | this port |
| `tests/unit/opencode-premium-keyless-gate-8681.test.ts:78-86` | The case that pinned "an unlisted `-free` id is premium when the catalog omits it" is **inverted by the fix**: the suffix is a free claim again. It now asserts `false` for the suffix, and a new case keeps the fail-safe for an unlisted id that makes no free claim (`some-delisted-model` → `true`). Leaving the old assertion would have made the suite red for the exact change requested (same class of adjustment as 0001's catalogue pin and 0002's golden snapshot). | consequence of the classify rule |
| `tests/unit/opencode-free-tier-request-contract.test.ts:1117-1133` | The "an `opencode-go` synced row is not in the `opencode` family free set" case used `big-pickle` as its exemplar; `big-pickle` is a known-free id now, so it would pass for the wrong reason. The exemplar is a paid id (`glm-5.2`, priced in the fixture), and the intent — a row synced under `opencode-go` never enters the `opencode` free set — is unchanged. | consequence of the classify rule |

**Not replicated: `OPENCODE_FREE_TIER_MODEL_BLOCKLIST` (patch-spec §3.4).** That knob made a
blocked id *never* free (a keyed 402 instead of an upstream 403) and was an operator escape hatch
for a roster 3.8.53 had not caught up with. With known-free ids unconditionally free and the
anonymous key on the gated lane, a blocklist entry would only resurrect the 403 it used to
prevent, so it is deliberately absent from `0005` — see deviation 14.

## Modified files (`addon/patches/0006-workbuddy-compact-ui.patch` — wave 4, model-row action)

`Compatibility` was the only trailing label button on a model row: `inline-flex … gap-1.5 px-1.5
py-1.5 border … sm:px-2.5` plus a `hidden sm:inline` label. On the right-column model cards it
overflows the card edge and is clipped. The row's neighbouring actions (copy, test, eye) are all
icon-only (`rounded p-0.5 text-sm`) with the wording in `title`; the Compatibility action now
matches them. No other button changes.

| Upstream anchor | Change | Origin |
|---|---|---|
| `.../components/ModelCompatPopover.tsx:526-537` | The trigger is split: `compact` renders the icon-only pattern — `rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary`, `material-symbols-outlined text-sm` `tune`, with `aria-label`/`title` = `t("compatButtonLabel")` ("Compatibility") so the affordance keeps its name for screen readers and hover. The non-compact branch is the previous button, byte-for-byte (custom-model rows keep the label). The `compact` prop's doc-comment now states that it is the model-row form, not a phone-only nicety. | bug 3 of the wave-4 brief |
| `.../components/ModelRow.tsx:484-486` | Passes `compact` to its `ModelCompatPopover`. Managed rows are the right-column cards the clip was reported on; `PassthroughModelRow` already passed it, so the shared trigger fixes both paths at the source instead of duplicating markup per row. | bug 3 of the wave-4 brief |
| `.../components/PassthroughModelRow.tsx:456` | Comment only (no markup change): the call site states that `compact` is the icon-only form and why, because the row renders the shared trigger and a future refactor of the popover must not reintroduce the label here. The passthrough and compatible sections both flow through this row (`CompatibleModelsSection.tsx:566-607` renders `PassthroughModelRow`), so one shared trigger covers them. | bug 3 of the wave-4 brief |
| `addon/overlay.sh` (governance) | Four markers added for wave 4 (the two `0005` anchors, the badge's promoted call, the icon-only `aria-label`) — 32 → 36 assertions. | plan §2 |

## Modified files (`addon/patches/0007-workbuddy-quota-budget.patch` — wave 5, quota budget)

Plan §C4 concluded that the connection-row strip was the only credits surface WorkBuddy could
have, because `workbuddy` is absent from `USAGE_SUPPORTED_PROVIDERS`
(`open-sse/services/usage/supportedProviders.ts`, re-exported at
`src/shared/constants/providers.ts:507`) and `supportsProviderQuota()` therefore answers `false`
for it. That is true of the *quota* capability, and it had a second consequence the plan did not
draw out: the panel's `filteredConnections` dropped the connection entirely, so Provider Quota
(and the `/dashboard/quota` page that renders it) showed no WorkBuddy card at all. Wave 5 makes
the card exist and gives it the only meter the provider has.

The injection is **three hops**, not the one anchor plan §C4 implies, because the card body is
rendered by `QuotaCard` and `QuotaCardGrid` is the component that owns the per-connection node.
Adding the badge in `ProviderLimits` alone would compile and render nothing (the grid takes
primitives, not children), which is why the grid gains an optional render prop rather than a
second hard-coded branch per provider.

| Upstream anchor | Change | Origin |
|---|---|---|
| `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx:36-41` | Two imports: `workBuddyCreditsForDisplay` (client-safe gate, from the copied credit module) and `WorkBuddyPoolCreditBadge`. | plan §C4 |
| `.../ProviderLimits/index.tsx:455-463` (`refreshProvider`) | Returns early for a connection the gate admits. It has no provider-usage implementation, so the card's refresh could only paint an error line beside the strip; the strip owns the refresh path (`?refresh=1`), and the guard is the same predicate as the slot. | this port |
| `.../ProviderLimits/index.tsx:534-549` (`filteredConnections`) | Membership becomes `supportsProviderQuota(conn.provider, conn) \|\| workBuddyCreditsForDisplay(conn) !== null` — "quota-supported, or has a credits line to show". The `authType` and `isProviderQuotaVisible` terms are untouched. | this port |
| `.../ProviderLimits/index.tsx:1101-1114` | Passes `renderCreditsSlot`: resolves the connection id once and renders `<WorkBuddyPoolCreditBadge connectionId={…} />`, `null` for every other provider. The badge's own first paint is `?all=true&detail=fast` (snapshot only), so the page still costs zero billing calls. | plan §C4 |
| `.../ProviderLimits/QuotaCardGrid.tsx:23-31` | New optional prop `renderCreditsSlot?: (connection: any) => ReactNode` + doc-comment. Generic over the bundled connection shape: the grid never inspects the row, the caller decides per connection. | this port |
| `.../QuotaCardGrid.tsx:173-176`, `:229-231`, `:247-249`, `:290-292`, `:330-332` | Threaded through both render paths — the flat `compact` grid and the expandable `ProviderQuotaSection` — so a WorkBuddy card carries its slot in either layout, and computed once per card (`creditsSlot={renderCreditsSlot ? renderCreditsSlot(conn) : undefined}`). | this port |
| `.../ProviderLimits/QuotaCard.tsx:1-4`, `:66-72`, `:92-95`, `:197-204` | New `creditsSlot?: ReactNode` prop, rendered **after** `<QuotaCardExpanded/>` — i.e. after every gauge/row the provider reported, which is where the "Credits constraint" slot belongs: the quota list is empty for WorkBuddy, so the strip is the card body's only meter. Bordered with the card's own hairline. | plan §C4 ("insert outside the quotaPanelSupported gate") |
| `addon/files/src/shared/utils/workBuddyCredit.ts` (copied file) | Appended `workBuddyCreditsForDisplay(connection)`: returns the trimmed `connection.id` when `isWorkBuddyProviderId(connection.provider)`, else `null`. Returning the id (not a boolean) keeps the admission gate and the badge's `connectionId` one decision — a card can never render an empty strip, and a strip can never probe with no `connectionId` (which the route would read as "every account"). | plan §C4 |
| `tests/unit/workbuddy-pool-badge.test.ts` (copied file) | Extended with the wave-5 gate: family ids (`workbuddy`, `wb`) return the id; another provider, a whitespace-only id and a missing row return `null`. The T8 promotion suite is unchanged above it. | plan §9 |
| `addon/overlay.sh` (governance) | Five markers: three for `0007` (the panel's `renderCreditsSlot` call — the only thing that makes the connection a card — the grid's forward, and the card's slot render), two for `0008`. 38 → 43 assertions. Either hop of the three compiles fine and renders nothing, which is exactly the bug wave 5 fixes. | plan §2 |

## Modified files (`addon/patches/0008-session-handoff-doc.patch` — wave 5, docs index)

The operator brief is **copy-delivered** (`addon/files/docs/reference/WORKBUDDY_ADDON.md`, so it
lands in the built image's `docs/reference/`). `0008` is therefore one line of navigation, not a
port: the docs site's `pages` list is an explicit literal, and a page that exists but is not listed
is invisible to the docs build. The same content is mirrored at
`.handoff/HANDOFF-WORKBUDDY.md` in the fork-ci repository for file-based discovery (no Docker
integration — nothing copies `.handoff/` into the image, by design).

| Upstream anchor | Change | Origin |
|---|---|---|
| `docs/reference/meta.json:11-14` | `"WORKBUDDY_ADDON"` appended to `pages` (after `RELAY_TROUBLESHOOTING`). The list is explicit and order-stable; appending keeps the existing order byte-identical. | wave-5 brief §2 |
| `addon/overlay.sh` (governance) | Two markers, both about the delivered artifact rather than a hunk: the docs index lists the page (a nav entry pointing at nothing is a broken docs build, so the marker is a must-fail), and the page still documents the kill switch (`WORKBUDDY_ADDON=0`) that the removal section promises. | plan §2 |

## Modified files (`addon/patches/0009-workbuddy-oauthmodal.patch` — wave 5b, device-code routing)

Wave 5b restores, **in source**, the one-line UI divergence the 3.8.52 prebuilt carried as a
compiled splice (patch-spec §A1 / `A1`: "add `workbuddy` to the device-code provider set"). The
source-mode plan had marked A1 obsolete on the assumption that 3.8.53 had absorbed it; it had not.
`src/app/api/oauth/[provider]/[action]/route.ts:66-77` lists `workbuddy` in
`NO_PKCE_DEVICE_CODE_PROVIDERS` and `src/lib/oauth/providers/workbuddy.ts` declares
`flowType: "device_code"` with a `requestDeviceCode` that returns the `device_code` /
`verification_uri` pair, so the **server** already serves the device flow for `workbuddy`. The
**modal** did not know it: `DEVICE_CODE_PROVIDERS` omitted the id, so `startOAuthFlow` fell
through to the PKCE branch and the connect screen asked the user for a browser callback that the
provider will never perform. The fix is the missing member of an existing set — no protocol, route
or component change.

| Upstream anchor | Change | Origin |
|---|---|---|
| `src/shared/components/OAuthModal.tsx:47-59` (`DEVICE_CODE_PROVIDERS`) | Insert `"workbuddy"` as the last member of the set literal (after `"muse-code"`, the alphabetical-ish position the set keeps), preceded by a comment recording the three facts a future reader would otherwise have to re-derive: the upstream flow is `device_code`, the server-side confirmation lives in `NO_PKCE_DEVICE_CODE_PROVIDERS` (`route.ts:67-78`), and this is the 3.8.52 compiled-splice A1 divergence. `"workbuddy"` is the id `getProvider()` resolves (`WORKBUDDY_PROVIDER_ID`, `src/lib/workbuddy/types.ts`), i.e. the same string the route's set carries. | patch-spec §A1; wave-5b brief §1 |
| `addon/overlay.sh` (governance) | Two markers (the rationale comment; the entry as the literal's last member, `"workbuddy",\n]);`) — 36 → 38 assertions. Two, not one, because the guarded failure is positional: an entry that exists outside `DEVICE_CODE_PROVIDERS` still type-checks and renders the PKCE step. | plan §2 |

**Deliberately not touched (D1 / DEFERRED).** `TOKEN_PASTE_PROVIDERS`,
`IMPORT_TOKEN_ONLY_PROVIDERS`, `PASTE_FIRST_PROVIDERS`, `PKCE_CALLBACK_SERVER_PROVIDERS` and
`PKCE_CALLBACK_PROVIDERS` are byte-identical to upstream after this patch. The paste tab is a
fork-only affordance (D1): the addon's `workbuddy` credential comes from the device flow, and
adding `workbuddy` to a paste set would advertise a form the server does not accept for this
provider (`IMPORT_TOKEN_PROVIDERS` in the route does not list it either). If paste is ever ported
it lands as its own patch, not as an unverified member of this one.

**Why no unit test.** The 3.8.52 fix shipped without one, and the harness has nothing to assert
here: `DEVICE_CODE_PROVIDERS` is a module-private `new Set([...])` inside a `"use client"` `.tsx`
file, and the repo's `node --test` + `tsx` suite does not render components, so the only
observable is the rendered step — a DOM test this addon does not have. The server half is already
pinned by the upstream `tests/unit/workbuddy-provider.test.ts` (its `flowType: "device_code"`
assertion) and the route's own set. The regression is therefore pinned by **overlay post-conditions
plus the two manual checks below**, which is what the compiled splice relied on as well.

**Manual verification for wave 5b** (run against an overlaid tree; both are the checks named in
the brief):

1. *Static — the set contains the entry, in the set.* In the overlaid tree:
   `grep -n '"workbuddy"' src/shared/components/OAuthModal.tsx` must report exactly two lines:
   `:57` (the comment) and `:58` (`  "workbuddy",`), with `:59` the literal's closing `]);`.
   The overlay already fails closed on this (the two 0009 markers), so this check is the human
   confirmation, not the only guard. `git diff` on the file must show **one hunk, two added
   lines**, and nothing at `TOKEN_PASTE_PROVIDERS` / `IMPORT_TOKEN_ONLY_PROVIDERS`.
2. *Runtime — the connect preflight answers with a device code.* POST
   `/api/oauth/workbuddy/device-code` (the source-mode equivalent of the prebuilt artifact's
   `/api/workbuddy/authorize` shim — see deviation 31) must answer `200` with
   `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }`
   (`route.ts:284-289` spreads `requestDeviceCode` and adds `codeVerifier`;
   `src/lib/oauth/providers/workbuddy.ts:102-110` maps the gateway's
   `{ code: 0, data: { state, authUrl } }` onto `device_code = state` and
   `verification_uri[_complete] = authUrl`). A `400 "Provider does not support device code flow"`
   would mean the registry lost `flowType: "device_code"`; a UI that jumps to the PKCE step
   despite that `200` is exactly the bug `0009` fixes.

## Modified files (`addon/patches/0010-workbuddy-quota-usage-skip.patch` — wave 6, usage-fetch skip)

Wave 5 (`0007`) gave the WorkBuddy connection a Provider Quota card and put the pooled credit
strip on it. It left the card's *other* quota path intact, and that path is the bug: the panel
still issued the generic `GET /api/usage/{connectionId}` for the connection, and for WorkBuddy
that route answers

```json
400 {"error":"Usage not available for this connection"}
```

— it is an OAuth provider with no usage backend (`USAGE_SUPPORTED_PROVIDERS` omits it, which is
exactly why `0007` had to admit the card by hand). `fetchQuota` turns a non-OK response into an
error string, `ProviderLimits` passes its `errors` map to `QuotaCard`, and `QuotaCardExpanded`
renders it as a red banner under the header: a live credit balance with "Usage not available for
this connection" printed next to it. WorkBuddy reports quota **only** through
`GET /api/workbuddy/credits` (the pool snapshot the strip already reads), so the generic fetch is
not a degraded answer there — it is the wrong source.

The fix is one gate at the single choke point, plus the body suppression that makes the card say
what it means.

| Upstream anchor | Change | Origin |
|---|---|---|
| `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx:382-390` (`fetchQuota`) | First statement of the callback: `if (!shouldFetchUsage(provider)) return;` behind a comment that names the route, the 400 body and the credits endpoint it defers to. It returns **before** `lastFetchTimeRef`, before `setLoading(… true)` and before `setErrors(… null)`, so a skipped connection never enters the loading or error maps and no banner can be painted from this path. Every caller — the auto-live effect (`shouldAutoRefreshQuota` → `fetchQuota`), `refreshProvider`, and the `staleAfterReset` self-probe retry inside `fetchQuota` — funnels through this one function, which is why the gate is here and not at three call sites. | wave-6 brief §1; `0007` follow-up |
| `.../ProviderLimits/index.tsx:39` | The existing wave-5 import from the copied credit module gains `shouldFetchUsage` (same import, no new dependency edge). | wave-6 brief §1 |
| `.../ProviderLimits/QuotaCard.tsx:171-202` | The generic `<QuotaCardExpanded/>` is now rendered only when there is **no** credits slot (`{creditsSlot ? null : (…)}`). `0007` had put the strip *under* the body, which for WorkBuddy only ever renders the italic "no quota data" line — a live credit balance over a "no data" notice. With the slot present, the card is header + credits strip, which is the whole truth about this provider's budget. The body keeps its refresh/cost/cutoff plumbing for every provider with real quota rows. | this port (see deviation 38) |
| `addon/files/src/shared/utils/workBuddyCredit.ts` (copied file) | Appended `shouldFetchUsage(providerId): boolean` = `!isWorkBuddyProviderId(providerId)` over `unknown` input. Pure, client-safe, no React/env/DB — so the predicate is unit-testable without a component harness, and it uses **this** module's family predicate (canonical id, `wb`/`wbg`, any `workbuddy-*` spelling) rather than `lib/workbuddy/types`, because that is the same predicate `workBuddyCreditsForDisplay` admits the card with (deviation 37). Fails open: an id this list has never seen keeps its usage fetch. | wave-6 brief §2 |
| `addon/overlay.sh` (governance) | Two markers — 43 → **45** assertions: the gate line itself (a card whose fetch still fires *is* the reported bug) and the comment that records where WorkBuddy quota actually comes from (the pool snapshot), which is the only place the next reader learns why the route is skipped. Both live inside `fetchQuota`. The card-body hunk carries no marker of its own; see deviation 38. | plan §2 |
| `tests/unit/workbuddy-quota-usage-skip.test.ts` (new, copied file) | 9 cases: the family is skipped (canonical, aliases, `workbuddy-*`, case/padding); ten quota providers keep the fetch; unknown/malformed ids fail open; and a source-level pin that the gate sits inside `fetchQuota` **before** the request, before `setLoading` and before `setErrors`, exactly once — plus that `QuotaCard` omits the body when a slot is present. | wave-6 brief §2 |

**Why the refresh paths need no second hunk.** `refreshAll()` is a *bulk* refresh: it POSTs
`/api/usage/provider-limits` and never touches `/api/usage/{id}`. Its server half
(`syncAllProviderLimits`) filters rows through `isSupportedUsageConnection`
(`src/lib/usage/providerLimits.ts:205-214`), which for an OAuth row IS `supportsProviderQuota` —
false for WorkBuddy — so the bulk `errors` map it returns cannot contain the connection, and
`setErrors(data.errors || {})` therefore cannot re-paint the banner. Adding a client-side filter
there would be dead code; the verification below proves the path is inert instead (deviation 39).

**Why a source-level assertion is legitimate here.** `shouldFetchUsage` alone would pass a build
where the gate was deleted from `fetchQuota` (the predicate is still correct and still tested), so
the suite also reads the panel file: a real wiring assertion, not a restatement of the predicate.
That is the same shape as `0005`'s source-level pins, and it is the only observable the harness
has — the repo's `node --test` suite renders no client components (deviation 40).

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

**Wave 4:**

22. **No `OPENCODE_FREE_TIER_MODEL_BLOCKLIST` patch.** Patch-spec §3.4 shipped a shifted,
    de-duplicated id list that classified a blocked id as **never free**, converting the upstream
    403 into the gateway's clean 402. The brief for this wave explicitly excludes it, and the code
    agrees: with the known-free rule restored and the anonymous key on the gated lane, the only
    thing a blocklist can still do is send a free id back down the keyed lane — the failure this
    patch removes. The opt-out `OPENCODE_FREE_TIER_REQUEST_CONTRACT=off` is untouched.
23. **Two pre-existing opencode assertions move with the rule.** `0005` inverts
    `opencode-premium-keyless-gate-8681.test.ts`'s "unlisted `-free` id is premium" case (the rule
    the fix restores is exactly what it denied) and swaps the `big-pickle` exemplar in
    `opencode-free-tier-request-contract.test.ts` for a paid id, because `big-pickle` is a
    known-free id now and would make that case pass for the wrong reason. Neither test was weakened:
    each keeps an explicit negative case for the fail-safe it existed to protect (unknown id with
    no free claim → premium; a row synced under `opencode-go` never enters the `opencode` set).
24. **The env knob is documented in `.env.example` + `ENVIRONMENT.md`.** Not in the brief, but
    `scripts/check/check-env-doc-sync.mjs` reads every `process.env.X` in `src/`/`open-sse/` and
    fails when the var is missing from both files — adding the reference without the docs would
    have turned a source port into a red docs gate. Verified: `✓ Env / docs contract is in sync.`
25. **The free-lane rule lives in `isPremiumOpencodeModel`, not in the executor gate.**
    `isGatedFreeTierRequest` already delegates to it, and `buildUrl` (the `/inference/v1` base) and
    `prepareFreeTierRequest` (the body contract) both reuse the same predicate — so one edit moves
    the classification, the URL, the header synthesis and the body contract together. Patching the
    two call sites instead would leave them able to disagree.
26. **The badge promotes ONCE per connection, and refresh is a full read.** A `detail=fast` body
    that stays `pending` cannot be allowed to re-fire a billing read on every render, so the
    promotion is memoized by connection id and the `load` call is guarded by an in-flight ref.
    The refresh button therefore asks for `full + refresh=1` directly rather than "fast with
    refresh", which is a snapshot read that ignores `refresh` and would have made the button a
    no-op after the first promotion. Rendering semantics are unchanged: an absent verdict is
    still `unknown`, never `0`.
27. **The promotion rule is a separate copied module, not an inline condition.** `WorkBuddyPoolCreditBadge.tsx`
    is a `"use client"` `.tsx` file, and the repo's unit harness (`node --test` + `tsx`) does not
    render components; an inline predicate would have been untestable without a vitest/DOM
    harness. `src/shared/utils/workBuddyCreditProbe.ts` is pure and client-safe, so T8 pins the
    decision and the component only wires the fetch to it.
28. **The Compatibility action is fixed in `ModelCompatPopover`, and `ModelRow` opts in.**
    `PassthroughModelRow` (passthrough + compatible sections) already passed `compact`, so the
    clipping row was the managed `ModelRow`, which rendered the labeled form; the passthrough
    call site therefore gets a comment, not markup. Changing the shared trigger and passing
    `compact` from `ModelRow` fixes both paths once; `CustomModelsSection` (custom rows, not in
    the reported right column) keeps the labeled button untouched, as asked ("no other buttons
    changed").
29. **The icon-only button keeps its accessible name.** "Icon-only" is a visual statement; the
    affordance is still named `Compatibility` through `aria-label` + `title`, mirroring the
    neighbouring eye/copy/test buttons, so the remedy does not trade a layout bug for an
    accessibility one.

**Wave 5b:**

30. **The A1 splice is restored as a source patch; the plan's "obsolete" verdict was wrong.**
    `PLAN.patch-spec.md` retired A1 on the belief that 3.8.53 had folded `workbuddy` into the
    modal's device-code set. It had not: the server sets (`NO_PKCE_DEVICE_CODE_PROVIDERS`,
    `PKCE_CALLBACK_PROVIDERS`) and the provider registry did absorb the id, the *modal's*
    `DEVICE_CODE_PROVIDERS` did not, so the prebuilt behaviour (device panel) and the source build
    (PKCE step → dead callback) genuinely diverged. The plan line is superseded by this patch; the
    runtime fact that made A1 necessary never changed.
31. **The brief's `/api/workbuddy/authorize` probe has no source-mode counterpart; the check
    moves to the upstream OAuth router.** The prebuilt 3.8.52 artifact reached the flow through an
    addon shim route that returned the gateway body almost verbatim (`{ code, data: { device_code,
    authUrl } }`). In source mode no such route exists — the fork's `addon/files/src/app/api/workbuddy/`
    ships only the read-only `models` / `credits` / `free-model` / `info` surface — and the flow is
    served by upstream's generic router at `POST|GET /api/oauth/workbuddy/device-code`
    (`src/app/api/oauth/[provider]/[action]/route.ts:210-289`), which normalises the same gateway
    answer into `device_code` / `verification_uri[_complete]` and adds `codeVerifier`. The
    verification is therefore recorded against that endpoint (with the exact body shape) instead
    of re-introducing a second, unowned authorize route just to satisfy the brief's path.
32. **No unit test; two post-condition markers instead.** Documented in the 0009 section: the set
    is module-private inside a client `.tsx` and the harness renders no components, so a test would
    either need a DOM harness this addon does not have or would assert source text (which the
    overlay markers already do, fail-closed, on every build). The existing
    `tests/unit/workbuddy-provider.test.ts` keeps the server-side `flowType: "device_code"` pinned.
33. **The file number is `0009`, not `0007`.** The wave-5b brief allocates the `0009` slot, and
    when this patch was written the two intervening numbers belonged to waves still in flight in
    sibling branches (workbuddy quota, session/handoff doc). Both have since landed —
    `0007-workbuddy-quota-budget.patch` and `0008-session-handoff-doc.patch` — so the series is
    now **contiguous `0001`–`0009`** and 0009 is last. The ordering was never a dependency:
    `0009` touches exactly one file (`OAuthModal.tsx`) that no other patch in the series touches,
    which is verified both ways (see the coexistence row in the wave-5b verification table), so
    the patch applies identically whether it lands before or after them. Renumbering it to `0007`
    would have collided with a patch that was about to appear in that exact slot.

**Wave 5:**

34. **The Provider Quota injection is three upstream hunks, not the plan's one anchor.** §C4 names
    `ConnectionRow.tsx` (already shipped in `0003`) and implies the quota card is reachable from
    `ProviderLimits` alone. It is not: `ProviderLimits` passes primitives to `QuotaCardGrid`, the
    grid owns the per-connection `QuotaCard` node, and the card body is `QuotaCard`'s own JSX. A
    badge added only in the panel would compile and render nothing. The grid therefore gains an
    optional render prop (`renderCreditsSlot`) instead of a provider-specific branch, which keeps
    the grid provider-agnostic and the decision (`workBuddyCreditsForDisplay`) in one place.
35. **`dashboard/quota/page.tsx` receives no hunk.** The brief describes a "QuotaCards workbuddy
    connection duplicated card injection ... in the expansion `[id='workbuddy']` gate". Read fresh:
    the page is a 34-line shell (settings fetch + `<ProviderLimits autoRefreshInterval=…/>`); it
    contains no card markup, no per-connection map and no `[id='workbuddy']` expansion — the
    `/dashboard/providers/[id]` route has no `QuotaCardGrid` either. The card the brief describes
    is the one `ProviderLimits` renders, so the wiring landed there and in the two components it
    delegates to. Inventing a second injection point in the shell would have been dead code.
36. **`workBuddyCreditsForDisplay` returns the connection id, not a boolean.** A boolean gate plus
    a separate `connection.id` in the JSX is two decisions that can disagree (and the badge's
    `connectionId` is what scopes the pool probe — an empty one makes the route read the whole
    pool). Returning the id keeps admission and probing atomic and gives the unit test something
    falsifiable to assert. The name follows the wave-5 brief's own `workBuddyCreditsForDisplay`.

**Wave 6:**

37. **`shouldFetchUsage` lives in the copied credit module, not in `lib/workbuddy/types`.** The
    brief offers `isWorkBuddyProviderId` from `@/lib/workbuddy/types` first ("if the import graph
    allows"). It does allow it — that module is client-safe — but its resolver accepts only
    `workbuddy` / `wb`, while the card is admitted by `workBuddyCreditsForDisplay`, which uses the
    **credit module's** family predicate (canonical ids, `wb`/`wbg`, any `workbuddy-*` spelling).
    Gating the fetch on the narrower resolver would reintroduce the bug for a `workbuddy-*`
    connection: admitted as a card by one predicate, still fetching by the other. One family
    definition for both halves is the only version that cannot diverge, so the gate reuses
    `isWorkBuddyProviderId` from the module that already owns it and `index.tsx` imports no new
    module.
38. **The card body is suppressed, and that second hunk is not in the brief's file list.**
    `0007`'s strip sat *after* `<QuotaCardExpanded/>`, and a WorkBuddy card's body is always
    empty: no quotas, no message, so the only thing it can render is the italic `noQuotaData`
    line. The brief's acceptance ("just the credits slot") is not met by silence on the error
    alone — a "no quota data" notice over a live balance is the same wrong claim in grey. With a
    credits slot present the body is therefore not rendered at all (one file, `QuotaCard.tsx`; no
    prop is added to the generic `parts/QuotaCardExpanded.tsx`). It carries no third marker: the
    marker budget for this wave is fixed at 45, `0007`'s `{creditsSlot ? (` marker still pins the
    slot block, and `git apply` is all-or-nothing — a hunk cannot land partially, and a drifted
    anchor fails the whole patch. If a later wave changes this block, the feature test's
    `{creditsSlot ? null : (` assertion is what notices.
39. **`refreshAll()` gets no skip hunk — the path is already inert, and the reasoning is recorded
    instead of coded.** "BOTH the initial fetch and the `refreshAll()` re-fetch must skip" is the
    right requirement, but `refreshAll` is a bulk POST whose server half filters connections
    through `isSupportedUsageConnection` → `supportsProviderQuota` → false for WorkBuddy. It
    issues no `/api/usage/{id}` request and its `errors` map cannot carry the connection, so a
    client-side filter would be unreachable code that looks like a guard. The *per-connection*
    paths that do exist (auto-live effect, `refreshProvider`, stale-probe retry) all go through
    `fetchQuota`, which is exactly where the gate is. Verified: the overlaid tree's suite plus the
    source-level pin (gate before the request), and the bulk route by inspection of
    `providerLimits.ts:996,205-214`.
40. **The wiring is asserted at source level, on top of the unit-tested predicate.** The brief
    asks for a test "if the skip is implemented as a pure helper ... else document why no unit
    test". Both halves are cheap and independent, so both shipped: `shouldFetchUsage` has nine
    falsifiable cases (including failure-open), and the call site is pinned by reading
    `index.tsx`/`QuotaCard.tsx`. The second is not redundant — deleting the gate would leave every
    predicate case green — and it is the only observable available: the harness renders no client
    components.

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

## Verification performed for wave 4 (not a promise — the transcript is in the hand-off)

Fresh oracle tree: `/workspace/pkgtest_scratch12` = `rsync -a --exclude=.git --exclude=node_modules`
of the upstream checkout @ `e9cb075c`, then `git init` + one commit (`106065a`). Every number
below was produced against a tree built from that commit, not against an incrementally patched
one.

| Check | Command | Result |
|---|---|---|
| Full series applies | `bash addon/overlay.sh /workspace/pkgtest_scratch12` | `overlay: copied 29 file(s)`, `overlay: preflight passed for 6 patch(es)`, `overlay: applied 0001…0006`, **36 post-condition assertions passed**, `overlay ok — 6 patch(es), 29 file(s)`, exit 0 |
| Fail-closed | same command a second time | `overlay: ERROR — work tree has changes relative to HEAD in /workspace/pkgtest_scratch12 … nothing was applied`, exit **1** |
| Unit tests (T1–T8 + pre-existing + golden) | `TMPDIR=/workspace/.tmp_wave4 node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-*.test.ts tests/unit/executor-map-golden.test.ts tests/unit/executor-registry.test.ts` | **116/116 pass**, exit 0 (96 from waves 1–3 + **20 new**: 13 in `workbuddy-opencode-premium.test.ts`, 7 in `workbuddy-pool-badge.test.ts`) |
| opencode regression sweep (the files `0005` touches and their neighbours) | `… --test tests/unit/opencode-*.test.ts tests/unit/refactor-buildHeaders-{opencode,preamble}.test.ts tests/unit/refactor-opencodeHeaders.test.ts tests/unit/opencodeReasoningSanitizer.test.ts` | **982/982 pass**, exit 0 — includes the two edited suites (`opencode-free-tier-request-contract` 73 with the premium gate file, `opencode-premium-keyless-gate-8681`) and `refactor-buildHeaders-opencode` (the `resolveEffectiveKey` guard still matches) |
| Core typecheck gate | `npm run typecheck:core` | exit 0, no diagnostics |
| open-sse typecheck gate (CI-real) | `node scripts/check/check-open-sse-typecheck.mjs` | `openSseTypecheckErrors=0`, `OK — 0 pre-existing error(s), all within frozen baseline`, exit 0 |
| Dashboard typecheck gate | `npm run check:dashboard-typecheck` | `OK — 196 pre-existing error(s), all within frozen baseline`, exit 0 — the frozen count is unchanged, so the patched components add no diagnostic |
| Format | `prettier --check` (repo config) over all 11 touched files | clean (`docs/reference/ENVIRONMENT.md` is in `.prettierignore`; `.env.example` is not a Prettier target) |
| Lint | `eslint` over the same 11 files | 2 errors, both **pre-existing** in `open-sse/executors/opencode.ts` (`@typescript-eslint/no-explicit-any` at the file's `any` pair): verified by linting `git show HEAD:open-sse/executors/opencode.ts` in place — the pristine copy reports the same 2 errors at `:1473`/`:1476`, i.e. the same statements, shifted 9 lines by this patch |
| Env/doc contract | `node scripts/check/check-env-doc-sync.mjs` on the overlaid tree | `OPENCODE_ANONYMOUS_KEY` is in sync (code + `.env.example` + `ENVIRONMENT.md`). The gate still reports **2 pre-existing addon debts from waves 1/3** — `WORKBUDDY_ADDON` (`src/lib/workbuddy/types.ts`) and `WORKBUDDY_POOL_STATE` (`src/lib/workbuddy/poolState.ts`) — which predate this wave and belong to no `0005`/`0006` hunk; recorded here rather than smuggled into an unrelated patch |
| Revalidation after the last hunk | `0006` gained a comment-only hunk in `PassthroughModelRow.tsx` after the first green run, so the whole cycle was repeated on a reset tree: overlay exit 0 with the same `29 file(s)` / `36 assertions`, both test groups re-run (**116/116**, **982/982**), `prettier`/`eslint`/`typecheck:core`/`check:open-sse-typecheck`/`check:dashboard-typecheck` all re-run green on that exact tree | the numbers in this table are the post-revalidation ones |
| Isolation of the fix | the two new suites run without the DB seam | `workbuddy-pool-badge.test.ts` needs no fixtures (pure predicate); `workbuddy-opencode-premium.test.ts` pins the catalog through `_setOpencodeFreeModelsForTests` and restores it, and the anonymous-key cases set/unset `process.env.OPENCODE_ANONYMOUS_KEY` in `afterEach` |

The 116- and 982-test runs borrowed the fork checkout's `node_modules` via a symlink and pointed
`TMPDIR` at `/workspace/.tmp_wave4`, exactly as waves 1–3 did. No commit was made in this
repository for wave 4.

## Verification performed for wave 5b (not a promise — the transcript is in the hand-off)

Fresh oracle trees, all built the same way — `rsync -a --exclude=.git --exclude=node_modules` of
the upstream checkout @ `e9cb075c`, then `git init` + one commit: `/workspace/pkgtest_scratch15`
(`01b689d`, the 7-patch series as it stood when this patch was written), `…15b` (`f465ed8`, second
tree against the then-current `addon/files/`) and `…15c` (`c428a46`, the **final** run: the
contiguous `0001`–`0009` series after the sibling waves landed `0007`/`0008`). Every number below
was produced against a tree built from its own commit, not against an incrementally patched one.

| Check | Command | Result |
|---|---|---|
| **Final: the whole series, `0001`–`0009`** | `bash addon/overlay.sh /workspace/pkgtest_scratch15c` | `overlay: copied 30 file(s)`, `overlay: preflight passed for 9 patch(es)`, `overlay: applied 0001…0009`, **43 post-condition assertions passed** (36 from waves 1–4 + 5 from wave 5's `0007`/`0008` + 2 from `0009`), `overlay ok — 9 patch(es), 30 file(s)`, exit **0** |
| **Wave 5 oracle (`pkgtest_scratch14`)** | fresh `rsync _up/OmniRoute` + `git init` + `bash addon/overlay.sh .` | `overlay: copied 30 file(s)`, `preflight passed for 9 patch(es)`, `applied 0001…0009`, **43 post-condition assertions passed**, `overlay ok — 9 patch(es), 30 file(s)`, exit **0**; immediate rerun exits **1** (`work tree has changes relative to HEAD … nothing was applied`); `tests/unit/workbuddy-*.test.ts` **111/111**, the two opencode contract files **28/28**; `tsc -p tsconfig.typecheck-core.json` exit 0; open-sse typecheck `0` errors; dashboard typecheck `196 pre-existing, all within frozen baseline` (0 live); prettier + eslint (with the repo suppressions) clean on the five touched files. Note: `tests/unit/docs/vision-key-scope-locales.test.ts` fails on **pristine upstream** too (`docs/security/GUARDRAILS.md` hash ≠ `.i18n-state.json`), so it is not a signal from this series — verified by hashing the untouched upstream tree |
| Series applies with 0009 (as of this patch) | `bash addon/overlay.sh /workspace/pkgtest_scratch15` | `overlay: copied 29 file(s)`, `overlay: preflight passed for 7 patch(es)`, `overlay: applied 0001…0006, 0009`, **38 post-condition assertions passed** (36 + the 2 new 0009 markers), `overlay ok — 7 patch(es), 29 file(s)`, exit **0** |
| Fail-closed | same command a second time | `overlay: ERROR — work tree has changes relative to HEAD in /workspace/pkgtest_scratch15 … nothing was applied`, exit **1**; the clean-tree precondition is unchanged by 0009 |
| Marker is positional, not textual | `grep -n '"workbuddy"' src/shared/components/OAuthModal.tsx` on the overlaid tree | `:57` comment, `:58` `  "workbuddy",`, `:59` `]);` — the entry is the literal's last member; `git diff` for the file is **one hunk, 2 added lines, 0 removed**, and no line at `TOKEN_PASTE_PROVIDERS` / `IMPORT_TOKEN_ONLY_PROVIDERS` |
| Wave-4 suites unchanged (no regression) | `node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-opencode-premium.test.ts tests/unit/executor-map-golden.test.ts tests/unit/workbuddy-provider.test.ts` | **43/43 pass**, exit **0** on `/workspace/pkgtest_scratch15` **and again 43/43 on `…15c`** (the 9-patch tree, `duration_ms` 9.1 s / 12.7 s) — the opencode premium lane (13), the executor-map golden (chat/executor wiring intact) and the provider suite, including its `flowType: "device_code"` pin |
| Core typecheck gate | `./node_modules/.bin/tsc --pretty false -p tsconfig.typecheck-core.json` (`npm run typecheck:core` aborted on `ENOSPC` writing its npm log to a full `/tmp`) | exit **0**, no diagnostics — on both the 7-patch tree and `…15c` |
| Format | `prettier --check src/shared/components/OAuthModal.tsx` | `All matched files use Prettier code style!`, exit 0 (a 197-char comment is not rewrapped by Prettier) |
| Lint | `eslint src/shared/components/OAuthModal.tsx` | 3 errors, all **pre-existing and lint-neutral**: the same three (`no-unused-vars` at `:812`, `:823`, `:858`) are reported for the pristine file at `:810`, `:821`, `:856` — the identical statements shifted by the 2 inserted lines, verified by linting `git show HEAD:…` in place |
| Env/doc contract | not re-run | 0009 adds no `process.env` reference and no env-backed knob, so `check-env-doc-sync` cannot move; wave 4's two pre-existing addon debts (`WORKBUDDY_ADDON`, `WORKBUDDY_POOL_STATE`) are untouched |
| Same, on a second tree built from the current `addon/files/` | `/workspace/pkgtest_scratch15b` @ `f465ed8` (upstream + one commit) → `bash addon/overlay.sh /workspace/pkgtest_scratch15b` | identical: `preflight passed for 7 patch(es)`, **38 assertions**, `overlay ok — 7 patch(es), 29 file(s)`, exit **0**. Run because a sibling wave wrote `addon/files/src/shared/utils/workBuddyCredit.ts` (+23 lines, `workBuddyCreditsForDisplay`) at 05:09, i.e. **after** the first tree was tested: the series does not depend on that file, and the second run proves the copied-file half still yields a green overlay |
| Coexistence with `0007`/`0008` | minimal tree holding the files the three patches touch (`git show HEAD:…` from the oracle, `git init`, one commit) → `git apply 0007`, `git apply 0008`, then `git apply --check 0009` and `git apply 0009` | `0007 applied`, `0008 applied`, `0009 applied`; `grep -n '"workbuddy"'` then reports `:58` in the same mini-tree. The patches are **file-disjoint** (`QuotaCard.tsx` / `QuotaCardGrid.tsx` / `ProviderLimits/index.tsx`, `docs/reference/meta.json`, `OAuthModal.tsx`), so the series is contiguous `0001`–`0009` and 0009 order-independent |

The 43-test run borrowed `/workspace/pkgtest_scratch12/node_modules` via a symlink (the only
installed tree on this host) and pointed `TMPDIR` at `/workspace/.tmp_wave5b`. Two environment
notes for whoever replays this: `/tmp` was **full** (2.0 GB tmpfs) during wave 5b, which is why
`npm run` (its log dir lives under `/tmp/.npm-cache`) failed with `ENOSPC` while the direct `tsc`
binary did not — set `TMPDIR` before `npm`, or call the binary; and the first overlay attempt in
this wave failed **inside `overlay.sh` itself** because a marker comment contained an apostrophe
inside the single-quoted `node -e` script — the shipped block avoids apostrophes and says so. No
commit was made in this repository for wave 5b.

## Verification performed for wave 6 (not a promise — the transcript is in the hand-off)

One fresh oracle tree, built the same way as every previous wave — `rsync -a --exclude=.git
--exclude=node_modules` of the upstream checkout @ `e9cb075c`, then `git init` + one commit:
`/workspace/pkgtest_scratch16` (`3395d62`). Every number below was produced on that tree after a
single `bash addon/overlay.sh /workspace/pkgtest_scratch16` run, not on an incrementally patched
one.

| Check | Command | Result |
|---|---|---|
| **The whole series, `0001`–`0010`** | `bash addon/overlay.sh /workspace/pkgtest_scratch16` | `overlay: copied 31 file(s)`, `overlay: preflight passed for 10 patch(es)`, `overlay: applied 0001…0010`, **45 post-condition assertions passed**, `overlay ok — 10 patch(es), 31 file(s)`, exit **0** |
| Fail-closed | same command a second time | `overlay: ERROR — work tree has changes relative to HEAD in /workspace/pkgtest_scratch16 … nothing was applied`, exit **1** |
| New suite | `TMPDIR=/workspace/.tmp_wave6 node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-quota-usage-skip.test.ts` | **9/9 pass**, exit **0** — family skip (3), fail-open/other-provider (2), call-site pin (3), card-body pin (1) |
| WorkBuddy + golden suites | `… --test tests/unit/workbuddy-*.test.ts tests/unit/executor-map-golden.test.ts` | **122/122 pass**, exit **0** (120 workbuddy incl. the 9 new + 2 golden), `duration_ms` 16879 |
| Core typecheck gate | `./node_modules/.bin/tsc --pretty false -p tsconfig.typecheck-core.json` | exit **0**, no diagnostics |
| open-sse typecheck gate | `node scripts/check/check-open-sse-typecheck.mjs` | `openSseTypecheckErrors=0`, `OK — 0 pre-existing error(s)`, exit **0** |
| Dashboard typecheck gate | `node scripts/check/check-dashboard-typecheck.mjs` | `OK — 196 pre-existing error(s), all within frozen baseline`, exit **0** (the two `index.tsx` diagnostics are the frozen `label` pair at `:1019`/`:1095`, none in the changed hunks) |
| Format | `prettier --check` on the four touched files | `All matched files use Prettier code style!`, exit **0** |
| Lint | `eslint` on the four touched files | 1 error, **pre-existing and lint-neutral**: `'aggregateWorst' is defined but never used` at `index.tsx:179`; the pristine file (`git show HEAD:…` piped to `eslint --stdin`) reports the identical error at `:177`, i.e. the same statement shifted by the two added lines. The three added files are clean. |
| Patch shape | `git apply --stat addon/patches/0010-…` | 2 files, **+43 / −30** (`QuotaCard.tsx` 35/29 — the re-indented body render — and `index.tsx` 8/1) |

Two environment notes for whoever replays this: the suites borrow
`/workspace/pkgtest_scratch12/node_modules` through a symlink (the only installed tree on this
host) and point `TMPDIR` at `/workspace/.tmp_wave6`; and `git init` in a fresh tree needs a local
`user.name`/`user.email` before the seeding commit, or `overlay.sh` fails its own clean-tree
precondition (`fatal: bad revision 'HEAD'`). No commit was made in the fork-ci repository for
wave 6.
