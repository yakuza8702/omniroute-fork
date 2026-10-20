# PLAN.workbuddy-port.md — two-feature source port onto OmniRoute 3.8.53

Buildable implementation plan for porting **(A) WorkBuddy catalogue enrichment + (B) the reasoning
contract** — with the credit display (C) and the passthrough capability editor (D) they depend on —
into `omniroute-fork-ci`, replacing the prebuilt-dist splicing era with a **source build** (E).

## 0. Baseline (verified, not assumed)

| Item | Value | Anchor |
|---|---|---|
| Upstream | `3.8.53` @ `e9cb075c` | `package.json:3` |
| Fork source | `/workspace/Omniroute-fork/omniroute-workbuddy`, uncommitted diff off `1d6d1483` | `git status` |
| Deployed image today | npm `omniroute@3.8.52` + heredoc patcher v1–v4 | `Dockerfile:1-40` |
| Fork-ci version pin | `VERSION` build-arg; no source tree in context | `.github/workflows/docker-image.yml:1-40` |

**Citation convention.** `path:lines` is repo-relative to `/workspace/omniroute/_up/OmniRoute` @ `e9cb075c` unless the path starts with `addon/` (this repo, §2) or is a bare basename (`upstream.ts`, `types.ts`, `modelDiscovery.ts`, `accountFallback.ts`, `poolQuota.ts`, …) — bare basenames are **fork** files under `lib/workbuddy/` in `/workspace/Omniroute-fork/omniroute-workbuddy` and are always prefixed "fork". Line numbers were re-verified against `e9cb075c`; a patch that fails `git apply --check` means drift, not a typo.

**The single most important drift finding.** Upstream `workbuddy` is the **global** edition
(`open-sse/config/providers/registry/workbuddy/index.ts:42`, `baseUrl: https://www.workbuddy.ai/v2/chat/completions`),
and 3.8.53 already ships: provider registry entry, OAuth device flow
(`src/lib/oauth/providers/workbuddy.ts:1-160`), `workbuddy` in `NO_PKCE_DEVICE_CODE_PROVIDERS`
(`src/app/api/oauth/[provider]/[action]/route.ts:67-78`), and a discovery config entry
(`providerModelsConfig.ts:959-968`). The fork uses `workbuddy` = **CN** and `workbuddy-global` = global
(`lib/workbuddy/types.ts:35-36`). **The overlay must not adopt the fork's id mapping** — existing
connection rows and synced-cache keys on the data volume are `workbuddy`. Consequence: the CN edition
and the `workbuddy-global` id are **DEFERRED** (§12), and the ported addon is single-edition.

Also obsolete in 3.8.53 (do not port): the fork's `GET /models` workbuddy branch (the generic config
entry already fetches and persists, `route.ts:396-415`), the A1 OAuth splice, the A3b UA splice
(replaced by a static header edit, §A2), and the v4 `C2` stream force
(`opencodeFreeTierContract.ts:362` already sets `stream: true`).

## 1. Decisions (binding)

| # | Decision | Why |
|---|---|---|
| D1 | Keep provider id `workbuddy` = global; one edition table entry. | Data-volume compatibility; no `workbuddy-global` upstream. |
| D2 | Enrich the **normalizer**, not the fetch path. | `persistDiscoveredModels` → `normalizeDiscoveredModels` already runs on preview **and** sync (`route.ts:396-415`, `sync-models/route.ts:636`). |
| D3 | No DB migration. | Synced rows are a JSON blob in `key_value` (`syncedAvailableModelPersistence.ts:81-92`). |
| D4 | `creditMultiplier` is the workbuddy source of truth; `isFree` is derived when a rate exists. | Fork rule `db/models/synced.ts:67-81`; upstream only has payload free-evidence (`providerModels/modelDiscovery.ts:687`). |
| D5 | Reasoning: port the ladder module + a **thin executor subclass**; no fork executor failure/fallback stack. | Keeps `accountFallback.ts` untouched (fork diff: 236 lines). |
| D6 | Persisted effort override wins inside the executor, not only in the catalog. | Otherwise C/D edits are cosmetic (executor reads synced rows directly). |
| D7 | Capability UI reuses existing APIs only: `PUT /api/provider-models` + `PATCH /api/model-capability-overrides`. | Both are already provider-scoped by target; no schema change. |
| D8 | Delivery = source build (`Dockerfile.source`); prebuilt Dockerfile + patcher kept. | Multi-chunk UI/state surface cannot be anchor-spliced (§7.3). |
| D9 | Gate the whole addon with `WORKBUDDY_ADDON` (default `1`) read server-side; UI gates on `isWorkBuddyProviderId`. | Easy removal when upstream #14212 lands. |

