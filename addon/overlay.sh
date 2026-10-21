#!/usr/bin/env bash
#
# overlay.sh — apply the WorkBuddy addon onto a pristine OmniRoute source checkout.
#
# Contract (PLAN.workbuddy-port.md §2):
#   1. `set -euo pipefail` — every failure aborts the build, never a partial overlay.
#   2. copy `files/` over the checkout (new files only; no upstream file is replaced by a
#      copy — those go through `patches/`),
#   3. preflight the WHOLE series before applying ANY of it — cumulatively, against a throwaway
#      index (`git apply --cached`), because later patches build on earlier ones, and only on a
#      work tree that still matches HEAD (the replay's model of it). A drifted anchor fails with a
#      clean error and an unmodified work tree,
#   4. apply the patches in filename order,
#   5. assert every post-condition marker with `node -e` (the overlay is fail-closed: a
#      marker that is missing after patching means the tree is not what the next stage
#      expects, and the build must stop here),
#   6. print `overlay ok` plus the number of files copied.
#
# Re-running is NOT a no-op: the overlay describes a transition, and applying a transition twice
# is a different request than applying it once. A second run is refused because the work tree no
# longer matches HEAD (and, for an uncommitted overlay, because the series no longer applies to
# the index it starts from) — fail-closed by design.
#
# Usage:
#   bash addon/overlay.sh [TARGET_ROOT]      # default: /src (Dockerfile.source fetch stage)
#   WORKBUDDY_TARGET_ROOT=/path bash addon/overlay.sh
#
set -euo pipefail

ADDON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ROOT="${1:-${WORKBUDDY_TARGET_ROOT:-/src}}"

fail() {
  echo "overlay: ERROR — $*" >&2
  exit 1
}

[ -d "$ADDON_DIR/files" ] || fail "missing files/ next to overlay.sh ($ADDON_DIR/files)"
[ -d "$ADDON_DIR/patches" ] || fail "missing patches/ next to overlay.sh ($ADDON_DIR/patches)"
[ -d "$TARGET_ROOT" ] || fail "target root does not exist: $TARGET_ROOT"

# `git apply` is the contract's patcher: it refuses an anchor that moved instead of
# fuzzy-matching, which is exactly the fail-closed behaviour §2 asks for.
TARGET_ROOT="$(cd -- "$TARGET_ROOT" && pwd)"
git -C "$TARGET_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "target root is not a git work tree: $TARGET_ROOT (needed for git apply --check)"

