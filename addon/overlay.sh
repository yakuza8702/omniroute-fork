#!/usr/bin/env bash
#
# overlay.sh — apply the WorkBuddy addon onto a pristine OmniRoute source checkout.
#
# Contract (PLAN.workbuddy-port.md §2):
#   1. `set -euo pipefail` — every failure aborts the build, never a partial overlay.
#   2. copy `files/` over the checkout (new files only; no upstream file is replaced by a
#      copy — those go through `patches/`),
#   3. `git apply --check` EVERY patch before applying ANY of them, so a drifted anchor
#      fails with a clean error and an unmodified tree,
#   4. apply the patches in filename order,
#   5. assert every post-condition marker with `node -e` (the overlay is fail-closed: a
#      marker that is missing after patching means the tree is not what the next stage
#      expects, and the build must stop here),
#   6. print `overlay ok` plus the number of files copied.
#
# Re-running is NOT a no-op: `git apply --check` rejects an already-applied patch, so a
# second run fails closed by design (the overlay describes a transition, and applying a
# transition twice is a different request than applying it once).
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
failed_checks=0
for patch in "${PATCHES[@]}"; do
  name="$(basename "$patch")"
  if ! git -C "$TARGET_ROOT" apply --check --whitespace=nowarn "$patch"; then
    echo "overlay: ERROR — ${name} does not apply cleanly to ${TARGET_ROOT}" >&2
    echo "overlay:        (anchor drift, or the patch is already applied)" >&2
    failed_checks=$((failed_checks + 1))
  fi
done
[ "$failed_checks" -eq 0 ] || fail "${failed_checks} patch(es) failed git apply --check; nothing was applied"

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
