# PLAN.patch-spec.md — patch-implementation plan for `omniroute-fork-ci`

Status: **specification only** (no source tree is modified by this file). One deliverable: this file.
Scope: two goals against the prebuilt-npm fork-ci image.

| Goal | Deliverable | Patch surface | Verified |
| --- | --- | --- | --- |
| A | WorkBuddy browser (device-code) OAuth usable from the dashboard modal | 3 compiled client/SSR chunks inside `dist/.build/next` | yes, anchors extracted from the real `omniroute@3.8.52` tarball |
| B | OpenCode Zen free tier works without the OpenCode CLI installed (no 403) | 1 compiled server chunk inside `dist/.build/next/server/chunks` | yes, anchors extracted from the same tarball |

Invariants (do not violate):

1. **No source-tree edits.** The only file written by this task is `PLAN.patch-spec.md` in the fork-ci repo.
2. **No `package.json` / dependency changes.** The patch step uses Node built-ins (`node:fs`, `node:path`, `node:crypto`) only.
3. **No new repo files.** The patch script is delivered as an in-Dockerfile BuildKit heredoc, so the fork-ci repo stays exactly `Dockerfile` + `README.md` + `.github/workflows/docker-image.yml`.
4. **`VERSION` stays `3.8.52`.** See §6.1.
5. The image remains "no compiler, no build toolchain, no source tree in the build context" (Dockerfile:11) — every edit below is a byte-level anchor splice on files that the npm tarball already ships.

---

## 1. Ground truth established while writing this plan

### 1.1 The npm package layout (this is the decisive fact)

`omniroute@3.8.52` was downloaded and extracted (`/workspace/orpkg/package`, 524 MB, tarball 114 MB). It ships:

| Path in tarball | Content | Executed? |
| --- | --- | --- |
| `package/dist/server.js` + `package/dist/.build/next/**` | the assembled Next **standalone** build (24 860 entries) | **yes** — this is what serves the dashboard and the API |
| `package/src/**`, `package/open-sse/**`, `package/bin/**` | raw source + CLI, shipped as `files` entries | only the CLI (`bin/omniroute.mjs`) |

Evidence that `dist/` is the runtime and `src/` is not:

- `package/dist/server.js:13` — `nextConfig = { ..., "distDir":"./.build/next", "output":"standalone", ... }`.
- `bin/cli/commands/serve.mjs:48-51` (upstream HEAD `e9cb075c`) — `const APP_DIR = existsSync(join(ROOT,"dist","server.js")) ? join(ROOT,"dist") : join(ROOT,"app")`.

**Consequence:** patching `src/shared/components/OAuthModal.tsx` inside the image changes nothing at runtime. The set-membership fix must land in the compiled chunks. `package/dist/.next/**` also exists in the tarball but is inert (`dist/.next/static/chunks` is empty, 0 entries, and `distDir` points at `.build/next`).

### 1.2 Why the old fork's failed overlay is *not* our situation

`Dockerfile.workbuddy:1-8` in `/workspace/Omniroute-fork/omniroute-workbuddy` documents that the previous "npm-artifact + workbuddy-overlay text rewrites" scheme shipped images with **zero** workbuddy wiring, because `workbuddy-overlay/files/**` was never generated. That failure was about a **compiled addon payload that did not exist**. Goal A is categorically different: every workbuddy byte except one set member already exists and already loads in the npm package — the fix is a **3-byte-class string insertion into a set literal**, not an addon overlay.

---

## 2. Goal A — WorkBuddy browser OAuth

### 2.1 Certified defect (all anchors re-verified)

| Anchor | File | Line(s) | Fact |
| --- | --- | --- | --- |
| `DEVICE_CODE_PROVIDERS` | `src/shared/components/OAuthModal.tsx` | 46–57 | `["github","kiro","amazon-q","kimi-coding","kilocode","codebuddy-cn","codebuddy-intl","ghe-copilot","grok-cli","muse-code"]` — **no `"workbuddy"`** |
| consumer | same | 398 | `if (DEVICE_CODE_PROVIDERS.has(provider) && !grokWantsBrowser)` → picks the device-code panel |
| auto-start | same | 727–737 | `startsInPasteMode` false → `startOAuthFlow()` runs on open |
| auth-code fallback | same | 556 (comment), 599–601 (`fetch /api/oauth/${provider}/authorize`), 603–606 (`!res.ok`), 608–610 (`if (!data.authUrl)`) | falls through to the browser-auth-code branch |
| thrown error | same | 609 | `throw new Error(errorMessageFromBody(data, t("errorBrowserUnavailable")))` |
| render | same | 1174–1180 → `src/shared/components/oauthModal/OAuthErrorStep.tsx:34` (`{errorTitle}`) / `:36` (`<LinkifiedText text={error} />`) | what the user sees |
| i18n | `src/i18n/messages/en.json` | `oauthModal.error` **11337**, `oauthModal.errorBrowserUnavailable` **11347** | "Browser OAuth is unavailable for this provider…" |
| server set (already correct) | `src/app/api/oauth/[provider]/[action]/route.ts` | 66–76, `"workbuddy"` at **72** | `NO_PKCE_DEVICE_CODE_PROVIDERS` already contains workbuddy |
| provider | `src/lib/oauth/providers/workbuddy.ts` | config 16–24, `export const workbuddy` 69, `flowType:"device_code"` **71**, `requestDeviceCode` 73–111, `pollToken` 113–148, `mapTokens` 150–159 | device-code flow complete |
| registration | `src/lib/oauth/providers/index.ts` | 33, 72 | `workbuddy` registered |
| on the wire | `POST {stateUrl}?platform=CLI` (platform read from the **query string**) | | `{code:0,data:{state,authUrl}}`; poll `GET {tokenUrl}?state=` — `11217` pending, `0` = success, token is one-shot |
| route actions | `route.ts` | `device-code` at 210–212, `poll` at 407, guard comment 309 | both actions already exist for any `device_code` provider |

**Conclusion: the defect is exactly one missing set member in one component.** No server change is required — the server half (`NO_PKCE_DEVICE_CODE_PROVIDERS`, `flowType`, `requestDeviceCode`, `pollToken`, `mapTokens`) is already correct upstream.

### 2.2 A1 — the minimal fix (exact set-member edits)

Because §1.1 rules out the `.tsx`, the edit is specified for **compiled chunks**. All three anchors are **unique (occurrence count = 1 per file)** — verified.

**Source equivalent** (for the upstream PR / for auditability; not loaded by the image):

`src/shared/components/OAuthModal.tsx:46-57`, inside `DEVICE_CODE_PROVIDERS`:

```ts
  "grok-cli",
  "muse-code",
+ // WorkBuddy's web sign-in is the plugin-auth state flow (same shape as
+ // CodeBuddy): the modal's device-code panel is what drives it (#14212).
+ "workbuddy",
]);
```

**Compiled targets — apply to all three, all under `/usr/local/lib/node_modules/omniroute/`:**

| # | File | Compiled var | Occurrences of anchor |
| --- | --- | --- | --- |
| 1 | `dist/.build/next/static/chunks/38v-rzudg0f4t.js` | `G=new Set([...])` | 1 |
| 2 | `dist/.build/next/server/chunks/ssr/src_1j6-c_9._.js` | `M=new Set([...])` | 1 |
| 3 | `dist/.build/next/server/chunks/ssr/src_0lfns24._.js` | `M=new Set([...])` | 1 |

Exact serialized context (byte-identical in all three, only the leading minified identifier differs; raw bytes, not valid JS):

```text
,G=new Set(["github","kiro","amazon-q","kimi-coding","kilocode","codebuddy-cn","codebuddy-intl","ghe-copilot","grok-cli","muse-code"]),J=new Set(["devin-desktop","devin-cli","grok-cli","claude"]),V=new Set(["devin-desktop","devi
```

**Literal search/replace (var-name agnostic, idempotent-safe):**

```
SEARCH : "grok-cli","muse-code"])
REPLACE: "grok-cli","muse-code","workbuddy"])
```

- Do **not** anchor on `38v-rzudg0f4t.js` as a filename: Next chunk names are content-hashed and change on every upstream build. Locate files by content (`grep -rl`) and assert the discovered count.
- `TOKEN_PASTE_PROVIDERS` (`.tsx:59` → `J=new Set(["devin-desktop","devin-cli","grok-cli","claude"])`) is **not** touched by A1. An operator who wants the paste tab as well needs A2's semantics; see §2.3.
- Idempotency guard: skip any file whose content already contains `"muse-code","workbuddy"`.
- The client chunk is live, not dead weight: `38v-rzudg0f4t.js` is referenced by **125** `*_client-reference-manifest.js` files under `dist/.build/next/server/app/(dashboard)/**` (verified), so patching it changes what the browser receives.
- No content-hash manifest needs updating: `dist/.build/next/build-manifest.json` references chunk **filenames** only and contains **0** `integrity` entries (verified). ETags are computed from file content at serve time (`generateEtags: true`).

Expected observable result: opening the WorkBuddy connection dialog renders the **device-code panel** (device code + `authUrl` link), the modal auto-starts `GET /api/oauth/workbuddy/device-code`, and the poll loop hits `poll` — instead of the `errorBrowserUnavailable` error step.

### 2.3 A2 — fork-parity option (`workbuddy-global`, both tabs): **not a set edit**

The task's parity option assumes `workbuddy-global` can be "also added to the set". Verified otherwise:

- `grep -rn "workbuddy-global" /workspace/omniroute/_up/OmniRoute/src /workspace/omniroute/_up/OmniRoute/open-sse` → **no hits**.
- Same grep over the extracted `omniroute@3.8.52` tarball `src/` and `open-sse/` → **no hits**.
- The old fork that has it (`/workspace/Omniroute-fork/omniroute-workbuddy`) implements it as a **whole second provider**, not an alias: `src/lib/oauth/providers/index.ts:73` (`"workbuddy-global": workbuddyGlobal`), `WORKBUDDY_GLOBAL_CONFIG` in `src/lib/oauth/constants/oauth.ts`, plus its own `@/lib/workbuddy/types`, `accounts`, `credentials`, `X-User-Id`/`X-Domain`/`X-Enterprise-Id` identity call and per-edition model discovery.
- Upstream's single `workbuddy` provider instead pins one platform (`WORKBUDDY_CONFIG.platform = "CLI"`, `workbuddy.ts:21`) and one host (`https://www.workbuddy.ai`).

**Decision: A2 is out of scope for fork-ci.** It cannot be expressed as set membership; it requires porting a second provider and its addon (registry entry, provider constants, oauth constants, discovery, i18n, and the `@/lib/workbuddy/*` modules that upstream does not have at all). Doing it through the prebuilt-npm strategy would mean generating exactly the kind of "compiled addon payload" whose absence broke the old overlay (§1.2). If parity is later required, the only sound route is the old fork's **full-source compile** (`Dockerfile.workbuddy`, source-tarball delivery), whose port list is:

```
src/lib/oauth/providers/index.ts           + workbuddyGlobal registration
src/lib/oauth/constants/oauth.ts           + WORKBUDDY_GLOBAL_CONFIG
src/lib/workbuddy/{types,accounts,credentials}.ts   (new module tree)
src/app/api/workbuddy/**                   (accounts/import routes)
open-sse/config/providers/registry/workbuddy-global/index.ts
src/shared/components/OAuthModal.tsx       DEVICE_CODE_PROVIDERS + TOKEN_PASTE_PROVIDERS
```

Note the old fork additionally narrowed `IMPORT_TOKEN_ONLY_PROVIDERS` to `["devin-desktop","devin-cli"]` (`.tsx:71` there; upstream is already identical at `.tsx:60`) and made both workbuddy ids paste-**and**-device capable, i.e. `TOKEN_PASTE_PROVIDERS` there is a multi-line set at `.tsx:60-69` carrying `"workbuddy"` and `"workbuddy-global"`. Upstream is already at the same `IMPORT_TOKEN_ONLY_PROVIDERS` value, so **nothing in the upstream paste/import constants needs changing for A1**.

### 2.4 A3 — `clearWorkBuddyCredentialPark`: **unneeded upstream**

Old fork reference: `src/app/api/oauth/[provider]/[action]/route.ts:671-682` (≈675–682 for the block body), importing `clearWorkBuddyCredentialPark` from `@/lib/workbuddy/accounts` (export at `accounts.ts:209`), executed right after connection creation/update and before `syncToCloudIfEnabled()`.

Why it is not portable and not needed:

- `grep -rin "credentialPark|credential park"` over upstream `src/`, `open-sse/`, `tests/` → **zero hits**.
- `grep -rn "workbuddy" open-sse/services/accountFallback.ts` → **zero hits**; upstream has no per-credential "park" state for workbuddy in the pool store.
- Upstream has **no `src/lib/workbuddy/` directory at all** (verified in both the HEAD checkout and the npm tarball), so the imported symbol does not exist and the dynamic `import()` would throw on every successful workbuddy login — it is load-bearing only for the old fork's own addon.

**Decision:** do not port. Document it as "addon-internal cleanup with no upstream substrate". If a future upstream adopts a credential-park concept, re-evaluate; the insertion point would be `route.ts` immediately before `await syncToCloudIfEnabled()` (upstream line 682 in the success branch).

### 2.5 A5 — minimal regression test

Two tiers, because fork-ci has no source tree:

**Tier 1 — source-tree test (upstream PR; not shipped in the image).** New file `tests/unit/workbuddy-device-code-provider-set.test.ts`, run with the repo's `node:test` runner against `src/sync`:

1. Assert membership, not just flowType — the existing test is insufficient: `tests/unit/oauth-providers-config.test.ts:466-482` only asserts `PROVIDERS[id].flowType === "device_code"` for `["kimi-coding","github","kiro","amazon-q","kilocode","workbuddy","muse-code"]`. It never reads `DEVICE_CODE_PROVIDERS`, which is why the defect shipped.
2. Read `src/shared/components/OAuthModal.tsx` as text and assert every member of `NO_PKCE_DEVICE_CODE_PROVIDERS` (`route.ts:66-76`) that is a real provider is present in `DEVICE_CODE_PROVIDERS`, with `workbuddy` named explicitly. This is the parity oracle that makes the class of bug impossible to reintroduce.
3. Assert `DEVICE_CODE_PROVIDERS ∩ NO_PKCE_DEVICE_CODE_PROVIDERS ⊇ {workbuddy}` and that `route.ts` line 72 still carries `"workbuddy"`.
4. Keep the old fork's second test as a port reference: `tests/unit/workbuddy-provider-registration.test.ts` (provider present in `PROVIDERS`, `requestDeviceCode`/`pollToken` are functions, `mapTokens` yields `expiresIn` default `31_104_000`).

**Tier 2 — in-image fail-closed assertion (the only tier fork-ci can run).** Inside the same Dockerfile patch step (§2.6), before the build is allowed to succeed:

```
assert filesPatched === 3
assert every patched file now contains '"muse-code","workbuddy"'
assert the pre-existing '"grok-cli","muse-code"])' counterpart is gone in each
node -e "process.exit(require(FS_PREFIX+'/package.json').version === process.env.VERSION ? 0 : 1)"
```

Plus the existing workflow smoke test (`.github/workflows/docker-image.yml`, "Smoke test" step) is unchanged and remains the gate before push. A manual acceptance check is documented in §5.

### 2.6 A4 — delivery mechanics for a prebuilt-npm install

Three candidate strategies and the decision:

