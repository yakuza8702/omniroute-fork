# syntax=docker/dockerfile:1
#
# omniroute-fork runtime image
# Assembled from the PREBUILT `omniroute` npm package, pinned; no source compilation. amd64-only.
#
# Why: upstream OmniRoute compiles its image inside Docker (dependency install + Next
# standalone build from a source checkout) and the GitHub release v3.8.52 ships no server
# binary / npm tarball asset,
# only Electron desktop images + source archives. The only prebuilt server channel is the
# npm registry package `omniroute`, so we install exactly that pinned version. No compiler,
# no build toolchain, no source tree in the build context.
#
# Usage:
#   docker build --build-arg VERSION=3.8.52 -t omniroute:3.8.52 .
#
# Runtime contract mirrored from upstream:
#   PORT=20128, HOSTNAME=0.0.0.0, NODE_ENV=production, DATA_DIR=/app/data,
#   OMNIROUTE_MIGRATIONS_DIR=/app/migrations, non-root `node` user, healthcheck, EXPOSE 20128.

FROM node:26-trixie-slim

# Pinned EXACT version — no `^`, no `~`. Required: fail the build early if absent.
ARG VERSION
RUN set -eux; \
    if [ -z "${VERSION}" ]; then \
        echo "ERROR: build-arg VERSION is required (e.g. --build-arg VERSION=3.8.52)" >&2; \
        exit 1; \
    fi

# Upstream ENV contract (no memory/turbopack knobs here: nothing is compiled at build time).
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true \
    NODE_ENV=production \
    PORT=20128 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    OMNIROUTE_MIGRATIONS_DIR=/app/migrations

# Global bin path resolved by the workflow preflight from the package `bin` field
# (npm links unscoped bins at /usr/local/bin/<key>). Default matches the usual link
# location so a plain `docker build` without the arg still works.
ARG OMNIROUTE_BIN=/usr/local/bin/omniroute
ENV OMNIROUTE_BIN=${OMNIROUTE_BIN}
# ── fork-local patch toggles (default: patch ON, both fixes independently switchable) ──
# Anchor edits are applied to the installed npm package's compiled chunks; they are
# fail-closed (a missing or ambiguous anchor aborts the build) and idempotent.
ARG PATCH_WORKBUDDY_OAUTH=1
ARG PATCH_OPENCODE_ANON=1
ARG PATCH_WORKBUDDY_UA=1
ENV PATCH_WORKBUDDY_OAUTH=${PATCH_WORKBUDDY_OAUTH} \
    PATCH_OPENCODE_ANON=${PATCH_OPENCODE_ANON} \
    PATCH_WORKBUDDY_UA=${PATCH_WORKBUDDY_UA}

