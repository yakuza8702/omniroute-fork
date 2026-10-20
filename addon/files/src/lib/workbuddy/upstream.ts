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
 * The second half of the file is the **reasoning contract**: what a target model declares
 * about thinking, and how a chat body is brought inside that declaration. It is pure on
 * purpose — the caller resolves the declaration (a synced catalogue row, a persisted
 * operator override; see `open-sse/executors/workbuddyReasoning.ts`) and hands it in, so the
 * strip-vs-clamp rule stays testable without a database.
 *
 * Pure functions only: no I/O, no env, no DB — importable from a route, an executor or a
 * unit test.
 *
 * @module lib/workbuddy/upstream
 */

import type { WorkBuddyModel, WorkBuddyModelReasoning } from "./types";

type JsonRecord = Record<string, unknown>;

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

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning contract (plan §4 B3) — port of `fork src/lib/workbuddy/upstream.ts:890-1058`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Effort ladder both gateways speak, lowest → highest.
 *
 * `none` is the only word that means "do not think"; the gateway's own catalogues spell
 * the ladder as a subset of this list, which is why clamping is rank arithmetic over it
 * rather than string equality.
 */
export const WORKBUDDY_THINKING_LADDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type WorkBuddyEffortLevel = (typeof WORKBUDDY_THINKING_LADDER)[number];

/**
 * What a target model declares about thinking, as resolved for one request.
 *
 * `supportedEfforts` comes from the model's own catalogue row (synced discovery data) or
 * from a persisted operator override; when it is absent the model declares nothing, and
 * {@link normalizeWorkBuddyReasoning} strips every reasoning field rather than guessing a
 * level the gateway may reject.
 */
export interface WorkBuddyReasoningContract {
  /** Levels the model itself declares. Empty/absent means "declares no ladder". */
  supportedEfforts?: readonly string[];
  /** Whether the model accepts a "stop thinking" request (`none`). Derived from the
   * ladder when the source does not say. */
  canDisableThinking?: boolean;
  /** Models known to reject the "off" spelling even when `none` is in the ladder. */
  refusesOff?: boolean;
}

/** Canonical spelling of one effort word, or `undefined` for an unknown token. */
function canonicalEffortWord(value: unknown): WorkBuddyEffortLevel | undefined {
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  if (word === "") return undefined;
  if (word === "none" || word === "off" || word === "disabled" || word === "false") {
    return "none";
  }
  if (word === "ultra" || word === "maximum") return "max";
  if (word === "minimum") return "minimal";
  return (WORKBUDDY_THINKING_LADDER as readonly string[]).includes(word)
    ? (word as WorkBuddyEffortLevel)
    : undefined;
}

/** The declared ladder, canonicalized and ordered low → high. Empty = declares nothing. */
function declaredEffortLadder(
  contract: WorkBuddyReasoningContract | null | undefined
): WorkBuddyEffortLevel[] {
  const declared = contract?.supportedEfforts;
  if (!Array.isArray(declared)) return [];
  const levels = new Set<WorkBuddyEffortLevel>();
  for (const entry of declared) {
    const level = canonicalEffortWord(entry);
    if (level) levels.add(level);
  }
  return WORKBUDDY_THINKING_LADDER.filter((level) => levels.has(level));
}

/**
 * What the caller asked for, in ladder terms.
 *
 *  - `off`   — an explicit "do not think" (`reasoning_effort: "none"`, `thinking:false`,
 *              `thinking:{type:"disabled"}`).
 *  - `level` — an explicit tier.
 *  - `any`   — a request that names no tier (`thinking:{type:"enabled"}`): it says
 *              "think", not "think this hard", so no level is invented for it.
 */
type RequestedThinking =
  | { kind: "absent" }
  | { kind: "off" }
  | { kind: "any" }
  | {
      kind: "level";
      level: WorkBuddyEffortLevel;
    };

function requestedThinking(body: JsonRecord): RequestedThinking {
  const effort = body.reasoning_effort;
  if (typeof effort === "string" && effort.trim() !== "") {
    const level = canonicalEffortWord(effort);
    // An unrecognised word is not a level: treat it as "asked for something this gateway
    // has no name for" and drop the field entirely (clamping it would answer a request
    // the caller never made).
    if (level === "none") return { kind: "off" };
    return level ? { kind: "level", level } : { kind: "absent" };
  }

  const thinking = body.thinking;
  if (thinking === false) return { kind: "off" };
  if (typeof thinking === "string") {
    const level = canonicalEffortWord(thinking);
    if (level === "none") return { kind: "off" };
    return level ? { kind: "level", level } : { kind: "absent" };
  }
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
    const type = (thinking as JsonRecord).type;
    const word = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (word === "disabled" || word === "") {
      return word === "disabled" ? { kind: "off" } : { kind: "absent" };
    }
    return { kind: "any" };
  }
  return { kind: "absent" };
}

/**
 * Clamp a requested tier into the ladder the model declares.
 *
 * Floor semantics (the convention the rest of the platform uses): move UP to the nearest
 * declared level, and fall back to the highest declared one when the request is above the
 * ladder's ceiling. `off` is handled by the caller because it depends on
 * `canDisableThinking`.
 */
function clampToLadder(
  requested: WorkBuddyEffortLevel,
  ladder: readonly WorkBuddyEffortLevel[]
): WorkBuddyEffortLevel {
  const rank = WORKBUDDY_THINKING_LADDER.indexOf(requested);
  for (const level of ladder) {
    if (WORKBUDDY_THINKING_LADDER.indexOf(level) >= rank) return level;
  }
  return ladder[ladder.length - 1];
}

/**
 * Apply the reasoning contract to a chat body, on a copy.
 *
 * Two failures this prevents, both 400s from the gateway:
 *  - a model that declares no effort ladder receives `reasoning_effort`/`thinking` it does
 *    not know → every reasoning field is DELETED;
 *  - a model that declares a ladder receives a tier outside it (a client asking `max` of a
 *    `low..high` model) → the request is clamped into the declared set.
 *
 * An explicit "off" becomes `none` only when the model declares that level AND does not
 * refuse it; otherwise it degrades to the ladder's floor, because this gateway has no
 * other way to spell "stop thinking". `thinking` is never forwarded: the OpenAI-format
 * gateway has no such field, so the equivalent travels as `reasoning_effort`.
 */
export function normalizeWorkBuddyReasoning(
  out: JsonRecord,
  contract?: WorkBuddyReasoningContract | null
): JsonRecord {
  const ladder = declaredEffortLadder(contract);
  const requested = requestedThinking(out);
  const { reasoning_effort: _rawEffort, thinking: _rawThinking, ...rest } = out;

  if (ladder.length === 0) return rest;
  if (requested.kind === "absent" || requested.kind === "any") return rest;

  if (requested.kind === "off") {
    const canDisable = contract?.canDisableThinking ?? ladder.includes("none");
    const refusesOff = contract?.refusesOff === true;
    if (ladder.includes("none") && canDisable && !refusesOff) {
      return { ...rest, reasoning_effort: "none" };
    }
    // "off" unavailable: degrade to the ladder's own floor, never to `none` (that would
    // be the answer the model just refused).
    const withoutOff = ladder.filter((level) => level !== "none");
    const floor = withoutOff.length > 0 ? withoutOff : ladder;
    return { ...rest, reasoning_effort: floor[0] };
  }

  return { ...rest, reasoning_effort: clampToLadder(requested.level, ladder) };
}
