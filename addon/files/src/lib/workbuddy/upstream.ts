/**
 * WorkBuddy addon — catalogue parser.
 *
 * The upstream `/v3/config` document is the same one the WorkBuddy app consumes, so it
 * carries everything the dashboard needs: the token windows, the vision/tool flags, the
 * reasoning metadata and — the field this addon exists for — each model's declared credit
 * rate (`credits: "x0.03 credits"`).
 *
 * Two parsers, one shape:
 *
 *   - {@link parseWorkBuddyModel} is STRICT: an entry without usable token limits is
 *     dropped rather than served with a fabricated window. It stays authoritative for the
 *     credit / free-model paths, where a `0`-window entry would be nonsense.
 *   - {@link parseWorkBuddyModelLoose} keeps the entry when the limits are absent
 *     (`contextLength`/`maxOutputTokens` = 0), because the discovery normalizer's job is to
 *     publish the roster: one missing field upstream must not silently shrink it. The
 *     normalizer then omits the window fields, so the catalog's 200k fallback applies
 *     instead of a `0` window being written.
 *
 * Pure functions only: no I/O, no env, no DB — importable from a route, an executor or a
 * unit test.
 *
 * @module lib/workbuddy/upstream
 */

import type { WorkBuddyModel, WorkBuddyModelReasoning } from "./types";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Effort levels the gateway declares across its catalogue.
 *
 * A model that declares a singular `effort` accepts the whole ladder — the declared value
 * is a DEFAULT, never the model's only level.
 */
const SINGULAR_EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Parse the upstream's `credits` string into a multiplier.
 *
 * Observed forms: `"x0.79 credits"`, `"x0.05"`, `"x0.00 credits"`, or absent. An
 * unparsable value yields `undefined` rather than a guess, so the UI omits the rate
 * instead of displaying a fabricated one.
 */
export function parseWorkBuddyCreditMultiplier(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /x\s*([0-9]*\.?[0-9]+)/iu.exec(value);
  if (match === null) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** True for the singular spelling of the reasoning metadata (`effort` and nothing else). */
export function isSingularWorkBuddyEffortForm(raw: JsonRecord): boolean {
  return (
    typeof raw.effort === "string" &&
    !Array.isArray(raw.supportedEfforts) &&
    typeof raw.defaultEffort !== "string" &&
    typeof raw.canDisableThinking !== "boolean"
  );
}

/** Parse the upstream `reasoning` object; unknown shapes degrade to `undefined`. */
export function parseWorkBuddyReasoning(value: unknown): WorkBuddyModelReasoning | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as JsonRecord;
  const effort = asString(raw.effort);
  const declared = Array.isArray(raw.supportedEfforts)
    ? raw.supportedEfforts.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const supportedEfforts =
    declared && declared.length > 0
      ? declared
      : effort === undefined
        ? undefined
        : SINGULAR_EFFORT_LADDER.includes(effort as (typeof SINGULAR_EFFORT_LADDER)[number])
          ? [...SINGULAR_EFFORT_LADDER]
          : [effort];
  const defaultEffort = asString(raw.defaultEffort) ?? effort;
  const canDisableThinking =
    typeof raw.canDisableThinking === "boolean"
      ? raw.canDisableThinking
      : isSingularWorkBuddyEffortForm(raw)
        ? true
        : undefined;
  if (!supportedEfforts && defaultEffort === undefined && canDisableThinking === undefined) {
    return undefined;
  }
  return {
    ...(supportedEfforts ? { supportedEfforts } : {}),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
    ...(canDisableThinking === undefined ? {} : { canDisableThinking }),
  };
}

/** The capability half of an entry — everything that does not depend on token limits. */
function parseWorkBuddyModelCapabilities(
  raw: JsonRecord
): Omit<WorkBuddyModel, "contextLength" | "maxOutputTokens"> {
  const creditMultiplier = parseWorkBuddyCreditMultiplier(raw.credits);
  const reasoning = parseWorkBuddyReasoning(raw.reasoning);
  const supportsToolCall =
    typeof raw.supportsToolCall === "boolean" ? raw.supportsToolCall : undefined;
  const supportsVision =
    raw.disabledMultimodal === true
      ? false
      : typeof raw.supportsImages === "boolean"
        ? raw.supportsImages
        : undefined;
  const descriptionZh = asString(raw.descriptionZh);
  const descriptionEn = asString(raw.descriptionEn);

  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? asString(raw.id) ?? "",
    ...(creditMultiplier === undefined ? {} : { creditMultiplier }),
    ...(supportsVision === undefined ? {} : { supportsVision }),
    ...(supportsToolCall === undefined ? {} : { supportsToolCall }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(descriptionZh === undefined ? {} : { descriptionZh }),
    ...(descriptionEn === undefined ? {} : { descriptionEn }),
  };
}

/**
 * Parse one catalogue entry, dropping anything unusable.
 *
 * Entries without an id, explicitly disabled server-side, or without usable token limits
 * are dropped rather than served with a fabricated window.
 */
export function parseWorkBuddyModel(value: unknown): WorkBuddyModel | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as JsonRecord;
  const id = asString(raw.id);
  if (!id || raw.disabled === true) return undefined;

  const contextLength = asNumber(raw.maxInputTokens) ?? 0;
  const maxOutputTokens = asNumber(raw.maxOutputTokens) ?? 0;
  if (contextLength <= 0 || maxOutputTokens <= 0) return undefined;

  const capabilities = parseWorkBuddyModelCapabilities(raw);
  return { ...capabilities, id, name: asString(raw.name) ?? id, contextLength, maxOutputTokens };
}

/**
 * Parse one catalogue entry, keeping it when the token limits are absent.
 *
 * Same field mapping and the same `disabled`/no-id drops as {@link parseWorkBuddyModel};
 * a missing (or non-positive) window leaves `contextLength`/`maxOutputTokens` at `0` so
 * the caller can decide whether to publish a window at all. Callers must NOT treat `0` as
 * a claim about the model — the discovery normalizer omits the fields entirely, which is
 * what falls back to the catalog's default window instead of writing `0`.
 */
export function parseWorkBuddyModelLoose(value: unknown): WorkBuddyModel | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as JsonRecord;
  const id = asString(raw.id);
  if (!id || raw.disabled === true) return undefined;

  const contextLength = Math.max(0, asNumber(raw.maxInputTokens) ?? 0);
  const maxOutputTokens = Math.max(0, asNumber(raw.maxOutputTokens) ?? 0);

  const capabilities = parseWorkBuddyModelCapabilities(raw);
  return { ...capabilities, id, name: asString(raw.name) ?? id, contextLength, maxOutputTokens };
}