## 2. Overlay layout (new files in this repo)

```
addon/
  overlay.sh                      # cp -a files/ ., then git apply patches/*.patch (fail-closed)
  files/…                         # new files (verbatim paths, see below)
  patches/
    0001-workbuddy-enrichment.patch
    0002-workbuddy-reasoning.patch
    0003-workbuddy-credits-ui.patch
    0004-workbuddy-capability-ui.patch
    0005-opencode-free-lane.patch   # preserves shipped 3.8.52 behaviour at source level
  SOURCES.md                     # fork file → upstream destination + rebase notes
```
`overlay.sh` contract: `set -euo pipefail`; `git apply --check` all patches **before** applying any;
`node -e` asserts every post-condition marker exists; prints `overlay ok` + file count.

---

## 3. Feature A — catalogue enrichment (kills the 200k fallback)

### A0. Why it works end-to-end (trace)

`GET /v3/config` → `normalizeWorkbuddyModelsResponse` (`normalizers.ts:349-372`, returns
`{id,name,owned_by}` only today) → `persistDiscoveredModels` (`route.ts:401`) →
`normalizeDiscoveredModels` (`providerModels/modelDiscovery.ts:539-745`) → synced row →
catalog `syncedFields` (`catalog.ts:1319-1327`) → `buildSyncedCapabilities`
(`syncedCapabilities.ts:84-92`) → runtime meta (`src/sse/services/model.ts:109-121,340-341`).
The 200k value only appears when **no** row carries a window
(`catalog.ts:2070-2087`: `if (typeof model.context_length === "number") return undefined`).

### A1. `addon/files/src/lib/workbuddy/types.ts`

Rebase fork `lib/workbuddy/types.ts` (:1-333) to one edition:

```ts
export const WORKBUDDY_PROVIDER_ID = "workbuddy";            // global, upstream-compatible
export const WORKBUDDY_EDITIONS = [{ providerId: "workbuddy", region: "global",
  chatBase: "https://www.workbuddy.ai", configPath: "/v3/config",
  catalogUserAgent: "WorkBuddy/5.5.2", supportsCheckin: false }] as const;
export type WorkBuddyModel = { id: string; name: string; contextLength: number;
  maxOutputTokens: number; creditMultiplier?: number; supportsVision?: boolean;
  supportsToolCall?: boolean; reasoning?: { supportedEfforts?: string[]; defaultEffort?: string;
  canDisableThinking?: boolean }; descriptionZh?: string; descriptionEn?: string };
```
Keep CN constants out of the table (dead-code-free); record them in `SOURCES.md` under DEFERRED.
Same file, the D9 gate — server-only, default on, used by every addon server entry point
(executor B3, normalizer A3, routes C2):

```ts
/** D9 — one env switch for the whole addon; unset/empty ⇒ enabled. Evaluated per call. */
export function workBuddyAddonEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test((process.env.WORKBUDDY_ADDON ?? "1").trim());
}
```
Never import it from a `"use client"` module (it reads `process.env`): clients gate on
`isWorkBuddyProviderId(providerId)`.

### A2. UA for the discovery read — `providerModelsConfig.ts:959-968` patch

Add `"user-agent": "WorkBuddy/5.5.2"` to the `workbuddy` entry's `headers` (desktop channel; the CLI
channel omits the free `x0.00` tier — fork `types.ts:78-88`, `addonInfo.ts:100-110`). Single static
value is correct **because** upstream has one edition (D1); if CN is added later the UA must move to a
per-connection resolver.

### A3. `normalizers.ts:349-372` patch — enriched record

Keep the media exclusion (`isWorkbuddyMediaModel`, :374-388) and the id-drop. Emit:

```ts
{ id, name, owned_by: "workbuddy",
  context_length: m.contextLength, max_input_tokens: m.contextLength,
  max_output_tokens: m.maxOutputTokens,
  ...(m.supportsVision !== undefined ? { supportsVision: m.supportsVision } : {}),
  ...(m.supportsToolCall !== undefined ? { supportsTools: m.supportsToolCall } : {}),
  ...(ladder?.length ? { supportsThinking: true, supportedThinkingEfforts: ladder,
                         defaultThinkingEffort: m.reasoning?.defaultEffort } : {}),
  ...(m.creditMultiplier !== undefined ? { creditMultiplier: m.creditMultiplier,
        isFree: m.creditMultiplier === 0 } : {}),
  ...(desc ? { description: desc } : {}), ...(tags ? { tags } : {}) }
```
`tags` is preview-only (the managed importer drops it) — documented, not a persistence claim.

**Loose parse (new, in `upstream.ts`):** `parseWorkBuddyModel` drops entries with
`contextLength <= 0 || maxOutputTokens <= 0` (fork `upstream.ts:344-390`). A single field missing
upstream would silently shrink the roster. Add:

```ts
export function parseWorkBuddyModelLoose(value: unknown): WorkBuddyModel | undefined
// same as strict, but keeps the entry when limits are absent (id + name + flags only);
// strict parse stays authoritative for credits/free-model paths.
```
The normalizer uses `parseWorkBuddyModelLoose`; `fetchWorkBuddyModels` keeps strict.

### A4. `providerModels/modelDiscovery.ts:687` + `:700-745` patch — forward the rate

`normalizeDiscoveredModels` rebuilds each row explicitly, so unknown fields are dropped. Add:

```ts
const creditMultiplier = typeof record.creditMultiplier === "number"
  && Number.isFinite(record.creditMultiplier) && record.creditMultiplier >= 0
  ? record.creditMultiplier : undefined;
const isFree = creditMultiplier !== undefined ? creditMultiplier === 0
  : (!explicitlyPaid && hasPayloadFreeEvidence({ ...record, id }));
```
and `...(creditMultiplier !== undefined ? { creditMultiplier } : {})` in the `deduped.set` object.
An explicit positive rate beats the `-free`-suffix heuristic — that is the point.

### A5. `db/models/synced.ts` patch — type + read path

Port fork `:33` (interface field), `:67-81` (normalize rule), `:126-127` (write) onto upstream
`synced.ts:38` / `:135`. The read path matters as much as the write path: rows are re-normalized on
every load, so a missing rule would erase the rate after a restart.

### A6. `discovery/catalogModels.ts:11-23` patch — preview projection

`toDiscoveryCatalogModel` whitelists fields; add `creditMultiplier` and `isFree`
(`...(typeof model.creditMultiplier === "number" ? { creditMultiplier } : {})`,
`...(model.isFree === true ? { isFree: true } : {})`). Without this, synced-workbuddy rows reach the
dashboard without a rate even though the row stores one.

### A7. Manual import path (optional, 6 lines) — `useModelImportHandlers.ts:264-290`

Forward `context_length`/`max_output_tokens` in the `POST /api/provider-models` body so the
"add custom model" import does not lose the window. The primary path (Sync) needs nothing.

---

## 4. Feature B — reasoning contract

### B1. `addon/files/open-sse/executors/workbuddyReasoning.ts`

Port fork `:1-157` unchanged (`resolveWorkBuddyReasoningContract`, 15 s row cache,
`resetWorkBuddyReasoningContractCache`). It reads `getSyncedAvailableModelsByConnection` and maps
provider → synced ids; collapse the fork's `workbuddy-global` alias branch to the single id.

### B2. Override-first ladder (new, required by D6)

In `resolveWorkBuddyReasoningContract`, before the row lookup:

```ts
const override = getReasoningEffortsOverride(input.provider, input.model);
if (override?.length) return { supportedEfforts: [...override] };
```
(`src/lib/db/modelCapabilityOverrides.ts:132-153` — `getReasoningEffortsOverride(provider, modelId,
bulk?)`; this is the same read `getResolvedModelCapabilities` uses at `modelCapabilities.ts:1021-1024`.)
Its signature takes the **bare** provider and model id (not a `/`-joined target) and accepts a
pre-loaded `bulk` map — pass the runtime map when one is already in hand: it adds no per-request query
when a bulk override map is already in hand; on the null-bulk path `getReasoningEffortsOverride` does
a direct SQL read (`db/modelCapabilityOverrides.ts:139-155`). `setModelCapabilityOverride`/DELETE
invalidate the `"model-capabilities"` cache (`:182`/`:199`), so stale `effort_tiers` cannot persist
after an override save/erase. Document in the file header that the persisted override is authoritative
for both the catalog and the wire.

