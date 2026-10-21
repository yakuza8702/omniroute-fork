/**
 * 0005 — the opencode free lane, at the pure-decision level.
 *
 * Two behaviours the source port restores from the shipped 3.8.52 image, both measured on the
 * running 3.8.53-wb image:
 *
 *  1. a KNOWN-FREE id (`-free` suffix, or one of the registry's legacy free ids) is free even
 *     when the synced catalog omits it. The catalog is written by discovery, so an import from
 *     `GET /models` leaves it without the free flag; a catalog-first answer then sends
 *     `big-pickle` down the keyed lane, where the upstream answers 403 and the gateway reports
 *     "model not found";
 *  2. on a gated Zen free request, a configured `OPENCODE_ANONYMOUS_KEY` replaces the
 *     connection's key — the tier authenticates anonymously — while paid models and the
 *     `/zen/go` surface keep the connection key.
 *
 * The catalog is pinned through `_setOpencodeFreeModelsForTests` (the seam discovery already
 * uses); `null` restores the deployment-derived lookup.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { OpencodeExecutor } from "../../open-sse/executors/opencode.ts";
import {
  _setOpencodeFreeModelsForTests,
  isGatedFreeTierRequest,
  isPremiumOpencodeModel,
} from "../../open-sse/executors/opencodeFreeTierContract.ts";
import type { ProviderCredentials } from "../../open-sse/types.d.ts";

const KEYS_WITHOUT_SUFFIX = [
  "big-pickle",
  "deepseek-v4.1-flash-free",
  "mimo-v2.5-free",
  "hy3-free",
  "nemotron-3-ultra-free",
  "north-mini-code-free",
] as const;

function credentials(apiKey: string): ProviderCredentials {
  return { apiKey, accessToken: "access-token", connectionId: "conn-free-lane" };
}

describe("isPremiumOpencodeModel — known-free ids beat the synced catalog", () => {
  afterEach(() => _setOpencodeFreeModelsForTests(null));

  it("keeps a `-free` suffix free when the catalog lists unrelated ids only", () => {
    _setOpencodeFreeModelsForTests(["gpt-5", "glm-5.2"]);
    assert.equal(isPremiumOpencodeModel("north-mini-code-free", "opencode"), false);
    assert.equal(isPremiumOpencodeModel("north-mini-code-free", "opencode-zen"), false);
    // A rotating id the snapshot cannot possibly have listed.
    assert.equal(isPremiumOpencodeModel("some-new-model-free", "opencode-zen"), false);
  });

  it("keeps the legacy free ids free without a suffix (the big-pickle regression)", () => {
    _setOpencodeFreeModelsForTests(["gpt-5"]);
    for (const id of KEYS_WITHOUT_SUFFIX) {
      assert.equal(isPremiumOpencodeModel(id, "opencode-zen"), false, id);
      assert.equal(isPremiumOpencodeModel(id, "opencode"), false, id);
    }
  });

  it("still lets the catalog decide for ids that make no free claim", () => {
    _setOpencodeFreeModelsForTests(["catalog-free-id"]);
    assert.equal(isPremiumOpencodeModel("catalog-free-id", "opencode-zen"), false);
    assert.equal(isPremiumOpencodeModel("unlisted-catalog-id", "opencode-zen"), true);
  });

  it("assumes an unknown id premium when no catalog is synced", () => {
    _setOpencodeFreeModelsForTests(null);
    assert.equal(isPremiumOpencodeModel("totally-unknown-model", "opencode"), true);
    // The known-free rule does not depend on a catalog at all.
    assert.equal(isPremiumOpencodeModel("big-pickle", "opencode"), false);
  });

  it("trims the id before matching", () => {
    _setOpencodeFreeModelsForTests([]);
    assert.equal(isPremiumOpencodeModel("  big-pickle  ", "opencode"), false);
    assert.equal(isPremiumOpencodeModel("  some-model-free  ", "opencode-zen"), false);
  });

  it("keeps opencode-go fully keyed, free ids included", () => {
    _setOpencodeFreeModelsForTests([]);
    for (const id of ["big-pickle", "some-model-free", "gpt-5"]) {
      assert.equal(isPremiumOpencodeModel(id, "opencode-go"), true, id);
    }
  });

  it("the request gate follows the same verdict", () => {
    _setOpencodeFreeModelsForTests([]);
    assert.equal(isGatedFreeTierRequest("zen", "opencode", "big-pickle"), true);
    assert.equal(isGatedFreeTierRequest("zen", "opencode", "some-model-free"), true);
    assert.equal(isGatedFreeTierRequest("zen", "opencode", "gpt-5"), false);
    assert.equal(isGatedFreeTierRequest("go", "opencode", "big-pickle"), false);
  });
});

describe("buildHeaders — the anonymous key on the gated free lane", () => {
  const ENV_KEY = "OPENCODE_ANONYMOUS_KEY";
  const saved = process.env[ENV_KEY];

  afterEach(() => {
    _setOpencodeFreeModelsForTests(null);
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("replaces the connection key on a gated free request", () => {
    process.env[ENV_KEY] = "public";
    _setOpencodeFreeModelsForTests([]);
    const headers = new OpencodeExecutor("opencode-zen").buildHeaders(
      credentials("connection-key"),
      true,
      null,
      "big-pickle"
    );
    assert.equal(headers["Authorization"], "Bearer public");
  });

  it("keeps the connection key on a paid model", () => {
    process.env[ENV_KEY] = "public";
    _setOpencodeFreeModelsForTests([]);
    const headers = new OpencodeExecutor("opencode-zen").buildHeaders(
      credentials("connection-key"),
      true,
      null,
      "gpt-5"
    );
    assert.equal(headers["Authorization"], "Bearer connection-key");
  });

  it("keeps the connection key on the go surface", () => {
    process.env[ENV_KEY] = "public";
    _setOpencodeFreeModelsForTests([]);
    const headers = new OpencodeExecutor("opencode-go").buildHeaders(
      credentials("connection-key"),
      true,
      null,
      "big-pickle"
    );
    assert.equal(headers["Authorization"], "Bearer connection-key");
  });

  it("treats a blank env value as unset", () => {
    process.env[ENV_KEY] = "   ";
    _setOpencodeFreeModelsForTests([]);
    const headers = new OpencodeExecutor("opencode-zen").buildHeaders(
      credentials("connection-key"),
      true,
      null,
      "big-pickle"
    );
    assert.equal(headers["Authorization"], "Bearer connection-key");
  });

  it("sends no Authorization at all without a credential or an env key", () => {
    delete process.env[ENV_KEY];
    _setOpencodeFreeModelsForTests([]);
    const headers = new OpencodeExecutor("opencode-zen").buildHeaders(
      null,
      true,
      null,
      "big-pickle"
    );
    assert.equal(headers["Authorization"], undefined);
    assert.equal(headers["x-api-key"], undefined);
  });

  it("uses x-api-key on the zen responses surface", () => {
    process.env[ENV_KEY] = "public";
    _setOpencodeFreeModelsForTests([]);
    const executor = new OpencodeExecutor("opencode-zen");
    executor._requestFormat = "openai-responses";
    const headers = executor.buildHeaders(credentials("connection-key"), true, null, "big-pickle");
    assert.equal(headers["x-api-key"], "public");
    assert.equal(headers["Authorization"], undefined);
  });
});
