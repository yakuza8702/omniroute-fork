/**
 * WorkBuddy addon — self-description.
 *
 * The addon answers "how do you work?" as data, not as a doc link: every capability the
 * dashboard can offer, the endpoint behind it and the rules it holds itself to are
 * described here and served by `GET /api/workbuddy/info`. A UI that reads this can render
 * the feature set (and explain an unavailable action) without hardcoding a second copy of
 * the truth that drifts from the code.
 *
 * Scope: this is the MINIMAL description of the single-edition port — catalogue, credit
 * reading and the catalog surface. The domestic edition, the desktop account scan and the
 * daily check-in are not described because they are not shipped (see `addon/SOURCES.md` →
 * DEFERRED), and advertising a capability the addon refuses to perform would be worse than
 * saying nothing.
 *
 * @module lib/workbuddy/addonInfo
 */

import {
  WORKBUDDY_CHAT_PATH,
  WORKBUDDY_CONFIG_PATH,
  WORKBUDDY_CREDITS_PATH,
  WORKBUDDY_EDITION,
  WORKBUDDY_EDITIONS,
  WORKBUDDY_PROVIDER_ID,
} from "./types";

/** One capability the addon exposes, with the endpoint behind it. */
export interface WorkBuddyAddonCapability {
  id: string;
  name: string;
  description: string;
  /** HTTP method + path, when the capability is backed by an upstream call. */
  upstream?: string[];
  /** Addon route that exposes it. */
  route?: string;
  /** True when the action changes upstream state. */
  mutates: boolean;
}

/** Full description of the addon. */
export interface WorkBuddyAddonInfo {
  id: string;
  name: string;
  version: string;
  summary: string;
  /** The narrative "how it works", in order. */
  howItWorks: string[];
  providers: Array<{
    providerId: string;
    region: string;
    chatBase: string;
    modelDirectory: string;
    catalogUserAgent: string;
    supportsCheckin: boolean;
  }>;
  capabilities: WorkBuddyAddonCapability[];
  /** Rules the addon holds itself to; a UI can render these as the safety contract. */
  guarantees: string[];
  /** Things the addon deliberately does NOT do, so absence is not read as a bug. */
  nonGoals: string[];
}

/** Version of this addon's contract; bump when the shape of this payload changes. */
export const WORKBUDDY_ADDON_CONTRACT_VERSION = "1.0.0";

/**
 * Describe the addon.
 *
 * Kept as one function (rather than a static JSON import) so the edition table it
 * publishes is the same constant the request path uses — an endpoint renamed in `types.ts`
 * cannot leave this description advertising the old one.
 */
export function describeWorkBuddyAddon(): WorkBuddyAddonInfo {
  return {
    id: "workbuddy-addon",
    name: "WorkBuddy addon",
    version: WORKBUDDY_ADDON_CONTRACT_VERSION,
    summary:
      "Serves the WorkBuddy global edition as an ordinary provider — model catalogue with " +
      "real token windows and declared credit rates, chat routing, and a read-only credit " +
      "surface.",
    howItWorks: [
      "The provider itself is upstream's: `workbuddy` is already registered, with the device-code OAuth flow this addon relies on. Nothing here remaps the id.",
      "The model catalogue is read from /v3/config — the document the WorkBuddy app itself consumes — with the desktop channel's user agent, because the CLI channel omits the free x0.00 tier.",
      "The catalogue read is enriched, not replaced: each entry's context window, output ceiling, vision/tool flags, reasoning ladder and declared credit rate are forwarded into the discovery normalizer, so the dashboard stops falling back to a 200k window it never measured.",
      "Credits are the declared rate of each model (`credits: \"x0.03 credits\"` → 0.03, `x0.00` → free). A missing rate is never guessed at, and a rate is never confused with a free verdict.",
      "Credit balances are read from the billing endpoint, read-only, and cost nothing.",
    ],
    providers: WORKBUDDY_EDITIONS.map((edition) => ({
      providerId: edition.providerId,
      region: edition.region,
      chatBase: edition.chatBase,
      modelDirectory: edition.configPath,
      catalogUserAgent: edition.catalogUserAgent,
      supportsCheckin: edition.supportsCheckin,
    })),
    capabilities: [
      {
        id: "models",
        name: "Model catalogue",
        description:
          "Fetch the account's real model list from /v3/config, including each model's context window, output ceiling, vision/tool support, reasoning ladder and credit rate.",
        upstream: [`GET ${WORKBUDDY_EDITION.chatBase}${WORKBUDDY_CONFIG_PATH}`],
        route: "GET /api/workbuddy/models",
        mutates: false,
      },
      {
        id: "credits",
        name: "Credit balance",
        description:
          "Remaining credits per package, keeping recurring packages and one-off packages separate, plus the nearest expiry and how much is about to expire.",
        upstream: [`POST ${WORKBUDDY_EDITION.chatBase}${WORKBUDDY_CREDITS_PATH}`],
        route: "GET /api/workbuddy/credits",
        mutates: false,
      },
      {
        id: "chat",
        name: "Chat routing",
        description:
          "Route completions through the registered provider, with token refresh handled by the platform when the session expires.",
        upstream: [`POST ${WORKBUDDY_EDITION.chatBase}${WORKBUDDY_CHAT_PATH}`],
        mutates: false,
      },
      {
        id: "info",
        name: "How the addon works",
        description: "This description, served as data so a UI never has to hardcode it.",
        route: "GET /api/workbuddy/info",
        mutates: false,
      },
    ],
    guarantees: [
      "Access tokens never reach the browser: the addon's routes run server-side against the stored connection.",
      "Credit queries are read-only and cost nothing.",
      "A rate the upstream did not declare stays absent — the badge is hidden rather than showing a fabricated 1.00x.",
      "The provider id stays `workbuddy`, so existing connections and synced-cache rows keep working.",
    ],
    nonGoals: [
      "The domestic (国内版) edition and its `workbuddy-global` id — see DEFERRED in addon/SOURCES.md.",
      "The desktop app's auth-file scan, account import and daily check-in.",
      "Inventing a credit rate, reset time or model window the upstream did not report.",
    ],
  };
}

/** Provider ids this addon registers, exported for manifests and tests. */
export const WORKBUDDY_ADDON_PROVIDER_IDS = {
  global: WORKBUDDY_PROVIDER_ID,
} as const;

/** Hosts the addon talks to; used by diagnostics and by the info route. */
export const WORKBUDDY_ADDON_HOSTS = {
  chat: WORKBUDDY_EDITION.chatBase,
  catalogUserAgent: WORKBUDDY_EDITION.catalogUserAgent,
  desktopUserAgent: WORKBUDDY_EDITION.catalogUserAgent,
} as const;