### B3. `addon/files/open-sse/executors/workbuddy.ts` (thin, new)

```ts
export class WorkBuddyExecutor extends DefaultExecutor {
  constructor(provider = "workbuddy") { super(provider); }
  override async transformRequest(model, body, stream, credentials) {
    const out = await super.transformRequest(model, body, stream, credentials);
    if (!workBuddyAddonEnabled()) return out;
    const contract = await resolveWorkBuddyReasoningContract({
      provider: this.getProvider(), model,
      connectionId: (credentials as { connectionId?: string })?.connectionId ?? null });
    return normalizeWorkBuddyReasoning(out as Record<string, unknown>, contract);
  }
}
```
Uses `normalizeWorkBuddyReasoning` (fork `upstream.ts:1021-1058`). Deliberately **not** ported:
`prepareWorkBuddyChatBody`'s other rules — upstream's registry already carries `forceStream`,
`strictChatHistory`, `bodyStringReplacements` (`registry/workbuddy/index.ts:63-65`), so re-applying
them risks double-shaping.

### B4. `open-sse/executors/index.ts:29` + `:226` patch

Add two lazy keys in map order (`workbuddy`, `wb`); `getExecutor` resolves the map and falls back to
`DefaultExecutor`. Update the golden snapshot (`tests/unit/executor-map-golden.test.ts:1-40` reads the
literal from source) in the same commit.

### B5. `sync-models/route.ts:636-641` patch — cache invalidation

After `await importManagedModels({...})` insert:

```ts
await invalidateWorkBuddyModelCaches();   // lib/workbuddy/modelDiscovery.ts:142-146
```
The contract cache TTL is 15 s; without this a just-synced ladder keeps rejecting efforts until it
expires. Guard with `providerToWorkBuddyProviderId(logProvider)` so other providers pay nothing.

---

## 5. Feature C — credits

### C1. Pure surface

`addon/files/src/shared/utils/workBuddyCredit.ts` — port fork `:27-78` verbatim
(`isWorkBuddyProviderId`, `declaredWorkBuddyCreditMultiplier`, `workBuddyPriceTier`,
`formatWorkBuddyCreditBadge`). Client-safe (no DB imports).

### C2. Badge + 4 integrations

| File | Change | Anchor |
|---|---|---|
| `WorkBuddyCreditBadge.tsx` (new) | port fork file | — |
| `ModelRow.tsx` | add `creditMultiplier?` to `ModelRowProps.model`; render badge after source badge | `:263-264`, `:377` |
| `PassthroughModelRow.tsx` | add `creditMultiplier?: number \| null` prop; render after `ModelSourceBadge` | `:23-60`, `:246-256` |
| `PassthroughModelsSection.tsx` | add `creditMultiplier` to the row type + `declaredWorkBuddyCreditMultiplier(model)`; pass down | `:236-244`, `:272`, `:453-499` |
| `CompatibleModelsSection.tsx` | same mapping + pass `provider={providerStorageAlias}` | `:252`, `:281`, `:324`, `:564-623` |

The existing `freeFilter` / `sortFreeFirst` toolbar (`Pass-throughModelsSection.tsx` toolbar props,
`CompatibleModelsSection.tsx:530-545`) needs **no new code** — it becomes correct once `isFree` is
rate-derived (D4). Say so in the PR body; do not add a second filter.

### C3. Routes + pool

Port from fork, rebased to one edition and **without** desktop-account import/check-in:

```
src/app/api/workbuddy/_lib.ts            (guard + error shaping; fork :55-120)
src/app/api/workbuddy/models/route.ts    (fork :26-79)   → provider readiness + roster
src/app/api/workbuddy/free-model/route.ts(fork :30-91)
src/app/api/workbuddy/credits/route.ts   (fork :186-302; ?all=true ?detail=fast ?refresh)
src/app/api/workbuddy/info/route.ts      (addonInfo; fork)
src/lib/workbuddy/{upstream,accounts,poolQuota,poolState,freeModel,addonInfo}.ts
```
`accounts.ts` is trimmed to `credentialFromWorkBuddyConnection` + `listWorkBuddyConnections`
(connection-backed only); the desktop filesystem scan and `import|checkin` routes are DEFERRED.
`poolQuota.ts` keeps the 10-minute snapshot TTL, per-connection in-flight dedupe, and
`Promise.allSettled` per-account settlement. `poolState.ts` is optional at runtime: exclusions are
reported when the file exists; the writer is behind `WORKBUDDY_POOL_STATE=1` (default `0`) so the
image never writes into the data volume unless asked (§10 risk R4).