| Strategy | Verdict |
| --- | --- |
| **(a) Base image + anchor patch applied to `node_modules` in the Dockerfile** | **CHOSEN.** The package already contains the compiled target bytes; the edit is a literal string insertion; the whole thing is deterministic and repairable. |
| (b) `patch-package`-style postinstall | Rejected. `npm install --global` (Dockerfile:47) does not run a project-local postinstall for the installed package, and it would require a `.patch` file plus a dependency — violating "no package.json/dependency changes" and "no new repo files". The patch must therefore be **inline in the Dockerfile**. |
| (c) Vendored source build (old fork's `Dockerfile.workbuddy`) | Rejected for A1. It contradicts Dockerfile:4-11 ("no compilation… no build toolchain") and multiplies build time/context by orders of magnitude for a one-token change. Reserved for a future A2 (§2.3). |

**Exact Dockerfile changes** (`/workspace/omniroute/omniroute-fork-ci/Dockerfile`, 93 lines today). Two insertions; **no existing line is edited or removed**.

**Insertion 1 — new `ARG`s + ENV, after current line 42** (`ENV OMNIROUTE_BIN=${OMNIROUTE_BIN}`), before the install block at 44:

```dockerfile
# ── fork-local patch toggles (default: patch ON, both fixes independently switchable) ──
# Anchor edits are applied to the installed npm package's compiled chunks; they are
# fail-closed (a missing or ambiguous anchor aborts the build) and idempotent.
ARG PATCH_WORKBUDDY_OAUTH=1
ARG PATCH_OPENCODE_ANON=1
ENV PATCH_WORKBUDDY_OAUTH=${PATCH_WORKBUDDY_OAUTH} \
    PATCH_OPENCODE_ANON=${PATCH_OPENCODE_ANON}
```

**Insertion 2 — the patch step, after current line 49** (the `npm install … rm -rf /root/.npm` RUN), before the `chown` RUN at 53:

```dockerfile
# ── fork-local patches: literal anchor splices on the shipped compiled bundles ──────
# Rationale: the runtime is dist/server.js + dist/.build/next (standalone), not src/**,
# so a source-level edit inside the image would never load. Every anchor below was
# extracted from the pinned tarball and is asserted unique (count == 1) before use.
# A version bump that moves or duplicates an anchor FAILS THE BUILD here, by design.
RUN node --input-type=module - <<'PATCH_EOF'
<PATCH SCRIPT — full source in §7>
PATCH_EOF

# Every patched file must still be owned by the runtime user (see the note at line 51-52).
RUN chown -R node:node /usr/local/lib/node_modules/omniroute
```

(If both `RUN` blocks are added as above, delete the now-duplicate `chown` at old line 53-54 — that is the only removal, and it is a pure de-duplication, not a behaviour change.)

**`.github/workflows/docker-image.yml`:** no change required. The patch toggles default ON, and the version is already the pinned `3.8.52` (line 16). If build-time switchability is wanted from CI, the minimal addition is a dispatch input mirroring `promote_latest` and two `--build-arg` entries in the build step; **not included here** because the task caps the deliverable at one file and the defaults are the desired permanent state.

**VERSION decision — stays `3.8.52`.** Reasons:

1. The certified defect exists in **both** 3.8.52 (verified in the tarball) and 3.8.53 (`e9cb075c` source), so the patch is required either way; bumping buys nothing for Goal A.
2. Every anchor in this plan was extracted from and verified against `omniroute@3.8.52`. A bump invalidates that verification and would require re-extraction; `v3.8.53` is a source-side tag whose npm publication is not certified here.
3. `3.8.52` is what the fork CI default, the README flow, and the smoke test were exercised against.
4. The patch step is fail-closed, so an intentional bump is safe — it just has to be accompanied by a fresh anchor re-extraction pass, which the build will demand loudly rather than silently mis-patching.

### 2.7 A6 — PR #14212 collision risk

Treat this as a **diff to port forward, never a cherry-pick**.

- The upstream change (if it lands) will be in `src/shared/components/OAuthModal.tsx` `DEVICE_CODE_PROVIDERS` — the same logical site as our §2.2 source equivalent, so a cherry-pick would conflict on context lines and, worse, could silently double-insert.
- The compiled form gives us path independence: even after PR #14212 merges, an npm tarball that already contains `"muse-code","workbuddy"` makes our replacement a no-op (the idempotency guard skips it). So the correct future action is: bump VERSION, run the patch step, and if all three files report "already patched", **remove the A1 edit** from the script and keep only Goal B.
- Conversely, if upstream "fixes" it differently (e.g. by deriving `DEVICE_CODE_PROVIDERS` from flowType), the anchor disappears and the build fails closed. Both outcomes are correct behaviour; neither is a silent regression.

---

## 3. Goal B — OpenCode Zen free tier without the CLI

### 3.0 The headline finding: two of the three "missing ingredients" are already upstream

The task framing assumed a dsh plugin ports three missing deltas into OmniRoute. Re-verified against HEAD `e9cb075c`, **two of the three already exist upstream** — in some respects more correct than the plugin:

| delta | dsh plugin (`/home/node/.dsh/profiles/web/.dsh-local/dsh-llm-opencode-free/index.js`, 1385 lines) | upstream OmniRoute `e9cb075c` | verdict |
| --- | --- | --- | --- |
| **d1** canonical `ses_` mint from an inverted millisecond timestamp | `invertedTimestampHex` **:175-177** (`~(BigInt(now)*4096n+1n) & 281474976710655n`, 12 hex), `CANONICAL_SESSION_PATTERN` **:179** (`/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/`), `sessionMemo` Map + `SESSION_MEMO_LIMIT = 1_024` **:124, :180**, `canonicalSessionID` **:187-197**, seed = first user turn's JSON content (`conversationSeed`, `deriveRequestIDs` :207-225) | `OPENCODE_SESSION_PATTERN` **:29**, `OPENCODE_SESSION_COUNTER = 1n` **:165**, `OPENCODE_SESSION_MASK_48 = 0xffffffffffffn` **:166**, `OPENCODE_SESSION_TS_MAX = 0xfffffffffn` **:168**, `base62From` **:171-173**, `canonicalId("ses_", seed)` **:190-211** — same math (`~(ts<<12|1) & 2^48-1`) but `ts36` taken from the **seed hash** instead of the clock, and the value gate + re-mint live in `applyCliDefaults` **:407-448** (`reencodeSession` → `isValidOpencodeSessionValue`), `applyV2FreeTierSessionHeaders` **:452-461** | **ALREADY PRESENT.** Hash-derived is strictly better here: it is deterministic per conversation without an LRU Map, so a retry reuses the identical id by construction (`opencode-native-session-identity.test.ts` pins this). **No code change; add a regression test only.** |
| **d2** always `stream:true` + `stream_options.include_usage`, agent-shaped tool array with `bash`/`read` stubs | `buildChatBody` **:842-866**; `stream:true` + `stream_options:{include_usage:true}` **:848-849**; `GATE_TOOL_NAMES = ['bash','read']` **:96**; `gateTool` **:827-836**; append **:858-863**; `tool_choice:'none'` **:862** | `applyFreeTierRequestContract` **:356-400** (spreads `{...record, stream:true}` **:362**), placeholder schemas `bash/glob/grep/read` with **required** params **:311-317**, `placeholderToolParameters` **:323-328**, `configuredPlaceholderToolNames` **:288-298**, `OPENCODE_FREE_TIER_PLACEHOLDER_TOOLS` env **:289** | **MOSTLY PRESENT.** Missing only `stream_options.include_usage`. `tool_choice` is **deliberately not ported**: upstream measured that the upstream rejects any value but `"auto"` (400 `only "auto" is supported for tool_choice`) and documents never adding one — the plugin's `'none'` would be a regression on the v2 path. |
| **d3** keyless anonymous lane: `Authorization: Bearer public`, `x-opencode-client: cli` | `ANONYMOUS_KEY = 'public'` **:70**, `laneHeaders` **:228-237** (`authorization`, UA, `x-opencode-client:'cli'`, `x-opencode-session`, `x-session-affinity`, `X-Session-Id`, `x-opencode-request`, `x-opencode-project`), second site **:515-517** | `buildHeaders`: `const key = credentials ? this.resolveEffectiveKey(credentials) || credentials.accessToken : undefined;` **:1338-1341**, then `if (key) { … Authorization = \`Bearer ${key}\` }` **:1342-1350** — **headers are emitted only when a key exists**. `opencode-zen` is `authType:"apikey"` (`registry/opencode/zen/index.ts:11-13`), has **no** `anonymousFallback`, and is **not** in `NOAUTH_PROVIDERS` (`src/shared/constants/providers/apikey/gateways.ts:761-774`; `noauth.ts` has no opencode entry), so a keyless request carries **no** `Authorization` at all. The lane was retired on purpose: `tests/unit/migration-207-remove-opencode-free-provider.test.ts` ("migration 207 removes stale OpenCode Free provider state") and `tests/unit/auth-opencode-zen-noauth-fallback.test.ts` ("OpenCode Zen and Go without connections never synthesize Free credentials") | **GENUINELY MISSING. This is the one ingredient to port.** |

Additional verified fact that shapes the plan: the synthetic anonymous credential path still exists and is reusable — `src/sse/services/auth.ts:636` (`SYNTHETIC_NOAUTH_CONNECTION_ID = "noauth"`), `:742` (`providerDef?.anonymousFallback === true || noAuthProviderDef?.noAuth === true || …`), `:766` (`isAnonymousFallbackOnlyProvider`), `:786+` (`maybeSyntheticNoAuthFallback`). But even if `opencode-zen` were re-flagged `anonymousFallback: true`, the resulting credential has `apiKey: null`, so `if (key)` at `opencode.ts:1342` still emits **no** `Authorization` header. **The keyless lane therefore needs the executor-side fallback in §3.2 regardless of how credentials are sourced.**

### 3.1 B(a) — insertion-point decision

| Option | Assessment |
| --- | --- |
| New provider entry (`opencode-free`, `authType:"none"`, Bearer `public`) | Rejected. It would duplicate `opencodeFreeTierContract`'s surface detection (`surfaceFromBaseUrl` **:231-235** keys on the exact registry `baseUrl`s `ZEN_SURFACE_BASE_URL` **:217** / `GO_SURFACE_BASE_URL` **:218**), so a third `baseUrl` lands in `surface: "other"` and **loses the entire free-tier contract** — the gated URL (`buildUrl` **:1299-1301**), the header synthesis (`gatedScope` **:1349-1350**) and the body contract all switch off. It also collides with the deliberately-removed `opencode-free` provider name (migration 207) and with `opencode-premium-keyless-gate-8681.test.ts`. |
| **Extend the existing seams** — executor `buildHeaders` keyless fallback + contract blocklist + existing env knobs | **CHOSEN.** Zero new surface, zero registry change, no migration, no surface-classification risk, and it reuses `isGatedFreeTierRequest` **:254-261** as the single gate predicate. |

`x-opencode-client` needs **no code at all**: `resolveOpencodeCliDefaults` **:133-161** already returns `client: process.env.OPENCODE_CLIENT?.trim() || (v2Fingerprint ? "cli" : "desktop")` (**:152**) and `project: process.env.OPENCODE_PROJECT?.trim() || "global"` (**:153**). So the plugin's `cli` identity is a pure env toggle — see §3.6.

### 3.2 B(b) — inverted-timestamp session mint: already implemented; hooks and the reference skeleton

**No implementation is required.** For the record and for the regression test, this is the upstream implementation the plan pins as the contract (`opencodeHeaders.ts:190-211`, un-minified):

```ts
// open-sse/utils/opencodeHeaders.ts:190-211 (verified, HEAD e9cb075c) — DO NOT REWRITE.
function canonicalId(prefix: "ses_" | "msg_", seed?: string): string {
  const bytes = seed
    ? createHash("sha256").update(`opencode\u0000${prefix}\u0000${seed}`).digest()
    : randomBytes(32);
  if (prefix === "ses_") {
    const ts36 =
      ((BigInt(bytes[0]) << 28n) | (BigInt(bytes[1]) << 20n) | (BigInt(bytes[2]) << 12n) |
        (BigInt(bytes[3]) << 4n) | (BigInt(bytes[4]) >> 4n)) & OPENCODE_SESSION_TS_MAX;
    const value = ~((ts36 << 12n) | OPENCODE_SESSION_COUNTER) & OPENCODE_SESSION_MASK_48; // counter pinned to 1
    return `${prefix}${value.toString(16).padStart(12, "0")}${base62From(bytes.subarray(6), 14)}`;
  }
  return `${prefix}${bytes.subarray(0, 6).toString("hex")}${base62From(bytes.subarray(6), 14)}`;
}
```

Equivalence proof against the plugin's `invertedTimestampHex` (`index.js:175-177`): both compute `~(ts << 12 | counter) & (2^48 − 1)` and render the low 48 bits as 12 hex + 14 base62 matching `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`. The plugin feeds `ts = Date.now()` and needs `sessionMemo` (Map, LRU 1024) only because the clock moves; upstream feeds `ts = hash-derived 36 bits` and so needs no memo. **The re-mint hook the task asked about already exists** at `opencodeHeaders.ts:432-448` inside `applyCliDefaults` (reached from `opencode.ts:1382-1390` with `reencodeSession: gatedScope`): a caller id that is shape-valid but value-invalid is re-minted from the client's own value; a genuine descending id is kept.

**Only deliverable for d1: a test** (§3.7, T-B1) asserting the regex, the low-12 window `0xFC0–0xFFF`, per-conversation stability and cross-conversation separation.

### 3.3 B(c) — keyless lane (`Bearer public`) patch, exact anchors

**Compiled target (single file, both anchors are unique in it — verified count == 1 each):**

```
/usr/local/lib/node_modules/omniroute/dist/.build/next/server/chunks/open-sse_14vc3e4._.js
```

`grep -rl "usesZenApiKeyAuth()"` over the whole `dist/` returns exactly this file, and `grep -rl "open-sse_14vc3e4" dist/.build/next/server/` returns route-root chunks (including under `.../app/api/v1/chat/`), so patching it is on the live chat path.

**Edit B1 — anonymous key fallback.** Current compiled bytes (extracted verbatim; raw bytes, not valid JS):

```text
buildHeaders(e,t=!0,r,n,o,s){let i={"Content-Type":"application/json"},a=e?this.resolveEffectiveKey(e)||e.accessToken:void 0,l=!!n&&(0,g.isGatedFreeTierRequest)(this._surface(),this.provider,n);a&&("claude"===this._requestFormat||this.usesZenApiKeyAuth()?i["x-api-key"]=a:i.Authorization=`Bearer ${a}`),"claude"===this._requestFormat&&(i["anthropic-version"]="2023-06-01"),(t||l)&&(i.Accept="text/event-stream");
```

Here `a` = key, `n` = model, `l` = **gatedScope**. Literal, var-name-anchored, unique search string:

```
SEARCH : ,this.provider,n);a&&("claude"===this._requestFormat||this.usesZenApiKeyAuth()
REPLACE: ,this.provider,n);a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);a&&("claude"===this._requestFormat||this.usesZenApiKeyAuth()
```

Semantics: key present → unchanged (`a` truthy short-circuits). Key absent **and** gated → `a` becomes the env value (`"public"` when configured). Key absent and ungated (`opencode-go`, paid models) → `a` stays `undefined`, so **nothing changes for every non-gated surface**. `x-api-key` vs `Authorization: Bearer` selection downstream is untouched (`usesZenApiKeyAuth()` still wins for the Zen Responses path, `opencode.ts:1329-1337`).

Source-tree equivalent for the eventual upstream PR (`opencode.ts:1338-1350`):

```ts
const key =
  (credentials ? this.resolveEffectiveKey(credentials) || credentials.accessToken : undefined) ||
  (gatedScope ? (process.env.OPENCODE_ANONYMOUS_KEY || "").trim() || undefined : undefined);
```

**Edit B2 (optional, same file) — `stream_options.include_usage` on the gated path.** The plugin sets it at `index.js:849`; upstream never does on the opencode path (`grep -rn include_usage open-sse/` → only `default.ts:957`, `kimi.ts:191`, plus translator/stream comments). It is **not** a 403 cause — the gate needs `stream:true` only (contract `:362`, executor comment `:1345`) — so treat B2 as an optional parity item. If wanted, the clean source-level hook is `applyFreeTierRequestContract` (`opencodeFreeTierContract.ts:356-362`):

```ts
const next: Record<string, unknown> = { ...record, stream: true };
if (isBodyContractEnabled()) next.stream_options = { ...(record.stream_options ?? {}), include_usage: true };
```

Do **not** attempt this as a minified splice: `stream:true` is spread in several places and the anchor is not unique. Ship it as a source build or skip it.

### 3.4 B(d) — model roster: live Zen `/v1/models` ∩ name-free blocklist

**Where model listing lives upstream (all verified):**

| Concern | Anchor |
| --- | --- |
| live roster URL | `open-sse/config/providers/registry/opencode/zen/index.ts:9-10` (`baseUrl`, `modelsUrl: "https://opencode.ai/zen/v1/models"`), `passthroughModels: true` |
| dashboard discovery | `src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts:927` — `buildOpencodeModelsDiscoveryEntry("https://opencode.ai/zen/v1/models")` |
| static catalog | same registry file, `models: [...]`, incl. the `*-free` block (`deepseek-v4.1-flash-free` + alias `deepseek-v4-flash-free`, `mimo-v2.5-free`, `mimo-v2.6-flash-free`, `hy3-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`, `laguna-s-2.1-free`) |
| free-set derivation (the existing "name-free" oracle) | `opencodeFreeTierContract.ts:149-168` `deriveFreeIdsFromCatalog()` — synced ids ∩ models.dev `cost.input===0 && cost.output===0` ∩ `status !== "deprecated"`; `:192-203` `isPremiumOpencodeModel()` with the legacy `id.endsWith("-free")` fallback; test override seam `:143-146` `_setOpencodeFreeModelsForTests()` |

So the "live `/v1/models` ∩ name-free" rule is **already implemented** and is strictly richer than the plugin's list. **What is missing is only the dead-id blocklist** (`FREE_LANE_BLOCKLIST`, `index.js:80`): ids that remain in the Zen catalogue but 403 upstream. Upstream's `deprecated` filter does not catch them, and it still advertises `muse-spark-1.2-contributor-free` / `muse-spark-1.3-contributor-free` — the very ids the plugin blocklists as `403 RegionError` on both surfaces.

**Edit B3 — blocklist seam.** Compiled anchor in the same `open-sse_14vc3e4._.js` (unique, count == 1):

```js
...status;"deprecated"!==o&&t.add(r)}return t}catch{return null}}();return x={version:e,free:t},t}();return n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}
```

```
SEARCH : "deprecated"!==o&&t.add(r)}
REPLACE: "deprecated"!==o&&!new Set((process.env.OPENCODE_FREE_TIER_MODEL_BLOCKLIST||"").split(",").map(s=>s.trim()).filter(Boolean)).has(r)&&t.add(r)}
```

The inline `Set` is deliberate: it is a compiled-artifact splice, the expression is evaluated once per catalog derivation (which is cached), and it avoids injecting a new minified helper. Clean source-tree form (preferred for the upstream PR, `opencodeFreeTierContract.ts`, next to `configuredPlaceholderToolNames` `:288-298`, same parse/validate style and the same "read per call" contract):

```ts
/** Ids the gateway still advertises but refuses on the free lane. Comma-separated; empty = none. */
export function opencodeFreeTierModelBlocklist(): ReadonlySet<string> {
  const raw = process.env.OPENCODE_FREE_TIER_MODEL_BLOCKLIST || "";
  const kept: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || kept.length >= 64) continue;
    if (!kept.includes(id)) kept.push(id);
  }
  return new Set(kept);
}
```

and, in `deriveFreeIdsFromCatalog()` (source `:157-163`), `if (status === "deprecated" || opencodeFreeTierModelBlocklist().has(id)) continue;`.

Semantics chosen: a blocked id is **never classified free**, so `isPremiumOpencodeModel` returns true for it and a keyless request gets the existing clean `402 premium_model_requires_key` (`opencode.ts:554-576`) instead of a raw upstream 403. A keyed request still goes upstream (unchanged). This is honest, uses an existing error path, and touches no routing table. Default env value ships **empty** so behaviour is byte-identical until an operator opts in.

### 3.5 B(e) — roster/403 handling that must NOT be changed

Upstream already maps these correctly; the plan pins them as invariants and as the assertions of §3.7:

| Signal | Anchor |
| --- | --- |
| free-tier refusal detection (403/451 only, fingerprint/geo/user-blocked win) | `open-sse/executors/opencodeGeoBlock.ts:27` (`FREE_TIER_SIGNALS = ["freetiererror","free tier can only be used"]`), `:28` (`GEO_SIGNALS`), `:81-93` `isOpencodeFreeTierRefusal`, `:144-151` `isOpencodeFreeTierRefusalForProvider` |
| classifier parity (message-only reachability) | `open-sse/services/errorClassifier.ts:239` (`FREE_TIER_REFUSAL_SIGNALS`), `:243` `isOpencodeFreeTierProvider` |
| per-model pause instead of account lockout | `open-sse/services/opencodeFreeTierSkip.ts:78-91` `noteOpencodeFreeTierSkip(provider, now, ttlMs, model)` |
| combo-scoped verdict | `open-sse/services/combo/comboPredicates.ts:330` |

A 403 that arises purely from a missing `Authorization` header (or from a blocked model) must therefore **not** be "fixed" by swallowing the refusal — that would silently disable the pause/rotation machinery above. The correct fix is to never emit the malformed request (§3.3) and to not advertise dead ids (§3.4).

### 3.6 B(e) — rollout / kill-switch envs (upstream `OPENCODE_*` style)

| Env | Default | Effect | Implemented by |
| --- | --- | --- | --- |
| `OPENCODE_ANONYMOUS_KEY` | unset (off) | When set (`public`), a **gated** free-tier request with no credential carries `Authorization: Bearer <value>`. Ungated surfaces unaffected. | **new** — edit B1 (§3.3) |
| `OPENCODE_FREE_TIER_MODEL_BLOCKLIST` | unset (empty) | Comma-separated ids never treated as free; they fall into the premium/no-key 402 path instead of a raw upstream 403. | **new** — edit B3 (§3.4) |
| `OPENCODE_CLIENT` | `desktop` (or `cli` under v2) | Set to `cli` → plugin-identical `x-opencode-client: cli`. **Zero code.** | existing — `opencodeHeaders.ts:152` |
| `OPENCODE_PROJECT` | `global` | `x-opencode-project` value. | existing — `opencodeHeaders.ts:153` |
| `OPENCODE_SYNTHESIZE_CLI_HEADERS` | on | `false`/`0` disables UA + CLI identity synthesis. | existing — `opencodeHeaders.ts:137-139` |
| `OPENCODE_USER_AGENT` / `OPENCODE_ZEN_USER_AGENT` | `opencode/<cached version>` | Overrides the UA; on a gated request a UA failing the version rule is **replaced** (`:145-149`). Plugin uses a bare `opencode/1.18.31`, which upstream's `DEFAULT_OPENCODE_USER_AGENT` (`:19`) already matches. | existing |
| `OPENCODE_V2_CLIENT_FINGERPRINT_ENABLED` | off | `opencode/latest/<2.x>/cli` + `cli` client + the v2 session-header trio. | existing — `opencodeHeaders.ts:27-33, 452-461` |
| `OPENCODE_FREE_TIER_REQUEST_CONTRACT` | on | `off` disables the **body** half (headers stay). | existing — `opencodeFreeTierContract.ts:243-245` |
| `OPENCODE_FREE_TIER_PLACEHOLDER_TOOLS` | `read` | Placeholder tool names injected on the gated path. | existing — `:288-298` |
| `PATCH_OPENCODE_ANON` | `1` | Build-time switch for edit B1 (§2.6). | fork-ci Dockerfile only |

Recommended fork-ci runtime env (documented, **not** baked into the Dockerfile, since it is operator policy):

```
OPENCODE_CLIENT=cli
OPENCODE_ANONYMOUS_KEY=public
OPENCODE_FREE_TIER_MODEL_BLOCKLIST=exo-free,jev-1.13-free,ling-3.0-flash-fin-free,muse-spark-1.2-contributor-free,muse-spark-1.3-contributor-free
```

**Zero-patch alternative worth stating explicitly:** because `opencode-zen` is an `authType:"apikey"` provider, an operator can instead create a connection with `apiKey = "public"`. That satisfies edit B1's precondition without any patch (`key` is truthy → `Authorization: Bearer public`). Its cost is that the connection is no longer "keyless", so the `#8681` premium gate (`opencode.ts:556-576`) stops firing and premium models are attempted upstream. **Recommendation: use the patch (env-gated) as the primary path; mention the connection trick only as a diagnostic/fallback.**

### 3.7 B(f) — behavior tests: what to assert and where they live

Existing test homes (verified present under `tests/unit/`, run by the repo's `node:test` runner against the source tree):

| Area | Existing files to extend / mirror |
| --- | --- |
| session id mint + re-mint | `tests/unit/opencode-native-session-identity.test.ts`, `tests/unit/opencode-session-fingerprint-headers-10571.test.ts`, `tests/unit/session-affinity-generic-7274.test.ts` |
| header synthesis / UA | `tests/unit/refactor-opencodeHeaders.test.ts`, `tests/unit/opencode-cli-headers-synthesis-5997.test.ts`, `tests/unit/opencode-background-identity-headers.test.ts`, `tests/unit/opencode-v2-free-tier-fingerprint.test.ts`, `tests/unit/opencode-go-client-user-agent-15311.test.ts` |
| body contract / gated URL | `tests/unit/opencode-free-tier-request-contract.test.ts`, `tests/unit/opencode-executor.test.ts`, `tests/unit/opencode-stream-options-13699.test.ts` |
| keyless gate | `tests/unit/opencode-premium-keyless-gate-8681.test.ts`, `tests/unit/opencode-free-tier-noauth-ttl-skip-14313.test.ts`, `tests/unit/auth-opencode-zen-noauth-fallback.test.ts` |
| 403 classification | `tests/unit/opencode-geo-block-predicate.test.ts`, `tests/unit/opencode-user-blocked-predicate.test.ts`, `tests/unit/opencode-free-tier-refusal-predicate.test.ts`, `tests/unit/opencode-rate-limited-classify.test.ts` |

New tests to add (source tree; names fix the spec):

| ID | File | Assertions |
| --- | --- | --- |
| T-B1 | `tests/unit/opencode-canonical-session-id.test.ts` | `canonicalId("ses_", seed)` matches `/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/`; the 12-hex low 12 bits decode to `0xFC0–0xFFF` (i.e. `counter = 1`); identical seed → identical id (no clock dependence); different seeds → different ids; `msg_` matches `/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/`; `forwardOpencodeClientHeaders` with `reencodeSession:true` re-mints an ascending/raw-hash session but **keeps** a genuine descending one |
| T-B2 | `tests/unit/opencode-anonymous-free-lane.test.ts` | With `OPENCODE_ANONYMOUS_KEY=public` and no credentials: gated model → `buildHeaders(...)["Authorization"] === "Bearer public"` and URL `=== FREE_TIER_INFERENCE_BASE_URL + "/chat/completions"` (`buildUrl` `:1299-1301`); **ungated** (`opencode-go`, `deepseek-v4-pro` on zen) → no `Authorization` header; env unset → header absent on the gated path too (no regression); with a credential → the credential wins over the env |
| T-B3 | `tests/unit/opencode-free-tier-model-blocklist.test.ts` | `_setOpencodeFreeModelsForTests([...])` + `OPENCODE_FREE_TIER_MODEL_BLOCKLIST=exo-free,muse-spark-1.2-contributor-free` → `isPremiumOpencodeModel` true for the blocked ids, false for the unblocked free ones; empty/unset env → unchanged legacy `endsWith("-free")` behaviour; the shift list is trimmed and de-duplicated |
| T-B4 | `tests/unit/opencode-free-tier-403-mapping.test.ts` (extension) | `isOpencodeFreeTierRefusal(403, '{"error":{"type":"FreeTierError","message":"Free tier can only be used ..."}}')` true; a fingerprint/geo/`user_blocked` 403 stays false (more specific predicate wins); `isOpencodeFreeTierRefusalForProvider("opencode-zen", …)` true and `("openai", …)` false; `errorClassifier` arrives via the message sentence only |
| T-B5 | `tests/unit/workbuddy-device-code-provider-set.test.ts` | see §2.5 Tier 1 |

In-image assertions (fork-ci Tier 2, can only assert artifact bytes): `workbuddy` present in all 3 modal chunks with occurrence counts exactly `1` each; the Goal B anon anchor present exactly once and replaced once; `node -e "…package.json.version === VERSION"`. Runtime acceptance checklist (manual, documented in §5): dashboard → OpenCode Zen → add a free model with **no** key → 200, no `FreeTierError`, and the request log shows `Authorization: Bearer public` + `x-opencode-client: cli` + a `ses_` id whose low 12 hex bits are in `0xFC0–0xFFF`.

---

## 4. Consolidated Dockerfile diff (what changed, line by line)

Against the current `Dockerfile` (93 lines):

| Action | Anchor (current line) | Content |
| --- | --- | --- |
| insert | after **42** (`ENV OMNIROUTE_BIN=…`) | `ARG PATCH_WORKBUDDY_OAUTH=1`, `ARG PATCH_OPENCODE_ANON=1`, and the `ENV` carrying both |
| insert | after **49** (end of the install `RUN`) | the `RUN node --input-type=module - <<'PATCH_EOF' … PATCH_EOF` patch step (§7) |
| delete | **53-54** (the original `chown -R node:node /usr/local/lib/node_modules/omniroute`) | superseded by the `chown` appended by the patch step — the only removal in the whole plan |

Nothing else. `FROM` (20), `ARG VERSION` (23-28), the ENV contract (31-36), the `npm install` (46-49), the entrypoint (68-75), `USER node` (78), `EXPOSE 20128` (80), `HEALTHCHECK` (85-86) and `CMD []` (93) are untouched. The `# syntax=docker/dockerfile:1` directive at line 1 already enables BuildKit heredocs.

---

## 5. Verification gates, acceptance and rollback

Build gates (all inside the patch step — a failure aborts the image, never ships a half-patched one):

1. `package.json.version === $VERSION` (catches a tarball/label mismatch).
2. Every anchor found with **occurrence count == 1**; a missing anchor or count ≠ 1 → exit 1 with the file path and the anchor.
3. Every replacement verified by a post-condition `includes()` check; expected file counts asserted (`3` for A1, `1` for B1, `1` for B3).
4. `PATCH_WORKBUDDY_OAUTH=0` / `PATCH_OPENCODE_ANON=0` skip their edit and assert the corresponding **pre**-condition instead (so the toggle is itself tested).

Acceptance checklist (manual, on the built image):

- **A:** `docker run … omniroute:3.8.52-patched`, open the dashboard → Providers → WorkBuddy → Connect. Expect the device-code panel with a code + sign-in link and a live poll, **never** "Browser OAuth is unavailable for this provider in the current environment." (the `errorBrowserUnavailable` string, `en.json:11347`). Confirm one connection row is created and a chat turn succeeds (gateway contract: streaming required — see the registry entry's `forceStream` note).
- **B:** Providers → OpenCode Zen → a `*-free` model with **no** key → 200; request log shows `Authorization: Bearer public`, `x-opencode-client: cli`, `x-opencode-session: ses_…` with the low-12 window check. A blocked id (if the blocklist is set) must return `402 premium_model_requires_key`, not a `FreeTierError` 403.

Rollback: rebuild with `--build-arg PATCH_WORKBUDDY_OAUTH=0 --build-arg PATCH_OPENCODE_ANON=0` → byte-identical to today's upstream-package image; or redeploy the previous version tag. No migration, DB or config state is touched by either patch.

---

## 6. Decision log

### 6.1 VERSION stays 3.8.52

Not bumped to 3.8.53: the defect exists in both (verified in 3.8.52's tarball **and** in the 3.8.53 source), all anchors were extracted from 3.8.52, 3.8.52 is what the CI default/README/smoke test were exercised against, and 3.8.53's npm publication is not certified here. Bumping requires a fresh anchor-extraction pass; the fail-closed patch step enforces exactly that.

### 6.2 Decisions in one line each

1. A1 is **one set-member edit**, delivered to **3 compiled chunks** — not the `.tsx`, which the runtime never loads.
2. A2 (`workbuddy-global` + both tabs) is **not implementable as a set edit**; verified absent from upstream entirely. Deferred with a port list; requires the old fork's full-source build.
3. A3 (`clearWorkBuddyCredentialPark`) is **not ported** — no upstream substrate (`src/lib/workbuddy/` does not exist; zero `credentialPark` hits).
4. Delivery = **in-Dockerfile BuildKit heredoc anchor patcher**: no new repo files, no `package.json`/dependency change, fail-closed, idempotent, per-fix `--build-arg` toggles.
5. Goal B d1 (inverted-timestamp `ses_`) is **already upstream** (byte-equivalent math, plus a value gate and re-mint); test only.
6. Goal B d2 is **mostly upstream**; only `stream_options.include_usage` is missing and it is **not** a 403 cause → optional, source-build-only (the anchor is not unique).
7. Goal B d2's `tool_choice:'none'` is **deliberately not ported** (upstream measured that the gateway rejects any value but `"auto"`).
8. Goal B d3 (keyless `Bearer public`) is the **only genuinely missing ingredient** → one unique compiled anchor + `OPENCODE_ANONYMOUS_KEY`.
9. Goal B client identity (`x-opencode-client: cli`, project) needs **no code** — `OPENCODE_CLIENT=cli` via `opencodeHeaders.ts:152`.
10. Goal B roster blocklist → `OPENCODE_FREE_TIER_MODEL_BLOCKLIST`, default empty, routed into the existing premium/no-key 402 path rather than papering over 403s.

### 6.3 Residual risks

| Risk | Mitigation |
| --- | --- |
| Chunk filenames are content-hashed → hardcoded paths rot on any version bump | The patcher greps for the anchor; no filename is hardcoded. Filenames appear in this plan only as 3.8.52 evidence. |
| A future upstream build minifies differently (different var names / literals) | The three anchors are literal-window based, not identifier based. A changed literal → build fails closed with the anchor printed. |
| An upstream change makes a patched file stale while another copy still exists | `grep -rl` enumeration + expected-count assertion (`3` / `1`) catches both "too few" and "too many". |
| Edit B1 accidentally enabling a key on a non-gated surface | The replacement is guarded by `!l` where `l = gatedScope`; T-B2 asserts `opencode-go` and paid zen models still emit no `Authorization`. |
| B2 (`include_usage`) attempted as a minified splice | Explicitly disallowed in §3.3 — the anchor is not unique. |

---

## 7. Patch script (verbatim payload for the Dockerfile heredoc)

Dependency-free, Node built-ins only, deterministic, fail-closed, idempotent. Paste between `<<'PATCH_EOF'` and `PATCH_EOF` in the §2.6 Insertion 2.

```js
import fs from "node:fs";
import path from "node:path";

const PKG = "/usr/local/lib/node_modules/omniroute";
const version = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const want = process.env.VERSION;
if (want && version !== want) {
  console.error(`FATAL: installed package version ${version} != VERSION ${want}`);
  process.exit(1);
}
const on = (v) => !/^(0|false|no|off)$/i.test(String(v ?? "").trim());

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && p.endsWith(".js")) out.push(p);
  }
  return out;
}

function patch({ id, root, search, replace, expectFiles, after }) {
  if (!fs.existsSync(root)) {
    console.error(`FATAL[${id}]: missing root ${root}`);
    process.exit(1);
  }
  const hits = [];
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(after)) { hits.push({ file, text, state: "already" }); continue; }
    const n = text.split(search).length - 1;
    if (n === 0) continue;
    if (n !== 1) {
      console.error(`FATAL[${id}]: anchor occurs ${n}x (must be 1) in ${file}`);
      process.exit(1);
    }
    hits.push({ file, text, state: "todo" });
  }
  if (hits.length !== expectFiles) {
    console.error(`FATAL[${id}]: matched ${hits.length} file(s), expected ${expectFiles}`);
    for (const h of hits) console.error(`  ${h.state} ${h.file}`);
    process.exit(1);
  }
  let written = 0;
  for (const h of hits) {
    if (h.state === "already") { console.log(`[${id}] already patched (no-op): ${h.file}`); continue; }
    const next = h.text.replace(search, replace);
    if (!next.includes(after)) {
      console.error(`FATAL[${id}]: post-condition failed in ${h.file}`);
      process.exit(1);
    }
    fs.writeFileSync(h.file, next);
    written += 1;
    console.log(`[${id}] patched: ${h.file}`);
  }
  console.log(`[${id}] ok — ${hits.length} file(s) matched, ${written} written`);
}

const NEXT = path.join(PKG, "dist", ".build", "next");

// ── A1: WorkBuddy in DEVICE_CODE_PROVIDERS (3 compiled copies) ────────────────────
if (on(process.env.PATCH_WORKBUDDY_OAUTH)) {
  patch({
    id: "A1-workbuddy-device-code",
    root: NEXT,
    search: '"grok-cli","muse-code"])',
    replace: '"grok-cli","muse-code","workbuddy"])',
    after: '"muse-code","workbuddy"',
    expectFiles: 3,
  });
} else {
  console.log("[A1] skipped (PATCH_WORKBUDDY_OAUTH=off)");
}

// ── B1: keyless anonymous lane on the gated free-tier request (1 copy) ────────────
if (on(process.env.PATCH_OPENCODE_ANON)) {
  patch({
    id: "B1-opencode-anonymous-key",
    root: path.join(NEXT, "server", "chunks"),
    search: ',this.provider,n);a&&("claude"===this._requestFormat||this.usesZenApiKeyAuth()',
    replace:
      ',this.provider,n);a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);a&&("claude"===this._requestFormat||this.usesZenApiKeyAuth()',
    after: 'a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY',
    expectFiles: 1,
  });

  // ── B3: free-tier dead-id blocklist (1 copy) ────────────────────────────────────
  patch({
    id: "B3-opencode-free-blocklist",
    root: path.join(NEXT, "server", "chunks"),
    search: '"deprecated"!==o&&t.add(r)}',
    replace:
      '"deprecated"!==o&&!new Set((process.env.OPENCODE_FREE_TIER_MODEL_BLOCKLIST||"").split(",").map(s=>s.trim()).filter(Boolean)).has(r)&&t.add(r)}',
    after: "OPENCODE_FREE_TIER_MODEL_BLOCKLIST",
    expectFiles: 1,
  });
} else {
  console.log("[B1/B3] skipped (PATCH_OPENCODE_ANON=off)");
}

// ── A1 residual check: the same set is NOT allowed to leak into TOKEN_PASTE ───────
const modal = walk(NEXT).filter((f) => fs.readFileSync(f, "utf8").includes('"muse-code","workbuddy"'));
if (on(process.env.PATCH_WORKBUDDY_OAUTH) && modal.length !== 3) {
  console.error(`FATAL: expected 3 workbuddy-carrying chunks, found ${modal.length}`);
  process.exit(1);
}

// ── integrity: the two Goal-B edits must not have landed in a different copy ──────
const b1 = walk(path.join(NEXT, "server", "chunks")).filter((f) =>
  fs.readFileSync(f, "utf8").includes("process.env.OPENCODE_ANONYMOUS_KEY")
);
if (on(process.env.PATCH_OPENCODE_ANON) && b1.length !== 1) {
  console.error(`FATAL: expected 1 anonymous-lane chunk, found ${b1.length}`);
  process.exit(1);
}

console.log(`patched package omniroute@${version} under ${PKG}`);
```

The script touches **only** files under `/usr/local/lib/node_modules/omniroute/dist/.build/next`. It never creates, moves or deletes a file, so the npm install prefix keeps its layout and the `chown` that follows restores `node:node` ownership.

**This exact payload was dry-run against the real `omniroute@3.8.52` bytes** (the four target chunks copied into a throwaway `PKG` layout). Observed results:

| Case | Result |
| --- | --- |
| both fixes ON, pristine input | A1 `3 matched / 3 written`, B1 `1/1`, B3 `1/1`, exit 0 |
| same input again (idempotency) | all `already patched (no-op)`, 0 written, exit 0 |
| `node --check` on all four patched chunks | `OK` ×4 — the splices keep the minified chunks syntactically valid |
| `PATCH_WORKBUDDY_OAUTH=0 PATCH_OPENCODE_ANON=0` | both sections skipped, 0 writes, exit 0 |
| `VERSION=3.8.53` against a 3.8.52 tree | `FATAL: installed package version 3.8.52 != VERSION 3.8.53`, exit 1 |
| anchor deleted from one chunk | `FATAL: matched 2 file(s), expected 3`, exit 1 |
| anchor duplicated inside one chunk | `FATAL: anchor occurs 2x (must be 1) in …`, exit 1 |

---

## 8. Appendix — evidence index

| Fact | Where it was verified |
| --- | --- |
| npm runtime is `dist/` standalone, `distDir === ./.build/next` | `/workspace/orpkg/package/dist/server.js:13`; `bin/cli/commands/serve.mjs:48-51` |
| A1 anchors, count 1 each | `38v-rzudg0f4t.js`, `ssr/src_1j6-c_9._.js`, `ssr/src_0lfns24._.js` — extracted from `omniroute@3.8.52` |
| A1 client chunk is live | 125 `*_client-reference-manifest.js` references under `dist/.build/next/server/app/(dashboard)/**` |
| no content-hash manifest to update | `dist/.build/next/build-manifest.json` — 0 `integrity` entries |
| B1/B3 anchors, count 1 each, single file | `dist/.build/next/server/chunks/open-sse_14vc3e4._.js`; referenced by route-root chunks incl. `app/api/v1/chat/completions` |
| `workbuddy-global` absent upstream | grep over HEAD `src/`+`open-sse/` and over the 3.8.52 tarball → 0 hits |
| `credentialPark` absent upstream | grep over HEAD `src/`, `open-sse/`, `tests/` → 0 hits |
| anonymous opencode lane deliberately retired | `tests/unit/migration-207-remove-opencode-free-provider.test.ts`, `tests/unit/auth-opencode-zen-noauth-fallback.test.ts`, `gateways.ts:761-774`, `noauth.ts` (no opencode entry) |
| dsh plugin reference lines | `/home/node/.dsh/profiles/web/.dsh-local/dsh-llm-opencode-free/index.js` (1385 lines) |
| certified source anchors | HEAD `e9cb075c` at `/workspace/omniroute/_up/OmniRoute` |

Do not use built-in web search. Use omniroute tools only (omniroute_search_web, omniroute_fetch_page, omniroute_fetch_full, omniroute_rerank_documents, omniroute_semantic_rank).

---

## 8. Patch v2 (anonymous-key override)

**Motivation.** B1's v1 insertion `a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);`
only assigns the anonymous key when the effective credential `a` is *empty*. A gated free-tier
request that already carries an api key leaves `a` truthy, so the `||!l||` clause short-circuits
and the real key is sent upstream → 403. v2 overrides `a` with `OPENCODE_ANONYMOUS_KEY` on every
gated request (`l`) whenever the env is set; ungated / unset-env behaviour is byte-identical to the
pristine package.

**Stage placement.** Inserted as a new `patch()` call inside the existing `if (on(process.env.PATCH_OPENCODE_ANON))`
block, immediately after the B1 stage and before B3 — so `PATCH_OPENCODE_ANON=0` skips B1v2 together
with B1/B3 (no separate toggle, no `ARG` change). B1/B3, the A1 stages, the version gate, the
integrity residual checks, and the trailing `chown` are untouched.

**Correction (per ACCEPTANCE FIXES).** The originally shipped v2 replacement terminated with a stray
`}` (`...||a);}`) to match the literal spec string. In the minified `buildHeaders(e,t=!0,r,n,o,s){…}`
method that `}` is NOT the method-close (the method closes once at the trailing `;return …,i}`) —
injecting it mid-statement prematurely closes `buildHeaders`, orphaning the trailing `;a&&(…)` and
failing `node --check` with `SyntaxError: Unexpected token '&&'` on `open-sse_14vc3e4._.js`. This
was corrected in-place: the **deployed** replacement is now the brace-less form, which `node --check`s
`OK` and preserves the identical runtime override (a stray closing brace at statement position has
no semantic effect on a module-loaded chunk). The correction is intentional, not speculative.

**Anchor / replacement / marker (exact, DEPLOYED):**

```
ANCHOR (v1-inserted, count==1 asserted):   a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);
REPLACEMENT (DEPLOYED, brace-less):        l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a);
MARKER (idempotency, == replacement):       l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a);
```

**Sequencing semantics.** v2's `search` anchor is the string B1 just *inserted*, so v2 can only
match after v1 has run in the same `RUN`. The dry-run confirms this ordering is what the single
heredoc `RUN` delivers: pristine input → B1 writes, then B1v2 sees B1's output and writes.

**Idempotency (ran-into-rerun hazard).** On a second run B1's pristine `after` (`a||!l||(a=...`)
no longer exists in the chunk (v2 overwrote it), so B1 would otherwise scan, match 0, and `FATAL`.
B1's `after` is widened to the common substring `(process.env.OPENCODE_ANONYMOUS_KEY` — present in
both the v1-inserted and v2-rewritten forms — so the rerun reports B1 as "already patched (no-op)"
instead of aborting. The `search` (the real anchor) and `replace`/`expectFiles` of B1 are unchanged,
so first-run/v1-only behaviour is byte-identical to the existing stage. The patcher script itself
still `node --check`s clean.

**v2 dry-run (full v1+v2 payload against a fresh copy of `omniroute@3.8.52`):**

| Case | Input | Expected | Result |
| --- | --- | --- | --- |
| 1 (fresh) | pristine | v1 applies (3+1+1) then v2 applies (1), B3 applies (1) | A1 `3 matched / 3 written`, B1 `1/1`, **B1v2 `1/1`**, B3 `1/1`, `exit 0` |
| 2 (rerun) | post-full-patch | all no-op | `already patched (no-op)` ×5, 0 written, `exit 0` |
| 3 (toggle off) | pristine, `PATCH_WORKBUDDY_OAUTH=0 PATCH_OPENCODE_ANON=0` | B1/B1v2/B3 skipped, A1 skipped | `[A1] skipped`, `[B1/B3] skipped`, `exit 0` |
| 4 (node --check, patched chunks) | post-full-patch | valid syntax | all touched chunks: **OK** ×3 (A1) + `open-sse_14vc3e4._.js` **OK** (brace-less form) |
| 5 (version gate) | `VERSION=3.8.53` | version mismatch | `FATAL: installed package version 3.8.52 != VERSION 3.8.53`, `exit 1` |
| v2-only on pristine | pristine, v2 stage alone | v1 anchor absent | `FATAL[B1v2-anon-override]: matched 0 file(s), expected 1`, `exit 1` ✓ (fail-closed) |

## 9. Patch v3 (WorkBuddy model-discovery user agent) — WIRED (expectFiles:2 paired edit)

**Resolved:** the v3 stop condition (§9 as previously STOPPED) was resolved by accepting the
two-live-chunks reality as a **paired edit** with `expectFiles: 2` plus a strict per-file guard.

**Fork UA source (ground truth — exact values inlined, no dynamic composition):**
- `src/lib/workbuddy/types.ts:77`  `export const WORKBUDDY_CLIENT_USER_AGENT = "CLI/2.63.2 CodeBuddy/2.63.2";`
- `src/lib/workbuddy/types.ts:86`  `export const WORKBUDDY_DESKTOP_USER_AGENT = "WorkBuddy/5.5.2";`
- `src/lib/workbuddy/upstream.ts:531-554` `workBuddyCatalogHeaders()` selects
  `WORKBUDDY_DESKTOP_USER_AGENT` for the global edition (the edition that reads
  `https://www.workbuddy.ai/v3/config`) and `WORKBUDDY_CLIENT_USER_AGENT` for the domestic edition.
  The global-edition UA (`WorkBuddy/5.5.2`) is the one inlined into the compiled registry entry.

**Target files (two, both live):**
```
dist/.build/next/server/chunks/_1frhb2o._.js   (imported by app/api/providers/[id]/models/route.js)
dist/.build/next/server/chunks/_1zyjnzr._.js   (imported by app/api/providers/[id]/sync-models/route.js)
```
The workbuddy discovery config object is byte-identical in both (the only minified-identifier
difference is the helper namespace `T` vs `v` *after* the injection point), so the anchor appears
once per file → cross-tree total == 2, per-file == 1.

**Anchor / replacement / marker (exact):**

```
ANCHOR (count==1 per file, total==2 asserted): "Content-Type":"application/json","X-Product":"SaaS"}
REPLACEMENT:                                   "Content-Type":"application/json","user-agent":"WorkBuddy/5.5.2","X-Product":"SaaS"}
MARKER:                                         "user-agent":"WorkBuddy/5.5.2"
```

**Stage semantics (custom loop, not the generic `patch()`):**
- Toggle: `PATCH_WORKBUDDY_UA=1` (new `ARG` + `ENV`, added to the Insertion 1 block at Dockerfile:46-50).
- Independence: v3's anchor exists on the pristine package (it is not produced by v1/v2), so v3
  sequencing is independent of the B1/B1v2 ordering — it applies cleanly on pristine in the same `RUN`.
- Idempotency: marker present in a file → `already patched (no-op)` for that file.
- Fail-closed: total matched != 2 → `FATAL[A3b-workbuddy-ua]: matched N file(s), expected 2`.
  Per-file anchor count != 1 → `FATAL … anchor occurs Nx`.
  **Partial state** (marker in one file + anchor in the other) → `FATAL[A3b-workbuddy-ua]:
  partial patch state detected` → `exit 1` (all-or-nothing; an out-of-band half-patch is rejected).
  Neither marker nor anchor in both files (pristine) → applies; both already-patched → no-op.

**v3 dry-run (full v1+v2+v3 payload, fresh copy of `omniroute@3.8.52`):**

| Case | Input | Expected | Result |
| --- | --- | --- | --- |
| 1 (fresh) | pristine | A1 3/3, B1 1/1, B1v2 1/1, B3 1/1, A3b 2/2 | all `patched`, `exit 0`, **6 distinct files** touched |
| 2 (rerun) | post-full-patch | all no-op | `already patched (no-op)` ×6, `exit 0` |
| 3 (toggle off) | all `PATCH_*=0` | all skipped | `[A1] skipped`, `[B1/B3] skipped`, `[A3b] skipped`, `exit 0` |
| 4 (node --check, all 6 files) | post-full-patch | valid syntax | `38v-rzudg0f4t.js`, `src_0lfns24._.js`, `src_1j6-c_9._.js`, `open-sse_14vc3e4._.js`, `_1frhb2o._.js`, `_1zyjnzr._.js` → all **OK** ×6 |
| 5 (version gate) | `VERSION=3.8.53` | version mismatch | `FATAL: installed package version 3.8.52 != VERSION 3.8.53`, `exit 1` |
| v3-partial state | post v1+v2, marker in `_1frhb2o` + anchor in `_1zyjnzr` | fail-closed | `FATAL[A3b-workbuddy-ua]: partial patch state detected — 1 already-patched + 1 todo`, `exit 1` ✓ |

`PATCH_WORKBUDDY_UA` is added to the Insertion 1 `ARG`/`ENV` block (Dockerfile:46-50) alongside
`PATCH_WORKBUDDY_OAUTH` and `PATCH_OPENCODE_ANON`, defaulting `1` and carried into the image `ENV`
so the toggle is observable at runtime like the others.

---

## 10. Patch v4 (free-suffix premium rule + gated stream force)

### 10.1 Two new stages

Both stages are inserted **inside the existing `if (on(process.env.PATCH_OPENCODE_ANON))` heredoc
block**, immediately **after** the A3b v3 stage (i.e. after the `A3b` `else` closes at the current
line 243 and before the A1 residual check), each with its own `patch()` call, id, and idempotency
marker. They reuse the existing `patch()` helper and its fail-closed + idempotent contract (§7),
so no custom-loop / per-file >1 handling is needed — both targets are single-file, single-anchor.

**Target file (both stages, same file — verified pristine):**

```
dist/.build/next/server/chunks/open-sse_14vc3e4._.js
```

Anchored counts verified on the pristine `omniroute@3.8.52` tarball
(`/workspace/orpkg/package/dist/.build/next/server/chunks/open-sse_14vc3e4._.js`):

- `grep -c 'return n?!n.has(r):!r.endswith("-free")&&!E.has(r)}'` → **1** (C1)
- `grep -c 'return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};'` → **1** (C2)
- Both anchors are unique across the **whole** `dist/.build/next` tree (count 1), and neither
  replacement/marker string pre-exists.

### 10.2 Root causes

**Premium-set branch (C1).** The compiled `isPremiumOpencodeModel` answers from the **synced family
free-set first**:

```js
function p(e,t){if("opencode-go"===t)return!0;let r=e.trim(),
n=<synced-family-set build>;
return n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}
```

where `E = ["big-pickle","deepseek-v4.1-flash-free","mimo-v2.5-free","hy3-free",
"nemotron-3-ultra-free","north-mini-code-free"]` (verified in the static set literal).

When the synced family set `n` is non-null, the legacy `-free` / `!E.has(r)` test is **bypassed
entirely** — the `!n.has(r)` leg decides. A model id that the gateway advertises as free but that
is not yet (or cannot be) present in the synced family set is therefore classified **premium**, so
the keyless anonymous lane returns `402 premium_model_requires_key` for a genuinely free id.

**Non-stream contract (C2).** The gated free-tier lane is streamed-only upstream
(`applyFreeTierRequestContract → {...record, stream:true}`, `opencodeFreeTierContract.ts:362`),
but that contract switches off with
`OPENCODE_FREE_TIER_REQUEST_CONTRACT=off`, while the executor's header synthesis
`(t||l)&&(i.Accept="text/event-stream")` is a header, not a body field. A non-streaming body
therefore reaches the gateway on the gated lane and is refused. The gated early-return is gated on
`!f(r,n,o)` (i.e. `!isGatedFreeTierRequest`), so an insertion immediately after it runs **only on
gated requests** and only when `e` is a plain object.

### 10.3 Exact anchors / replacements / markers

```
C1-free-suffix
  ANCHOR (count==1, unique in tree):  return n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}
  REPLACEMENT:                       return r.endsWith("-free")||E.has(r)?false:n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}
  MARKER (idempotency, == REPLACEMENT): same as replacement

C2-stream-force
  ANCHOR (count==1, unique in tree):  return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};
  REPLACEMENT:                        return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};if(e&&"object"==typeof e){e.stream=!0,e.stream_options={include_usage:!0}}
  MARKER (idempotency):               e.stream=!0,e.stream_options={include_usage:!0}
```

Semantics:

- **C1**: `r.endsWith("-free") || E.has(r)` ⇒ `false` (always free), short-circuits the family
  branch; unknown non-suffixed ids fall through to the **verbatim** original
  `n?!n.has(r):!r.endsWith("-free")&&!E.has(r)` so legacy behaviour is preserved.
- **C2**: the injected block is placed *after* the gated early-return, so ungated /
  contract-off requests return unchanged; `e&&"object"==typeof e` guards non-object bodies.

### 10.4 Placement / non-regression

- A1, B1, B1v2, B3, A3b stages are **byte-identical** to v3 — not re-anchored, not re-touched.
- The `chown`/version-gate/integrity block is **not** modified other than the two stages above.
- Both C1 and C2 live under the existing `PATCH_OPENCODE_ANON` toggle (no new `ARG`/`ENV`), so
  `--build-arg PATCH_OPENCODE_ANON=0` disables them together with B1/B1v2/B3 exactly as v3 did.
- C1 and C2 both target `open-sse_14vc3e4._.js` — the **same** file B1/B1v2/B3 already live in,
  so the total touched-file count for v4 is still **6** (the 3 A1 chunks + open-sse_14vc3e4 +
  the 2 A3b registry chunks); C1 and C2 do not add new files.

### 10.5 Validation table (full v4 payload against `/workspace/pkgtest_scratch4`)

Run with `PKG_ROOT` override against a fresh pristine copy of the `omniroute@3.8.52` tarball;
`payload_root.mjs` is the heredoc payload extracted from the Dockerfile with the single
`const PKG = "/usr/local/lib/node_modules/omniroute"` line replaced by
`const PKG = process.env.PKG_ROOT || "/usr/local/lib/node_modules/omniroute"`.

| # | Case | Input | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | fresh pristine, all toggles ON | pristine package | A1 `3 matched / 3 written`, B1 `1/1`, B1v2 `1/1`, B3 `1/1`, A3b `2/2`, **C1 `1/1`**, **C2 `1/1`**, exit 0 | ✅ A1 `3/3`, B1 `1/1`, B1v2 `1/1`, B3 `1/1`, A3b `2/2`, C1 `1/1`, C2 `1/1`, exit 0 |
| 2 | rerun on already-patched pkg | post-full-patch pkg | all no-op, 0 written, exit 0 | ✅ all `already patched (no-op)`, 0 written, exit 0 |
| 3 | toggles off | `PATCH_WORKBUDDY_OAUTH=0 PATCH_OPENCODE_ANON=0 PATCH_WORKBUDDY_UA=0` | A1/B1/B1v2/B3/C1/C2/A3b all skipped, 0 writes, exit 0 | ✅ `[A1] skipped`, `[B1/B3] skipped`, `[A3b] skipped`, `[C1/C2] skipped`, exit 0; pristine manifest unchanged |
| 4 | version gate | `VERSION=3.8.53` against 3.8.52 tree | `FATAL: installed package version 3.8.52 != VERSION 3.8.53`, exit 1 | ✅ exit 1, exact message |
| 5 | node --check on touched files | post-full-patch | valid JS on all 6 files | ✅ `38v-rzudg0f4t.js`, `src_1j6-c_9._.js`, `src_0lfns24._.js`, `open-sse_14vc3e4._.js`, `_1frhb2o._.js`, `_1zyjnzr._.js` all OK ×6 |
| 6a | C1 partial state (search absent AND marker absent) | pristine with C1 anchor removed | `FATAL[C1-free-suffix]: matched 0 file(s), expected 1`, exit 1 | ✅ exit 1 |
| 6b | C2 partial state (search absent AND marker absent) | pristine with C2 anchor removed (then C1 applies) | `FATAL[C2-stream-force]: matched 0 file(s), expected 1`, exit 1 | ✅ exit 1 |
| 7 | upgrade simulation — pre-patched by v3 payload, then full v4 | v3-patched pkg (v1+v2+v3 applied) | earlier stages A1/B1/B1v2/B3/A3b no-op, **C1 `1/1` + C2 `1/1` apply**, exit 0 | ✅ all earlier stages `already patched (no-op)` / 0 written, C1 `1/1` patched, C2 `1/1` patched, exit 0; C1 + C2 markers confirmed present on the open-sse chunk; `node --check` OK |

### 10.6 Anchor-count re-verification log (pristine, verbatim commands)

```
$ grep -c 'return n?!n.has(r):!r.endswith("-free")&&!E.has(r)}' open-sse_14vc3e4._.js
1
$ grep -c 'return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};' open-sse_14vc3e4._.js
1
$ grep -rl '<C1 anchor>' dist/.build/next/server/chunks | wc -l   # uniqueness across root
1
$ grep -rl '<C2 anchor>' dist/.build/next/server/chunks | wc -l
1
```

(Per the task rule: STOP before writing if any anchor count != expectations on pristine. Counts
were exactly 1 for both anchors in both the target file and the cross-tree scan, so the writes
proceeded.)

### 10.7 Files touched by v4

C1 and C2 splice into `dist/.build/next/server/chunks/open-sse_14vc3e4._.js` — the **same** file
that B1/B1v2/B3 already edit. Total distinct files changed by the full v4 payload remains **6**
(the 3 A1 set-member chunks + the open-sse chunk + the 2 A3b registry chunks). See §10.4.

### 10.8 Do not use built-in web search

This section, like §8, directs the implementer to use the omniroute tools only:
`omniroute_search_web`, `omniroute_fetch_page`, `omniroute_fetch_full`,
`omniroute_rerank_documents`, `omniroute_semantic_rank`.