shopt -s nullglob
PATCHES=("$ADDON_DIR"/patches/*.patch)
shopt -u nullglob
[ "${#PATCHES[@]}" -gt 0 ] || fail "no patches found in $ADDON_DIR/patches"

# ── 1. copy the new files ────────────────────────────────────────────────────
COPIED_FILES="$(find "$ADDON_DIR/files" -type f | wc -l | tr -d ' ')"
cp -a "$ADDON_DIR/files/." "$TARGET_ROOT/"
echo "overlay: copied ${COPIED_FILES} file(s) into ${TARGET_ROOT}"

# ── 2. preflight every patch BEFORE applying any ─────────────────────────────
#
# The series is CUMULATIVE: from wave 3 on, a later patch builds on an earlier one (0004 edits
# the same two components 0003 touched), so checking each patch against the *unpatched* work
# tree would false-fail even though the series is correct. The preflight therefore replays the
# series against a throwaway index:
#
#   * `GIT_INDEX_FILE` points at a scratch index seeded from HEAD (`read-tree`),
#   * each patch is applied with `--cached`, which reads and writes blobs in the object
#     database ONLY — the work tree is never touched, so a failure still leaves it pristine,
#   * the first patch that does not apply aborts the run BEFORE anything reaches the work tree.
#
# The scratch index lives under the repository's own git dir (same filesystem, writable) rather
# than $TMPDIR, which on a container build may be small or read-only.
#
# Because the replay starts from HEAD, it is only a faithful model of the apply phase when the
# WORK TREE still matches HEAD. That is therefore a precondition, not an assumption: a checkout
# with tracked modifications (the usual symptom of a second run) is refused up front with a clear
# message instead of failing halfway through the apply phase.
if ! git -C "$TARGET_ROOT" diff --quiet HEAD --; then
  fail "work tree has changes relative to HEAD in $TARGET_ROOT; the overlay describes a transition from a pristine checkout (the patches are probably already applied) — nothing was applied"
fi

GIT_DIR_PATH="$(git -C "$TARGET_ROOT" rev-parse --git-path "workbuddy-overlay-preflight.$$")"
case "$GIT_DIR_PATH" in
  /*) PREFLIGHT_INDEX="$GIT_DIR_PATH" ;;
  *) PREFLIGHT_INDEX="$TARGET_ROOT/$GIT_DIR_PATH" ;;
esac
cleanup_preflight() { rm -f "$PREFLIGHT_INDEX" "$PREFLIGHT_INDEX.lock"; }
trap cleanup_preflight EXIT
cleanup_preflight
GIT_INDEX_FILE="$PREFLIGHT_INDEX" git -C "$TARGET_ROOT" read-tree HEAD ||
  fail "could not seed the preflight index from HEAD in $TARGET_ROOT"

for patch in "${PATCHES[@]}"; do
  name="$(basename "$patch")"
  if ! GIT_INDEX_FILE="$PREFLIGHT_INDEX" \
    git -C "$TARGET_ROOT" apply --cached --whitespace=nowarn "$patch"; then
    echo "overlay: ERROR — ${name} does not apply cleanly to ${TARGET_ROOT}" >&2
    echo "overlay:        (anchor drift, or the patch is already applied)" >&2
    fail "the patch series stops at ${name}; nothing was applied to the work tree"
  fi
done
echo "overlay: preflight passed for ${#PATCHES[@]} patch(es)"

# ── 3. apply ─────────────────────────────────────────────────────────────────
for patch in "${PATCHES[@]}"; do
  git -C "$TARGET_ROOT" apply --whitespace=nowarn "$patch"
  echo "overlay: applied $(basename "$patch")"
done

# ── 4. post-condition markers (fail-closed) ──────────────────────────────────
cd -- "$TARGET_ROOT"
node --input-type=module -e '
import fs from "node:fs";

const markers = [
  ["src/lib/workbuddy/types.ts", "export const WORKBUDDY_PROVIDER_ID = \"workbuddy\""],
  ["src/lib/workbuddy/types.ts", "export function workBuddyAddonEnabled()"],
  ["src/lib/workbuddy/upstream.ts", "export function parseWorkBuddyModelLoose("],
  ["src/lib/workbuddy/addonInfo.ts", "export function describeWorkBuddyAddon()"],
  ["src/app/api/providers/[id]/models/discovery/normalizers.ts", "parseWorkBuddyModelLoose"],
  ["src/app/api/providers/[id]/models/discovery/normalizers.ts", "creditMultiplier: model.creditMultiplier"],
  ["src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts", "\"user-agent\": \"WorkBuddy/5.5.2\""],
  ["src/lib/providerModels/modelDiscovery.ts", "record.creditMultiplier"],
  ["src/lib/db/models/synced.ts", "creditMultiplier?: number"],
  ["src/lib/db/models/synced.ts", "creditMultiplier !== undefined ? { creditMultiplier }"],
  ["src/app/api/providers/[id]/models/discovery/catalogModels.ts", "model.creditMultiplier"],
  ["src/app/(dashboard)/dashboard/providers/[id]/hooks/useModelImportHandlers.ts", "max_output_tokens"],
  // 0002 — Feature B (reasoning contract). The executor path, its ladder cache, the two
  // executor-map keys, the post-sync invalidation and the golden snapshot that freezes the
  // map. A patch that applied but silently stopped short of any of these is a build failure,
  // not a warning: the ladder is the difference between a working request and a 400.
  ["src/lib/workbuddy/upstream.ts", "export function normalizeWorkBuddyReasoning("],
  ["src/lib/workbuddy/modelDiscovery.ts", "export async function invalidateWorkBuddyModelCaches("],
  [
    "open-sse/executors/workbuddyReasoning.ts",
    "export async function resolveWorkBuddyReasoningContract(",
  ],
  ["open-sse/executors/workbuddyReasoning.ts", "getReasoningEffortsOverride("],
  ["open-sse/executors/workbuddyReasoning.ts", "export function resetWorkBuddyReasoningContractCache("],
  ["open-sse/executors/workbuddy.ts", "export class WorkBuddyExecutor extends DefaultExecutor"],
  ["open-sse/executors/workbuddy.ts", "normalizeWorkBuddyReasoning(out as Record<string, unknown>, contract)"],
  ["open-sse/executors/index.ts", "workbuddy: () => import(\"./workbuddy.ts\")"],
  ["open-sse/executors/index.ts", "wb: () => import(\"./workbuddy.ts\")"],
  ["src/app/api/providers/[id]/sync-models/route.ts", "invalidateWorkBuddyModelCaches()"],
  ["tests/snapshots/executors/executor-map.json", "\"WorkBuddyExecutor\""],
  ["tests/unit/workbuddy-reasoning.test.ts", "override-first"],
  // 0003 — Feature C (credits). The shared credit rule, the completed discovery mapping, the
  // pooled quota engine, the credits route, and the one UI insertion that has no compile-time
  // proof of its own (the badge is optional on every row, so a missing prop renders nothing).
  ["src/shared/utils/workBuddyCredit.ts", "export function formatWorkBuddyCreditBadge("],
  ["src/lib/workbuddy/modelDiscovery.ts", "export function workBuddyModelsToSyncedInput("],
  ["src/lib/workbuddy/poolQuota.ts", "export async function probeWorkBuddyPoolCredits("],
  ["src/app/api/workbuddy/credits/route.ts", "const poolWide = isEnabledFlag("],
  [
    "src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionRow.tsx",
    "WorkBuddyPoolCreditBadge connectionId={connection.id}",
  ],
  // 0004 — Feature D (capability editors). Two markers, one per editor path: the effort override
  // (WorkBuddy-only) and the vision toggle (the generic compatOnly PUT).
  ["src/shared/utils/workBuddyEfforts.ts", "export const WORKBUDDY_EFFORT_OVERRIDE_VALUES"],
  [
    "src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelsSection.tsx",
    "onSaveReasoningEfforts: saveReasoningEfforts",
  ],
  [
    "src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelRow.tsx",
    "Toggle vision capability override",
  ],
  // 0005 — the opencode free lane. One marker per half: the premium classify (known-free ids
  // short-circuit the synced catalog) and the anonymous key that replaces the connection key on
  // a gated free request. Both are single-source-level facts; either missing means the 403
  // regression is back, which no type check can see.
  [
    "open-sse/executors/opencodeFreeTierContract.ts",
    "if (id.endsWith(\"-free\") || OPENCODE_LEGACY_FREE_MODELS.has(id)) return false;",
  ],
  ["open-sse/executors/opencode.ts", "const anonymousFreeTierKey = gatedScope"],
  // Wave 4 — the credit badge promotes itself to ONE full probe when the fast snapshot has no
  // verdict. The marker is the promoted call, not the helper export: a badge that imports the
  // rule but never runs it is exactly the "Credits unknown" bug.
  [
    "src/app/(dashboard)/dashboard/providers/[id]/components/WorkBuddyPoolCreditBadge.tsx",
    "needsWorkBuddyFullCreditProbe(fast)",
  ],
  // 0006 — the Compatibility action is icon-only on the model rows, with the label kept as the
  // accessible name (the neighbouring eye-button pattern). No label text ⇒ nothing to clip.
  [
    "src/app/(dashboard)/dashboard/providers/[id]/components/ModelCompatPopover.tsx",
    "aria-label={t(\"compatButtonLabel\")}",
  ],
  // 0009 — workbuddy is routed through the device-code panel. Two markers, because the failure
  // mode this guards is positional: the set is a list of literals consumed by `has(provider)`, so
  // an entry that exists but sits under a different flow (or outside the literal) still
  // type-checks and renders the wrong step. The first pins the rationale comment; the second pins
  // the entry as the last member of the literal (inside DEVICE_CODE_PROVIDERS, not a neighbour).
  // NOTE: this block is a single-quoted `node -e` script — no apostrophes in these comments.
  [
    "src/shared/components/OAuthModal.tsx",
    "// workbuddy: device-flow only (upstream flowType: \"device_code\"",
  ],
  ["src/shared/components/OAuthModal.tsx", "  \"workbuddy\",\n]);"],
  // 0007 — wave 5 (quota budget). The Provider Quota card had no WorkBuddy surface at all: the
  // provider is absent from USAGE_SUPPORTED_PROVIDERS, so the filter dropped the connection and
  // there was no card to put a badge on. Three markers, one per hop of the only path that can
  // carry a per-connection node: the panel admits the connection and builds the slot, the grid
  // forwards it to every QuotaCard (both render paths), the card renders it under the quota body.
  // Either hop missing compiles fine and renders nothing, which is exactly the wave-5 bug.
  [
    "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx",
    "renderCreditsSlot={(conn) => {",
  ],
  [
    "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCardGrid.tsx",
    "creditsSlot={renderCreditsSlot ? renderCreditsSlot(conn) : undefined}",
  ],
  [
    "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCard.tsx",
    "{creditsSlot ? (",
  ],
  // 0008 — the operator brief. It is COPY-DELIVERED (addon/files/docs/reference/), so these two
  // markers assert the delivered artifact rather than a hunk: the docs index lists the page (a
  // nav entry pointing at nothing is a broken docs build) and the page still documents the
  // kill switch the removal section promises. The doc is the addon judgement call most likely to
  // be lost, so its presence is a build fact, not a nicety.
  ["docs/reference/meta.json", "\"WORKBUDDY_ADDON\""],
  ["docs/reference/WORKBUDDY_ADDON.md", "WORKBUDDY_ADDON=0"],
  // 0010 — wave 6 (remedial). The generic per-connection usage route answers
  // 400 "Usage not available for this connection" for workbuddy, and the card drew that string
  // as a red banner beside its credits strip. Two markers: the gate itself (a card whose fetch
  // still fires IS the reported bug) and the comment that says where the quota actually comes
  // from — the only place the next reader learns it is the pool snapshot. Both sit inside
  // fetchQuota, the single choke point every caller funnels through. The predicate behind the
  // gate is a pure helper in shared/utils, so it also has a real unit suite
  // (tests/unit/workbuddy-quota-usage-skip.test.ts) that pins the call site at source level.
  [
    "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx",
    "if (!shouldFetchUsage(provider)) return;",
  ],
  [
    "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx",
    "reports quota via /api/workbuddy/credits",
  ],
];

let missing = 0;
for (const [file, marker] of markers) {
  let body;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    console.error(`overlay: ERROR — post-condition file missing: ${file}`);
    missing += 1;
    continue;
  }
  if (!body.includes(marker)) {
    console.error(`overlay: ERROR — post-condition marker missing in ${file}: ${marker}`);
    missing += 1;
  }
}
if (missing > 0) {
  console.error(`overlay: ${missing} post-condition assertion(s) failed`);
  process.exit(1);
}
console.log(`overlay: ${markers.length} post-condition assertions passed`);
'

echo "overlay ok — ${#PATCHES[@]} patch(es), ${COPIED_FILES} file(s)"