### C4. Provider Quota account row

New `WorkBuddyPoolCreditBadge.tsx` (client): fetches
`GET /api/workbuddy/credits?all=true&detail=fast&connectionId=<id>`, renders total + nearest expiry,
`?refresh=1` on click. Insert **outside** the `quotaPanelSupported` gate — `workbuddy` is absent from
`USAGE_SUPPORTED_PROVIDERS` (`open-sse/services/usage/supportedProviders.ts:20-112`, re-exported at
`src/shared/constants/providers.ts:507`, consumed by `supportsProviderQuota` in
`providerQuotaVisibility.ts:15-28`) and it is not an `openai-compatible-*` id, so the Provider Limits
panel never renders a card for it and this badge is the only credits surface. Anchor at
`ConnectionRow.tsx:837-847`, immediately after the existing quota block so it inherits the same row
layout:

```tsx
{isWorkBuddyProviderId(String(connection.provider || "")) ? (
  <div className="basis-full min-w-0"><WorkBuddyPoolCreditBadge connectionId={connection.id} /></div>
) : null}
```

---

## 6. Feature D — passthrough capability editor

Reuse the row's existing prop surface (`PassthroughModelRow.tsx:55-60`, editor logic `:139-160`,
handler render `:263-341`) and the exact pattern already proven in `CompatibleModelsSection.tsx`:

* **ctx window** — lift `fetchProviderContextOverrides` (`CompatibleModelsSection.tsx:92-120`) into
  `providerPageHelpers` (or a `useModelContextOverrides(providerStorageAlias)` hook) and use it in
  `PassthroughModelsSection` (state after `:148`; pass `contextWindowOverride`,
  `onSaveContextWindowOverride`, `savingContextOverride` at `:453-499`). Persist with
  `PUT /api/provider-models` `{provider, modelId, contextWindowOverride}` — route `:222-409`,
  schema `provider.ts:275,313`; the compatOnly branch persists it even with no custom row.
* **vision** — new `onSaveSupportsVision?: (modelId, value: boolean|null) => Promise<void>` prop,
  rendered as a small eye toggle next to the vision badge (`:246-256`). Same PUT with
  `supportsVision` (schema `:313`; compat override read by `getCompatVisionOverride`).
* **effort override** — new `WorkBuddyReasoningEffortEditor.tsx` + client-safe
  `src/shared/utils/workBuddyEfforts.ts`:

```ts
export const WORKBUDDY_EFFORT_OVERRIDE_VALUES = ["none","low","medium","high","xhigh","max"] as const;
```
  This is the intersection of the gateway ladder (`upstream.ts:896-904`: adds `minimal`) and the
  override vocabulary (`shared/reasoning/reasoningEffortsOverride.ts:1-9`: adds `ultra`). Persist with
  `PATCH /api/model-capability-overrides` `{target: `${providerId}/${modelId}`, key: "reasoning_efforts",
  value: "low,medium,high"}` (body schema `route.ts:102-116`, handler `:177`; parser
  `shared/reasoning/reasoningEffortsOverride.ts:27-52`, imported at `route.ts:95`). Clear with
  `DELETE ?target&key` (`route.ts:227`).
* **Provider-scoped vs global (decision, D7).** No extension of `model_context_overrides` and no
  schema keys: the capability-override API is *already* keyed per `provider/model`
  (`src/lib/db/modelCapabilityOverrides.ts:132-204`), the settings tab only *filters targets* to the
  pricing catalog (`ModelCapabilityOverridesTab.tsx:48-80,120-150`) — the API was never global. Using
  it keeps one storage path, one parser, one cache-invalidation path, and gives D6's executor read for
  free — `setModelCapabilityOverride`/`removeModelCapabilityOverride` already call
  `invalidateDbCache("model-capabilities")` (`:182`, `:199`), which is exactly the invalidation B4's
  row cache must also honor. `model_context_overrides` stays ctx-window-only
  (`db/modelContextOverrides.ts:1-115`).

