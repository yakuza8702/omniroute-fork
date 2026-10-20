/**
 * WorkBuddy addon — reasoning-effort override vocabulary (client-safe).
 *
 * A WorkBuddy model declares its own thinking ladder in the catalogue, but an operator
 * sometimes needs to NARROW or WIDEN what the gateway advertises for one model. That
 * override is persisted through the platform's generic capability API
 * (`PATCH /api/model-capability-overrides`, key `reasoning_efforts`), and the executor
 * consults it before the synced row (plan §B2/D6) — so what is edited here is what the
 * wire actually enforces, not a cosmetic label.
 *
 * The vocabulary below is deliberately the INTERSECTION of the two sets the platform
 * already speaks:
 *
 *   - the gateway ladder (`upstream.ts` `WORKBUDDY_THINKING_LADDER`) adds `minimal`;
 *   - the override parser (`shared/reasoning/reasoningEffortsOverride.ts`) adds `ultra`.
 *
 * Offering either of those here would let an operator save a value the other side cannot
 * honour, so the editor only ever emits what both ends accept (plan §R7).
 *
 * @module shared/utils/workBuddyEfforts
 */

/** Effort levels an operator may persist for a WorkBuddy model, lowest → highest. */
export const WORKBUDDY_EFFORT_OVERRIDE_VALUES = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type WorkBuddyEffortOverrideValue = (typeof WORKBUDDY_EFFORT_OVERRIDE_VALUES)[number];

const EFFORT_SET = new Set<string>(WORKBUDDY_EFFORT_OVERRIDE_VALUES);

/** Whether a string is one of the values this editor may persist. */
export function isWorkBuddyEffortOverrideValue(
  value: unknown
): value is WorkBuddyEffortOverrideValue {
  return typeof value === "string" && EFFORT_SET.has(value);
}

/**
 * Parse a persisted comma-separated value into the editor's ordered vocabulary.
 *
 * Unknown words are DROPPED rather than rejected: a row written by a future release (say
 * `ultra`) must not make the editor unusable, and dropping is the only lossless choice —
 * re-saving sends back only what this build can honour.
 */
export function parseWorkBuddyEfforts(value: unknown): WorkBuddyEffortOverrideValue[] {
  if (typeof value !== "string") return [];
  const selected = new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is WorkBuddyEffortOverrideValue =>
        isWorkBuddyEffortOverrideValue(entry)
      )
  );
  return WORKBUDDY_EFFORT_OVERRIDE_VALUES.filter((entry) => selected.has(entry));
}

/** Serialize a selection in ladder order; an empty selection means "no override". */
export function serializeWorkBuddyEfforts(values: readonly (string | null | undefined)[]): string {
  const selected = new Set(values.filter((value): value is string => typeof value === "string"));
  return WORKBUDDY_EFFORT_OVERRIDE_VALUES.filter((entry) => selected.has(entry)).join(",");
}

/**
 * Add or remove one level, preserving ladder order.
 *
 * The scheduled order matters: the saved string is what the executor clamps against, and
 * an unordered set would make the model's floor depend on click order.
 */
export function toggleWorkBuddyEffort(
  current: readonly string[],
  effort: WorkBuddyEffortOverrideValue
): WorkBuddyEffortOverrideValue[] {
  const selected = new Set(current);
  if (selected.has(effort)) selected.delete(effort);
  else selected.add(effort);
  return WORKBUDDY_EFFORT_OVERRIDE_VALUES.filter((entry) => selected.has(entry));
}

/** Human-readable selection (`"low, high"`), or `null` when nothing is selected. */
export function formatWorkBuddyEfforts(values: readonly string[]): string | null {
  const ordered = serializeWorkBuddyEfforts(values);
  if (ordered === "") return null;
  return ordered.split(",").join(", ");
}
