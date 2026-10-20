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
| `src/lib/workbuddy/types.ts:1-333` | `src/lib/workbuddy/types.ts` | **Rewritten, not copied.** One edition (`WORKBUDDY_EDITIONS` = the global entry, `providerId: "workbuddy"`, `configPath: "/v3/config"`, `catalogUserAgent: "WorkBuddy/5.5.2"`, `supportsCheckin: false`). The CN constants (`WORKBUDDY_CN_*`, `WORKBUDDY_MODELS_PATH`, check-in paths), `WorkBuddyCredential`/credits/check-in types and the region resolvers were dropped because nothing in this port uses them (single edition, no desktop import, no check-in) — they are listed under DEFERRED. Added the D9 gate `workBuddyAddonEnabled()` (server-only) and `isWorkBuddyProviderId()` (client-safe), per plan §A1. `WORKBUDDY_GLOBAL_PROVIDER_ID` is gone: `resolveWorkBuddyEdition` accepts `workbuddy`/`wb` only. |
| `src/lib/workbuddy/upstream.ts:281-390` (parser cluster) | `src/lib/workbuddy/upstream.ts` | Trimmed to the **pure parsers**: `parseWorkBuddyCreditMultiplier`, `isSingularWorkBuddyEffortForm`, `parseWorkBuddyReasoning`, `parseWorkBuddyModel` (strict, unchanged semantics), plus the **new** `parseWorkBuddyModelLoose` (§A3/R8: keeps an entry whose token limits are absent, returns `contextLength`/`maxOutputTokens` = 0 and lets the caller omit the window). The I/O half of the fork file (envelope reads, fetch, credits, check-in, token refresh, `normalizeWorkBuddyReasoning`) is not part of wave 1 — the reasoning half lands in `0002` (plan §B1/B3) together with `normalizeWorkBuddyReasoning` (`fork upstream.ts:1021-1058`). |
| `src/lib/workbuddy/addonInfo.ts:1-259` | `src/lib/workbuddy/addonInfo.ts` | **Minimal** description of the shipped surface only (catalogue, credits, chat, this description). Dropped: the CN/`workbuddy-global` provider rows, the desktop credential-source scan, the check-in capability and the two-edition guarantees — advertising a capability the addon refuses to perform is worse than saying nothing. `WORKBUDDY_ADDON_PROVIDER_IDS` now has just `{ global }`. |
| — | `tests/unit/workbuddy-normalizer.test.ts` | New (plan §9 T2). |
| — | `tests/unit/workbuddy-managed-import.test.ts` | New (plan §9 T3). |
| — | `tests/unit/workbuddy-synced-credit.test.ts` | New (plan §9 T4). |

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

### Deliberate deviations from the plan text (reported, not silent)

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

## DEFERRED (plan §12 — explicitly out of this port)

* **CN edition + `workbuddy-global` provider id.** Needs a *new* id, not a rename: `workbuddy`
  is the global edition upstream (D1) and is already written into live connection rows, synced
  cache keys and the provider registry.
* **Desktop account scan / `api/workbuddy/{accounts,import,checkin}`.** State-mutating and
  filesystem-reading; also the only consumer of the fork's `accounts.ts`, `credentials.ts` and
  the check-in paths.
* **Fork executor failure classification + `accountFallback.ts` pool parking** (fork diff: 236
  lines). Wave 1 ships no executor subclass at all; the thin `WorkBuddyExecutor` + the reasoning
  ladder land in `0002` (plan §B1-B4).
* **`prepareWorkBuddyChatBody`'s non-reasoning rules.** Upstream's registry entry already
  carries `forceStream`, `strictChatHistory` and `bodyStringReplacements`
  (`open-sse/config/providers/registry/workbuddy/index.ts`), so re-applying them would
  double-shape the body.
* **Fork's `GET /models` workbuddy branch and the v4 `C2` stream force.** Obsolete in 3.8.53:
  the generic discovery entry already fetches and persists, and
  `opencodeFreeTierContract.ts` already sets `stream: true`.
* **Not ported files (still listed for completeness):** fork `poolQuota.ts`, `poolState.ts`,
  `freeModel.ts`, `modelDiscovery.ts` (the fork's own cache-invalidator — a different module
  from upstream's `src/lib/providerModels/modelDiscovery.ts`) and the four workbuddy routes;
  they belong to waves 3-4 (§C3/§C4).

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