Loading current values: `GET /api/model-capability-overrides` (`listPublicOverrides`, `route.ts:167`)
returns the whole `overrides` array — filter client-side by `target`; `GET /api/provider-models?provider=`
for ctx overrides. No new endpoint.

---

## 7. Delivery mechanics (E)

### 7.1 Why source (and why dist-splice is rejected)

| | Prebuilt splice | Source build |
|---|---|---|
| Time | ~3 min | 12–20 min (upstream measured 12–17; `Dockerfile:151`) |
| Surface | byte-unique anchors in minified chunks | any typed edit |
| Reproducible | yes (pinned tarball) | yes (pinned SHA + `npm ci`) |
| This port | **impossible**: D/C touch 6 client components, shared hooks, i18n catalogs and a new state machine; A touches two server modules in one function | native |

The v4 patcher already shows the failure mode: `expectFiles` counts go stale across versions and the
whole build fails closed (`Dockerfile` A1 `expectFiles:3`, A3b `expectFiles:2`). Adding ~15 UI anchors
per release is not maintainable — **reject dist-splice, keep it only for the 3.8.52 line.**

### 7.2 `Dockerfile.source` (new, three stages)

```
# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:26-trixie-slim

FROM ${NODE_IMAGE} AS fetch
ARG SOURCE_REPO=https://github.com/diegosouzapw/OmniRoute.git
ARG SOURCE_REF=e9cb075cf6db161661b01f5dde2a1f0b033f7660   # full SHA, pinned in SOURCES.md
ARG VERSION=3.8.53
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# full SHA: git rejects abbreviated wants (verified in-session)
RUN git init /src && git -C /src remote add origin "$SOURCE_REPO" \
 && git -C /src fetch --depth=1 origin "$SOURCE_REF" && git -C /src checkout --detach FETCH_HEAD \
 && test "$(git -C /src rev-parse HEAD)" = "$SOURCE_REF" \
 && test "$(node -p "require('/src/package.json').version")" = "$VERSION"
COPY addon/ /src/addon/
RUN bash /src/addon/overlay.sh

FROM ${NODE_IMAGE} AS builder
# mirror upstream build prerequisites exactly: Dockerfile:90 (NEXT_TELEMETRY_DISABLED=1),
# :97 (apt python3 make g++), :101-118 (workspace manifests first), :131-135
# (`npm ci --include=optional --no-audit --no-fund --legacy-peer-deps --ignore-scripts` then
# better-sqlite3 node-gyp rebuild), :162-163 (OMNIROUTE_USE_TURBOPACK=0 → webpack),
# :185 (OMNIROUTE_MITM_STUB=1), :198-199 (ARG NODE_OPTIONS default 6144, then
# NODE_OPTIONS=--max-old-space-size), :231 (CIRCLE_NODE_TOTAL), :236 (`npm run build`).
# Yarn/pnpm are NOT used: the repo ships package-lock.json and `npm ci` is the reproducible path.
COPY --from=fetch /src /src
RUN --mount=type=cache,id=wb-npm,target=/root/.npm ... && cd /src && npm ci ... && npm run build

FROM ${NODE_IMAGE} AS runner
# COPY --from=builder /src/.build/next/standalone ./  (same layout as Dockerfile:284-290)
# + better-sqlite3 package, healthcheck.mjs (Dockerfile:294), mount migrations from
# <standalone>/migrations (Dockerfile:291), /app/data, USER node, CMD
# ["node","dev/run-standalone.mjs"] (Dockerfile:316), PORT=20128, EXPOSE 20128.
```
Build args kept: `VERSION`, `SOURCE_REF`, `ADDON_REV` (cache-buster for `addon/`), `APT_MIRROR`,
`NPM_REGISTRY`. No patcher args here; `PATCH_*` remain prebuilt-only.

### 7.3 CI (`.github/workflows/docker-image.yml`)

Add `build_mode` (`choice: source|prebuilt`, default `source`), `source_ref` (`string`, default
`e9cb075cf6db161661b01f5dde2a1f0b033f7660` — the full 40-hex SHA; the source build never accepts an
abbreviated ref). Conditional steps:

* `prebuilt` → npm preflight + `file: ./Dockerfile` + `PATCH_*` args (unchanged, still supports 3.8.52).
* `source` → skip npm preflight; `file: ./Dockerfile.source`; build-args `VERSION`, `SOURCE_REF`,
  `ADDON_REV=${{ github.sha }}`; cache scope `docker-amd64-src`; `timeout-minutes: 90`.
* Tags: source `:<version>-wb` (+ `:latest` when `promote_latest`); prebuilt unchanged `:<version>`.
  Once the source image passes the checklist twice, promote source to `:<version>` and demote prebuilt
  to `:<version>-npm` (documented flip, not automatic).
* Smoke gate unchanged (TCP 20128, `docker-image.yml:190-230`) — generic port-reachability smoke only,
  no addon route assertion in the build gate. Addon routes are checked later: the `/api/workbuddy/info`
  assertion is **enabled from rollout step 3** (§11) and lives there, not here.

### 7.4 Back-compat

Provider id `workbuddy` unchanged; `DATA_DIR=/app/data` unchanged; no migrations; existing synced rows
(built by 3.8.52) simply lack `creditMultiplier` → badge hidden until the next sync (documented in the
release note). Prebuilt mode keeps working against 3.8.52 and needs no changes.

---

## 8. Schema / migration notes

| Store | Change | Migration |
|---|---|---|
| `syncedAvailableModels` (JSON in `key_value`) | `+ creditMultiplier?: number` (the normalizer copies fields by NAME — add `creditMultiplier` to the field-copy list at `db/models/synced.ts:120-150` alongside the type+rule or rows never carry it; see §3 A5) | none |
| `model_context_overrides` | unchanged (ctx only) | none |
| `model_capability_overrides` | unchanged (`reasoning_efforts` already supported) | none |
| `DATA_DIR/workbuddy-pool-state.json` | optional, 0600, atomic rename | created lazily |
| Provider registry | `workbuddy` entry unchanged | none |

Round-trip rule to test: write `creditMultiplier: 0` → read `{isFree: true, creditMultiplier: 0}`;
write `0.03` → `{isFree: false}`; write nothing → `isFree` untouched.

---

## 9. Test matrix

Harness: `node:test` via the repo's script (`package.json` `test:unit`), files at `tests/unit/*.test.ts`
(included by the glob). Vitest is **not** used for these (its include list covers `__tests__` and
`.test.tsx`).

| ID | File (new) | Asserts |
|---|---|---|
| T1 | `tests/unit/workbuddy-credit.test.ts` | tier `0→free`, `>0→paid`, `undefined/NaN/negative→unknown`; `format` `"free (0.00x)"` / `"paid (0.03x)"` / `null`; id gate `wb|wbg|workbuddy*`, rejects bare `cn`/`global` |
| T2 | `tests/unit/workbuddy-normalizer.test.ts` | snapshot of enriched record; 1M/64k survive; `supportsImages:false` → no flag (documented); media-tag entries dropped; **loose parse keeps a limit-less id**, strict drops it |
| T3 | `tests/unit/workbuddy-managed-import.test.ts` | synthetic discovery payload → `normalizeDiscoveredModels` → `inputTokenLimit=1_000_000`, `outputTokenLimit`, `supportedThinkingEfforts`, `creditMultiplier`, `isFree`; then `normalizeSyncedAvailableModels` round-trip through JSON |
| T4 | `tests/unit/workbuddy-synced-credit.test.ts` | rate/free precedence: rate `0.03` beats `isFree:true` payload evidence; no rate keeps legacy bit |
| T5 | `tests/unit/workbuddy-reasoning.test.ts` | `normalizeWorkBuddyReasoning`: strip when no ladder, clamp up, `off→none` when allowed, `off→floor` when refused; override-first contract (B2) |
| T6 | `tests/unit/workbuddy-pool-quota.test.ts` | TTL reuse, `detail=fast` never fetches, `allSettled` isolates a dead token |
| T7 | `tests/unit/workbuddy-catalog-projection.test.ts` | `toDiscoveryCatalogModel` carries `creditMultiplier`/`isFree` |
| — | `tests/unit/executor-map-golden.test.ts` | regenerate for the two new keys (B4) |

