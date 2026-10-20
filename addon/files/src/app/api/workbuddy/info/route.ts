/**
 * GET /api/workbuddy/info — how this addon works, as data.
 *
 * Serves the description from `src/lib/workbuddy/addonInfo.ts` plus a cheap, network-free
 * status: whether a connection exists for the served edition. Nothing here calls the upstream,
 * so a settings page can render the whole feature set (and explain a disabled action) on load
 * without spending a credit query or tripping a rate limit.
 *
 * Ported from `fork src/app/api/workbuddy/info/route.ts:1-55`, single edition and without the
 * deferred routes (accounts/import/checkin, plan §12).
 */

import { NextResponse } from "next/server";
import { guardWorkBuddyRequest, workBuddyError } from "../_lib";
import { describeWorkBuddyAddon } from "@/lib/workbuddy/addonInfo";
import { listWorkBuddyConnections } from "@/lib/workbuddy/accounts";
import { WORKBUDDY_EDITIONS } from "@/lib/workbuddy/types";

export async function GET(request: Request): Promise<Response> {
  const denied = await guardWorkBuddyRequest(request);
  if (denied) return denied;

  try {
    const editions = await Promise.all(
      WORKBUDDY_EDITIONS.map(async (edition) => {
        const rows = await listWorkBuddyConnections(edition.providerId);
        return {
          provider: edition.providerId,
          region: edition.region,
          connected: rows.length > 0,
          connections: rows.length,
          supportsCheckin: edition.supportsCheckin,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      ...describeWorkBuddyAddon(),
      status: {
        editions,
        routes: {
          info: "GET /api/workbuddy/info",
          models: "GET /api/workbuddy/models",
          credits: "GET /api/workbuddy/credits",
          freeModel: "GET /api/workbuddy/free-model",
        },
        // Authentication is the platform's management gate, not a loopback assumption: these
        // routes are served on the same origin as the rest of the management API.
        auth: "management",
      },
    });
  } catch (error) {
    return workBuddyError(error);
  }
}
