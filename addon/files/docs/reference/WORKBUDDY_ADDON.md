---
title: "WorkBuddy addon — operator brief"
version: "3.8.53-wb"
lastUpdated: "2026-10-21"
---

# OmniRoute Workbuddy addon — operator brief

The operator-facing "what is this, what did we change, how do we get rid of it" page. The
authoritative file-by-file map is `addon/SOURCES.md` in the fork-ci repository (it is not shipped
inside the image); this brief is the _why_, the _gaps_, and the _resume_ instructions. Everything
below describes **source** hunks — the addon is applied by `addon/overlay.sh` onto a pristine
upstream checkout, never by splicing compiled bundles.

## 1. What ships (waves 1–4, plus wave 5)

| Surface              | Artifact                                                                           | What it does                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device OAuth         | patch `0009`                                                                       | `workbuddy` is a member of the modal's `DEVICE_CODE_PROVIDERS`; the connect panel asks the gateway for a device code instead of demanding a PKCE callback the provider never performs.                                                  |
| Discovery enrichment | patch `0001`                                                                       | `User-Agent: WorkBuddy/5.5.2` on the catalogue read, the loose parser (a limit-less entry still counts), `creditMultiplier`/`isFree` carried through the synced store, and the window forwarded on manual import as `max_input_tokens`. |
| Model capabilities   | patches `0001`, `0002`, `0004`                                                     | Context/vision/tool/thinking recorded per model; the executor clamps a requested effort onto the model's ladder; the passthrough editor exposes the effort override and the vision toggle.                                              |
| Credit display       | patches `0003`, `0007`                                                             | Model-row badges (`WorkBuddyCreditBadge`), the connection-row pool strip (`WorkBuddyPoolCreditBadge`), and — wave 5 — the same strip as the `Credits` slot of a Provider Quota card.                                                    |
| Pool engine          | copied `src/lib/workbuddy/poolQuota.ts` + `src/app/api/workbuddy/credits/route.ts` | One snapshot per connection, `detail=fast` = snapshot only (zero billing calls), `refresh=1` = re-read the billing endpoint.                                                                                                            |

Components (all under `src/app/(dashboard)/dashboard/providers/[id]/components/`):
`WorkBuddyCreditBadge` (declared rate, renders nothing without a claim),
`WorkBuddyPoolCreditBadge` (pooled remaining, promotes itself once to a full probe when the fast
snapshot has no verdict), `WorkBuddyReasoningEffortEditor` (six-level override), and the shared
`ModelCompatPopover` in its `compact` (icon-only, `aria-label` kept) form.

## 2. Upstream vs. what we patched

- **`DEVICE_CODE_PROVIDERS` omitted `workbuddy`.** The server already serves the flow
  (`NO_PKCE_DEVICE_CODE_PROVIDERS` in the oauth route, `flowType: "device_code"` in the provider
  registry); only the modal's set was missing the id, so the UI fell through to the PKCE branch.
  `0009` adds the member, with the rationale recorded next to it.
- **The opencode free lane sent the connection key (B1v2).** `0005` computes
  `anonymousFreeTierKey = gatedScope ? (process.env.OPENCODE_ANONYMOUS_KEY ?? "").trim() : ""` and
  prefers it on gated requests only — paid models, the `/zen/go` surface and `opencode-go` keep the
  resolved key; an unset env is byte-identical to upstream.
- **Known-free ids were demoted by an incomplete catalog.** `0005` restores the short-circuit in
  `isPremiumOpencodeModel`: `-free` ids and the legacy free set are free before any catalog lookup,
  so an "Import from /models" that drops the free flag no longer turns `big-pickle` into a 402.
- **The Compatibility action was the only labelled row button.** It clipped on the right-column
  model cards; `0006` splits the trigger and makes `ModelRow` pass `compact` (the passthrough row
  already did). The brief that requested it called it "0008"; in this series it is `0006`, and
  `0008` is the docs-index patch that lists this page.
- **`workbuddy` is absent from `USAGE_SUPPORTED_PROVIDERS`.** `supportsProviderQuota()` is
  therefore false and Provider Quota dropped the connection entirely. `0007` admits it through
  `workBuddyCreditsForDisplay(conn)` (provider family + non-empty id) and renders the pool badge
  as the card's `Credits` slot; the card's own refresh is a no-op for it, because the strip owns
  the refresh path (`?refresh=1`).

## 3. Known gaps (CSV3)

- **`workbuddy-global` — DEFERRED.** The addon serves one edition (`workbuddy` = the global
  gateway). A second provider id would need its own connection rows, registry entry and cache keys;
  nothing in the port assumes it.
- **Desktop account scan / import / check-in — DEFERRED.** `accounts.ts` is connection-backed
  only; there is no filesystem credential scan, no `import|checkin` route, and no pool-park clear.
- **Env-doc debt.** `WORKBUDDY_ADDON` (addon kill switch, unset ⇒ enabled) and
  `WORKBUDDY_POOL_STATE` (exclusion writer, default `0`) are read from `process.env` but are not
  listed in `.env.example` / `docs/reference/ENVIRONMENT.md`. `scripts/check/check-env-doc-sync.mjs`
  would flag both, so do not wire it into a gate before adding the two rows.
- **Quota budget bar.** Only the connection-level strip ships. There is no stacked per-account bar
  on the quota page: the pool total is per connection, not an aggregate across connections.

## 4. Removing the addon (when upstream #14212 lands)