Gates (CI + local): `npm run typecheck:core`, `npm run check:open-sse-typecheck`,
`npm run check:dashboard-typecheck`, `npm run lint`, then targeted
`node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test tests/unit/workbuddy-*.test.ts`.
i18n: reuse existing keys (`contextWindowOverrideLabel`, `freeBadge`); any new key must land in **every**
`src/i18n/messages/*.json` (`i18n-key-completeness` / parity tests).

Manual checklist (on the built image):
1. Provider page → workbuddy row shows ctx value `1,000,000`, edit → 900000 → save → badge updates → reload → persists.
2. Toggle vision on a text-only model → catalog `/v1/models` reflects it after reload.
3. Effort override `low,high` → `/v1/models` `capability.effort_tiers=["low","high"]`; `reasoning_effort:"max"` on the wire is clamped to `high` (executor log/proxy capture).
4. Credit badges render on passthrough + compatible rows; free-first sort puts `x0.00` first.
5. Provider Quota row shows remaining credits; `?refresh=1` re-reads upstream.
6. Restart container → all of the above survive (SQLite volume).

---

## 10. Risk table

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | 3.8.53 vs fork base `1d6d1483` drift (UI props, sync route, executor map) | patches fail / silent divergence | every patch is `git apply --check` fail-closed; anchors in §3–§6 are from `e9cb075c`; rebase only what is listed |
| R2 | Upstream #14212 first-class workbuddy collides | duplicate routes/components | whole addon behind `WORKBUDDY_ADDON`; overlay files deletable; B5 guarded by provider id |
| R3 | `workbuddy-global` absent upstream / CN edition | operators with CN accounts | DEFERRED §12; single-edition table; never remap `workbuddy` |
| R4 | poolState write on the data volume (node uid 1000, 0700/0600) | credits table wrong, not chat | writer off by default (`WORKBUDDY_POOL_STATE=0`); all fs ops fail-open; badge shows `unknown`, never `0` |
| R5 | per-edition UA correctness | wrong roster (free models missing) | one edition → static desktop UA (§A2); assert in T2 that the request carries it (unit-level header test) |
| R6 | rows without `credits` string | badge/claim | `undefined` → no badge, `unknown` status, never "free" (T1/T4) |
| R7 | `minimal` / `ultra` vocabulary mismatch | 400 on override save | UI offers intersection only (§6); documented in the editor tooltip |
| R8 | loose parser keeps limit-less ids | 0/unknown windows | preferred over dropping models; enrichment leaves `context_length` absent → existing fallback applies |
| R9 | source build time / memory on 16 GB runners | flaky CI | upstream-proven knobs (`CIRCLE_NODE_TOTAL=2`, 6144 MB); 90-min timeout; gha cache |
| R10 | git clone at build time | supply-chain / availability | pin full SHA; `SOURCE_REPO` overridable to a mirror; verify SHA prefix + package version |
| R11 | new UI strings | i18n parity test red | reuse keys; otherwise update all catalogs |

---

## 11. Rollout order

1. `addon/` skeleton + `overlay.sh`; A patches; T2/T3/T4 green → build source image (`:<ver>-wb`).
2. B (executor + reasoning) + T5 + golden update; verify clamp with a captured request.
3. C badges + routes + pool; T1/T6/T7; Provider Quota badge. **Enable the §7.3 addon post-smoke
   assertion here** (first step that ships the addon routes): `curl -s -o /dev/null -w '%{http_code}'
   /api/workbuddy/info` ∈ {200,401,403} — proves the overlay compiled into the standalone output.
4. D editors; manual checklist items 1–3.
5. Flip tags (`source` → `:<version>`) after two clean builds; announce prebuilt deprecation.

## 12. Deferred (explicitly out of this port)

* CN edition + `workbuddy-global` provider id (needs a *new* id, not a rename; D1).
* Desktop account scan / `api/workbuddy/{accounts,import,checkin}` (state-mutating, FS-reading).
* Fork's executor failure classification + `accountFallback.ts` pool parking (236-line diff).
* `prepareWorkBuddyChatBody`'s non-reasoning rules (registry flags already cover them).

Do not use built-in web search. Use omniroute tools only (omniroute_search_web, omniroute_fetch_page, omniroute_fetch_full, omniroute_rerank_documents, omniroute_semantic_rank).