# Install the prebuilt server package from the public npm registry.
# `--omit=dev` is best-effort: global installs normally resolve prod deps only anyway.
RUN set -eux; \
    npm install --global --omit=dev "omniroute@${VERSION}"; \
    npm cache clean --force; \
    rm -rf /root/.npm /tmp/*

# ── fork-local patches: literal anchor splices on the shipped compiled bundles ──────
# Rationale: the runtime is dist/server.js + dist/.build/next (standalone), not src/**,
# so a source-level edit inside the image would never load. Every anchor below was
# extracted from the pinned tarball and is asserted unique (count == 1) before use.
# A version bump that moves or duplicates an anchor FAILS THE BUILD here, by design.
RUN node --input-type=module - <<'PATCH_EOF'
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
    after: '(process.env.OPENCODE_ANONYMOUS_KEY',
    expectFiles: 1,
  });

  // ── B1v2: anonymous key override for gated free-tier requests that still carry a credential ──
  // v1 (B1 above) only fills `a` when it is empty (`a||!l||`); a gated request that already carries
  // an api key therefore still sends that key and still 403s. v2 overrides `a` with
  // OPENCODE_ANONYMOUS_KEY on every gated request (`l`) when the env is set, while ungated / unset-env
  // behaviour is byte-identical to the pristine package. Runs in the same PATCH_OPENCODE_ANON guard
  // as B1/B3 and is skipped together with them when PATCH_OPENCODE_ANON=0.
  //
  // ANCHOR (v1-inserted, asserted count==1 by the post-condition scan):
  //   'a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);'
  // REPLACEMENT (syntax-correct; trailing method-closing brace omitted so the minified
  // `buildHeaders(...) {...}` stays a single balanced method — verified `node --check`):
  //   'l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a);'
  // Idempotency marker = the v2 replace string (per-file count asserted == 1).
  // If the v1 anchor is absent AND the v2 marker is absent → FATAL (matched 0 file(s), expected 1).
  patch({
    id: "B1v2-anon-override",
    root: path.join(NEXT, "server", "chunks"),
    search: 'a||!l||(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||void 0);',
    replace: 'l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a);',
    after: 'l&&(a=(process.env.OPENCODE_ANONYMOUS_KEY||"").trim()||a);',
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

// ── A3b: WorkBuddy model-discovery user agent (2 compiled copies, paired edit) ─────
// The global WorkBuddy /v3/config catalogue read must be issued as the desktop client (its
// CLI channel serves a different roster). Upstream omits a `user-agent` on the discovery entry;
// the fork injects the desktop UA. The anchor is byte-identical in BOTH live registry chunks
// (_1frhb2o._.js for /models, _1zyjnzr._.js for /sync-models), so expectFiles:2 with a strict
// per-file guard (==1 occurrence in each, total ==2). Skipped when PATCH_WORKBUDDY_UA=0.
if (on(process.env.PATCH_WORKBUDDY_UA)) {
  const UA_MARKER = '"user-agent":"WorkBuddy/5.5.2"';
  const UA_ANCHOR = '"Content-Type":"application/json","X-Product":"SaaS"}';
  const UA_REPL   = '"Content-Type":"application/json","user-agent":"WorkBuddy/5.5.2","X-Product":"SaaS"}';
  const uaRoot = path.join(NEXT, "server", "chunks");
  const uaHits = [];
  for (const file of walk(uaRoot)) {
    const text = fs.readFileSync(file, "utf8");
    const hasAnchor = text.split(UA_ANCHOR).length - 1;
    const hasMarker = text.includes(UA_MARKER);
    if (hasMarker) { uaHits.push({ file, state: "already" }); continue; }
    if (hasAnchor === 0) continue;
    if (hasAnchor !== 1) {
      console.error(`FATAL[A3b-workbuddy-ua]: anchor occurs ${hasAnchor}x in ${file} (must be 1)`);
      process.exit(1);
    }
    uaHits.push({ file, text, state: "todo" });
  }
  if (uaHits.length !== 2) {
    console.error(`FATAL[A3b-workbuddy-ua]: matched ${uaHits.length} file(s), expected 2`);
    for (const h of uaHits) console.error(`  ${h.state} ${h.file}`);
    process.exit(1);
  }
  // Fail-closed on a partial state: a mix of "already patched" + "todo" across the two files
  // means one chunk was patched by hand/out-of-band. All-or-nothing only.
  const uaTodo = uaHits.filter((h) => h.state === "todo");
  const uaAlready = uaHits.filter((h) => h.state === "already");
  if (uaTodo.length > 0 && uaAlready.length > 0) {
    console.error(`FATAL[A3b-workbuddy-ua]: partial patch state detected — ${uaAlready.length} already-patched + ${uaTodo.length} todo`);
    for (const h of uaHits) console.error(`  ${h.state} ${h.file}`);
    process.exit(1);
  }
  let uaWritten = 0;
  for (const h of uaHits) {
    if (h.state === "already") { console.log(`[A3b] already patched (no-op): ${h.file}`); continue; }
    const next = h.text.replace(UA_ANCHOR, UA_REPL);
    if (!next.includes(UA_MARKER)) {
      console.error(`FATAL[A3b-workbuddy-ua]: post-condition failed in ${h.file}`);
      process.exit(1);
    }
    fs.writeFileSync(h.file, next);
    uaWritten += 1;
    console.log(`[A3b] patched: ${h.file}`);
  }
  console.log(`[A3b] ok — ${uaHits.length} file(s) matched, ${uaWritten} written`);
} else {
  console.log("[A3b] skipped (PATCH_WORKBUDDY_UA=off)");
}

// ── C1 (v4): free-suffix premium rule — `-free` suffix / static E id ⇒ always free ──
// Root cause (premium-set branch): `isPremiumOpencodeModel(e,t)` answers from the SYNCED
// family free-set first — compiled `function p(e,t){if("opencode-go"===t)return!0;let r=e.trim(),
// n=<synced-family-set build>;return n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}` where E is the
// static set ["big-pickle","deepseek-v4.1-flash-free","mimo-v2.5-free","hy3-free",
// "nemotron-3-ultra-free","north-mini-code-free"]. When the family set `n` is non-null the legacy
// `-free` test is bypassed entirely, so an id the gateway advertises as free is classified premium
// until the synced set picks it up → the keyless lane answers 402 premium_model_requires_key for a
// genuinely free model. v4 pins the rule AHEAD of the family branch: an id ending in `-free`, or one
// of the six static E ids, is always free regardless of the family set; unknown non-suffixed ids
// stay premium (the original family/legacy fallback is preserved verbatim after the injected guard).
// Runs in the same PATCH_OPENCODE_ANON guard (the Goal-B toggle) as B1/B1v2/B3/C2.
if (on(process.env.PATCH_OPENCODE_ANON)) {
  patch({
    id: "C1-free-suffix",
    root: path.join(NEXT, "server", "chunks"),
    search: 'return n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}',
    replace: 'return r.endsWith("-free")||E.has(r)?false:n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}',
    after: 'return r.endsWith("-free")||E.has(r)?false:n?!n.has(r):!r.endsWith("-free")&&!E.has(r)}',
    expectFiles: 1,
  });

  // ── C2 (v4): force byte-streaming on the gated free-tier request ───────────────────
  // Root cause (non-stream contract): the gated free-tier lane is streamed-only, and upstream's
  // body contract (applyFreeTierRequestContract → `{...record, stream:true}`) switches off with
  // OPENCODE_FREE_TIER_REQUEST_CONTRACT=off, while the executor's own `(t||l)&&(i.Accept=
  // "text/event-stream")` is a header, not a body. A non-streaming body therefore reaches the
  // gateway on the gated lane and is refused. v4 inserts `stream:true` + `stream_options.
  // include_usage` immediately AFTER the gated early-return
  //   `if(!f(r,n,o)||"off"===(process.env.OPENCODE_FREE_TIER_REQUEST_CONTRACT||"").trim().toLowerCase())
  //     return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};`
  // so it runs ONLY on gated requests (the early-return already returned otherwise) and only when
  // the body is a plain object. Same fail-closed/idempotent contract and PATCH_OPENCODE_ANON toggle.
  patch({
    id: "C2-stream-force",
    root: path.join(NEXT, "server", "chunks"),
    search: 'return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};',
    replace:
      'return b(i)&&(0,c.forgetAttempt)(i),{body:e,attempt:null};if(e&&"object"==typeof e){e.stream=!0,e.stream_options={include_usage:!0}}',
    after: 'e.stream=!0,e.stream_options={include_usage:!0}',
    expectFiles: 1,
  });
} else {
  console.log("[C1/C2] skipped (PATCH_OPENCODE_ANON=off)");
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
PATCH_EOF

# Every patched file must still be owned by the runtime user (see the note at line 51-52).
RUN chown -R node:node /usr/local/lib/node_modules/omniroute

# The runtime user must own its own package tree: the CLI (and anything it writes back into
# the install prefix, e.g. caches or self-heal paths) runs as `node`, not root.

# Runtime data dirs owned by the unprivileged `node` user (uid/gid 1000 in the official image).
# NOTE (ASSUMPTION): /app/migrations is only created so OMNIROUTE_MIGRATIONS_DIR resolves; the
# npm package is expected to bring its own migration files or to receive them via a mounted
# volume at runtime. Nothing is copied or symlinked here because the package layout is not
# verifiable from this repo without compiling/inspecting upstream sources.
RUN set -eux; \
    mkdir -p /app/data /app/migrations; \
    chown -R node:node /app

# The global bin name is discovered at build time (preflight reads the npm `bin` field) and
# exported as OMNIROUTE_BIN; Docker cannot expand variables inside ENTRYPOINT JSON form, so a
# tiny exec wrapper resolves it at runtime and forwards every extra arg unchanged.
RUN set -eux; \
    printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'exec "${OMNIROUTE_BIN:-/usr/local/bin/omniroute}" "$@"' \
        > /usr/local/bin/docker-entrypoint.sh; \
    chmod 0755 /usr/local/bin/docker-entrypoint.sh; \
    test -x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
USER node

EXPOSE 20128

# Port-level healthcheck only: the upstream healthcheck.mjs ships inside the compiled image,
# not inside the npm tarball, and no public health route is documented, so we probe a TCP
# connect on the service port (same 20128 the app binds) instead of inventing an HTTP path.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["node","-e","const net=require('net');const s=net.connect(Number(process.env.PORT||20128),'127.0.0.1');s.setTimeout(4000);s.on('connect',()=>{s.end();process.exit(0)});s.on('timeout',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(1));"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# CMD MUST stay cleared: the base image ships CMD ["node"], which would be appended to the
# ENTRYPOINT and run `omniroute node` ("too many arguments for 'serve'"). An empty CMD lets
# the CLI default-dispatch to `serve`, while `docker run IMAGE <args>` still overrides cleanly.
CMD []
