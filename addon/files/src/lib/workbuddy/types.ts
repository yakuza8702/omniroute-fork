/**
 * WorkBuddy addon — the edition table and the shared upstream contract.
 *
 * Upstream OmniRoute 3.8.53 already registers `workbuddy` as the **global** edition
 * (`open-sse/config/providers/registry/workbuddy/index.ts`,
 * `baseUrl: https://www.workbuddy.ai/v2/chat/completions`), and the data volume of every
 * deployed instance holds connection rows and synced-cache keys under exactly that id.
 * This addon therefore keeps ONE edition — the global one — and never remaps the id:
 *
 *   - `workbuddy` — 国际版, hosted on the WorkBuddy stack (`www.workbuddy.ai`, with
 *                   `www.codebuddy.ai` serving the same accounts signed in through the
 *                   CodeBuddy CLI).
 *
 * The domestic (国内版) product is a *different* gateway with a different account space
 * (`copilot.tencent.com` / `www.codebuddy.cn`) and its own daily check-in. It is
 * deliberately absent: adopting it needs a NEW provider id (`workbuddy-global` does not
 * exist upstream, and `workbuddy` is taken), which is a data-migration decision, not a
 * code change. See `addon/SOURCES.md` → DEFERRED.
 *
 * Endpoints, header names and payload shapes below are the ones the first-party clients
 * use. This module is pure data + pure functions except for {@link workBuddyAddonEnabled},
 * which reads `process.env` and is therefore server-only (clients gate on
 * {@link isWorkBuddyProviderId} instead).
 *
 * @module lib/workbuddy/types
 */

/** OmniRoute provider id of the WorkBuddy edition this addon serves (global). */
export const WORKBUDDY_PROVIDER_ID = "workbuddy";

/** Short alias the executor map and operator tooling use for the same provider. */
export const WORKBUDDY_PROVIDER_ALIAS = "wb";

/** Chat + billing gateway of the global edition (desktop sign-in). */
export const WORKBUDDY_CHAT_BASE = "https://www.workbuddy.ai";

/**
 * Second international brand domain. An account signed in through the CodeBuddy CLI
 * lives here, and its token is rejected by `www.workbuddy.ai` (and vice versa), so the
 * gateway must follow the credential's own domain instead of a fixed host.
 */
export const WORKBUDDY_ALT_BASE = "https://www.codebuddy.ai";

/** Chat path (identical on both brand domains). */
export const WORKBUDDY_CHAT_PATH = "/v2/chat/completions";

/**
 * Remote product-config path — the model directory.
 *
 * This is the document the WorkBuddy app itself consumes, so reading it is what keeps the
 * catalogue (and every credit rate in it) in agreement with the app. The roster it answers
 * depends on the user agent (client channel) — see
 * {@link WORKBUDDY_DESKTOP_USER_AGENT}.
 */
export const WORKBUDDY_CONFIG_PATH = "/v3/config";

/** Credit meter path (read-only: remaining credits per package). */
export const WORKBUDDY_CREDITS_PATH = "/v2/billing/meter/get-user-resource";

/** The product code the billing endpoint filters credit packages by. */
export const WORKBUDDY_CREDIT_PRODUCT_CODE = "p_tcaca";

/** User agent of the official client (CLI channel). */
export const WORKBUDDY_CLIENT_USER_AGENT = "CLI/2.63.2 CodeBuddy/2.63.2";

/**
 * User agent of the WorkBuddy desktop app.
 *
 * The product-config service serves a DIFFERENT document per client channel, selected by
 * this product token (the version suffix is ignored). On the global gateway that split
 * decides which models exist at all: the CLI channel omits free chat models that the
 * desktop channel lists, so the catalogue is read as the desktop app. Single static value
 * is correct because this addon serves exactly one edition — a second edition would force
 * a per-connection resolver.
 */
export const WORKBUDDY_DESKTOP_USER_AGENT = "WorkBuddy/5.5.2";

/** Network ceiling for metadata calls (the chat path is not bounded here). */
export const WORKBUDDY_JSON_TIMEOUT_MS = 30_000;

/** Region of the served edition. Kept as a type so a future CN edition is a compile error. */
export type WorkBuddyRegion = "global";

/** Reasoning metadata declared per model by the upstream catalogue. */
export interface WorkBuddyModelReasoning {
  supportedEfforts?: string[];
  defaultEffort?: string;
  canDisableThinking?: boolean;
}

/**
 * Credential read back out of a stored connection.
 *
 * A WorkBuddy login is an ordinary platform connection: `accessToken`/`refreshToken` plus
 * the account identity in `providerSpecificData` (see {@link WORKBUDDY_CONNECTION_KEYS}).
 * The identity is NOT decoration — the gateway needs `X-Domain`/`X-User-Id` on the wire,
 * and those are per-connection, so a static header table could not carry them.
 *
 * The token never leaves the server: no route returns this object, only its non-secret
 * fields (label, masked account, connected bit).
 */
export interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  /** Login domain (`www.workbuddy.ai` / `www.codebuddy.ai`); picks the brand gateway. */
  domain: string;
  uid?: string;
  enterpriseId?: string;
  /** Display name of the account, never a secret. */
  nickname?: string;
  /** Where the credential came from. This port only reads platform connections. */
  source?: "connection";
}

/** One credit package as the billing endpoint reports it. */
export interface WorkBuddyCreditPackage {
  packageName: string;
  /** Remaining credits, clamped at 0. */
  remain: number;
  size: number;
  /** Refill package (recurring cycle) vs one-off bonus package. */
  monthly: boolean;
  /** Next cycle refresh (refill packages only). */
  refreshAtMs?: number;
  /** Hard expiry (one-off packages; falls back to the cycle end). */
  expiresAtMs?: number;
}