1. `WORKBUDDY_ADDON=0` on the container: `workBuddyAddonEnabled()` is evaluated per request at the
   executor's `transformRequest`, so the ladder rewrite stops immediately. Everything else stays
   mounted (routes, badges, docs) and keeps answering — the switch is a behaviour gate, not an
   uninstall.
2. Audit before deletion: `bash addon/overlay.sh /tmp/checkout` against a pristine checkout, then
   grep the tree for the overlay markers (see §5) — every marker names a file and the exact string
   the series expects, which is precisely the removal checklist.
3. Delete `addon/` from the fork-ci repository and stop building `Dockerfile.source`. The upstream
   PR makes `0009`, `0005` and the enrichment hunks moot; `0007`/`0008` only matter while the
   dashboard lacks the slot.
4. Tests and this document are safe to keep — they are inert without the overlay.

## 5. Resuming in a future session

1. **Build (dry run).** `bash addon/overlay.sh /tmp/checkout` on a pristine checkout of the pinned
   upstream SHA. Success ends with `overlay ok — N patch(es), M file(s)`; a drifted anchor exits
   `1` **before** anything reaches the work tree.
2. **Verify.** The overlay asserts **43** post-condition markers, then run the suite in the
   overlaid tree: `TMPDIR=/tmp npm test` (the eleven `tests/unit/workbuddy-*` files are 111 cases) plus
   `npm run typecheck` for core / open-sse / dashboard. Prettier the new files.
3. **Commit and push** the `addon/` directory (patches, `files/`, `overlay.sh`, `SOURCES.md`).
   `Dockerfile.source` is the only build consumer: it fetches the pinned SHA, copies `addon/`, runs
   `overlay.sh`, then `npm run build`.
4. **Land it.** Build and push the image (`docker compose ... build && push`), then
   `docker compose up -d` on the target pulling `3.8.53-wb`. The image tag carries the addon; a
   plain `3.8.53` pull is upstream and has none of it.
5. **Env rules.** `OPENCODE_ANONYMOUS_KEY=public` and `OPENCODE_CLIENT=cli` for the keyless Zen
   lane; leave `WORKBUDDY_POOL_STATE` unset unless a volume-written exclusion file is wanted.

## 6. Deviation index (D-1..D-36, one line each)

**Wave 1 (D-1..D-5):** window fields omitted when the parse is not positive (D-1); manual import
sends `max_input_tokens`, not `context_length` (D-2); `isFree: false` is written back instead of
being laundered into "unknown" (D-3); the pre-existing catalogue pin moved with the enriched record
(D-4); `supportsVision: false` stays a discovery-only claim (D-5).

**Wave 2 (D-6..D-11):** the two executor modules travel inside `0002` as added-file diffs (D-6);
the golden _snapshot_ moved, the golden test did not (D-7); both map keys build the canonical
`workbuddy` instance (D-8); `transformRequest` guards a non-object body (D-9); B5 resolved to a new
minimal `lib/workbuddy/modelDiscovery.ts` (D-10); `Dockerfile.source` needed no migration copy
(D-11).

**Wave 3 (D-12..D-21):** the discovery mapping lives in the copied module, not a hunk (D-12); the
preflight became cumulative via a throwaway index (D-13); the effort editor seeds its draft on open
(D-14); vision is a two-state toggle, never `null` (D-15); `useModelContextOverrides` duplicates one
stable pattern (D-16); pool reads are testable through a `deps` seam (D-17); `poolState.ts` ships a
disabled writer (D-18); no new i18n keys (D-19); the credits route also serves the single-account
read (D-20); a 401 is reported, not rewritten (D-21).

**Wave 4 (D-22..D-29):** no blocklist patch (D-22); two pre-existing opencode assertions move with
the rule (D-23); the env knob is documented in `.env.example` + `ENVIRONMENT.md` (D-24); the free
rule lives in `isPremiumOpencodeModel`, not the gate (D-25); the badge promotes once per connection
and refresh is a full read (D-26); the promotion rule is a separate copied module (D-27); the
compact trigger is fixed in `ModelCompatPopover` with `ModelRow` opting in (D-28); the icon-only
button keeps its accessible name (D-29).

**Wave 5b (D-30..D-33):** the A1 splice returns as a source patch (D-30); the authorize probe has
no source-mode counterpart, so the check is `POST /api/oauth/workbuddy/device-code` (D-31); no unit
test, two post-condition markers instead (D-32); the file is `0009` because `0007`/`0008` are the
wave-5 quota and docs deliverables (D-33).

**Wave 5 (D-34..D-36):** the Provider Quota injection is three upstream hunks
(`ProviderLimits` → `QuotaCardGrid` → `QuotaCard`), not the one plan anchor, because the card body
lives in `QuotaCard` and the grid is the only path that can carry a per-connection node (D-34); the
quota-page wrapper (`dashboard/quota/page.tsx`) is a 34-line render shell and receives no hunk —
there is no card markup in it to expand (D-35); `workBuddyCreditsForDisplay` returns the connection
id, not a boolean, so the admission gate and the badge's `connectionId` are one decision (D-36).

## 7. File map

- `addon/overlay.sh` — copy `files/`, preflight the series cumulatively, apply, assert markers.
- `addon/patches/0001..0009` — one patch per feature; all hunks target upstream files.
- `addon/files/` — new modules, components, routes, tests and this document (copied, not patched).
- `addon/SOURCES.md` — per-file provenance, upstream anchors, wave log, full deviation text.