/** Credit overview for one credential. */
export interface WorkBuddyCredits {
  total: number;
  packages: WorkBuddyCreditPackage[];
  /** Credits expiring within 72h — the ones worth spending first. */
  expiringSoon: number;
  /** Nearest expiry across all packages. */
  nearestExpiryMs?: number;
}

/**
 * Keys this addon owns inside a connection's `providerSpecificData`.
 *
 * Declared here (and not next to the DB helpers) because both the routes and any future
 * executor read the account identity from these names: a rename that reached only one side
 * would send requests with no `X-Domain`/`X-User-Id`, which this gateway answers with an
 * HTML 401 rather than a helpful error.
 */
export const WORKBUDDY_CONNECTION_KEYS = {
  domain: "workbuddyDomain",
  uid: "workbuddyUid",
  enterpriseId: "workbuddyEnterpriseId",
  region: "workbuddyRegion",
  source: "workbuddySource",
  sourceFilePath: "workbuddySourceFilePath",
  accountLabel: "workbuddyAccountLabel",
  expiresAtMs: "workbuddyExpiresAtMs",
} as const;

/** One entry of the upstream model directory. */
export interface WorkBuddyModel {
  id: string;
  name: string;
  /** Upstream `maxInputTokens`; `0` when the upstream declared none (loose parse). */
  contextLength: number;
  /** Upstream `maxOutputTokens`; `0` when the upstream declared none (loose parse). */
  maxOutputTokens: number;
  /**
   * Credit rate of the model, parsed from the upstream `credits` string
   * (`"x0.79 credits"` → 0.79). `0` is the upstream's own "free" rate. `undefined` means
   * the upstream did not declare one — never a guessed value.
   */
  creditMultiplier?: number;
  supportsVision?: boolean;
  supportsToolCall?: boolean;
  reasoning?: WorkBuddyModelReasoning;
  descriptionZh?: string;
  descriptionEn?: string;
}

/** Static description of the served edition: ids, hosts and the flags callers branch on. */
export interface WorkBuddyEdition {
  /** OmniRoute provider id (`workbuddy`). */
  providerId: string;
  region: WorkBuddyRegion;
  /** Chat + billing gateway. */
  chatBase: string;
  /** Model-directory path (the `/v3/config` document). */
  configPath: string;
  /** User agent the model directory is read with (channel selector). */
  catalogUserAgent: string;
  /** Whether this edition exposes a daily check-in (the global one does not). */
  supportsCheckin: boolean;
}

/** The served edition. Index 0 is also the only element — see the module header. */
export const WORKBUDDY_EDITIONS = [
  {
    providerId: WORKBUDDY_PROVIDER_ID,
    region: "global",
    chatBase: WORKBUDDY_CHAT_BASE,
    configPath: WORKBUDDY_CONFIG_PATH,
    catalogUserAgent: WORKBUDDY_DESKTOP_USER_AGENT,
    supportsCheckin: false,
  },
] as const satisfies readonly WorkBuddyEdition[];

/** The edition this addon serves. */
export const WORKBUDDY_EDITION: WorkBuddyEdition = WORKBUDDY_EDITIONS[0];

/**
 * Edition descriptor for a provider id or alias, or `null` when the id is another provider.
 *
 * Aliases are accepted because the executor map registers both spellings and a resolver
 * that recognised only the canonical id would answer "not the addon's provider" for a
 * request that plainly is.
 */
export function resolveWorkBuddyEdition(
  providerId: string | undefined | null
): WorkBuddyEdition | null {
  const key = (providerId ?? "").trim().toLowerCase();
  if (!key) return null;
  return key === WORKBUDDY_PROVIDER_ID || key === WORKBUDDY_PROVIDER_ALIAS
    ? WORKBUDDY_EDITION
    : null;
}

/**
 * Whether a provider id belongs to this addon. Client-safe (no `process.env`, no DB), so
 * `"use client"` components gate on this instead of on {@link workBuddyAddonEnabled}.
 */
export function isWorkBuddyProviderId(providerId: unknown): boolean {
  return resolveWorkBuddyEdition(typeof providerId === "string" ? providerId : null) !== null;
}

/**
 * D9 — one env switch for the whole addon; unset/empty ⇒ enabled. Evaluated per call.
 *
 * Server-only: reads `process.env`, so never import it from a `"use client"` module.
 */
export function workBuddyAddonEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test((process.env.WORKBUDDY_ADDON ?? "1").trim());
}

/**
 * Gateway for an international credential.
 *
 * Both brand domains serve the same international stack, but a token minted at one is
 * rejected at the other, so the base follows the credential's own domain. Anything
 * unrecognised falls back to the desktop app's gateway. There is no domestic branch in this
 * addon (single edition, plan §D1): every credential it reads is global.
 */
export function resolveWorkBuddyGlobalBase(domain: string | undefined | null): string {
  const lowered = (domain ?? "").trim().toLowerCase();
  if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) {
    return WORKBUDDY_ALT_BASE;
  }
  return WORKBUDDY_CHAT_BASE;
}

/** Chat gateway for a credential (the billing host is the same origin upstream). */
export function workBuddyChatBase(domain: string | undefined | null): string {
  return resolveWorkBuddyGlobalBase(domain);
}

/** Billing/credit gateway for a credential. */
export function workBuddyBillingBase(domain: string | undefined | null): string {
  return resolveWorkBuddyGlobalBase(domain);
}
