"use client";

/**
 * useModelContextOverrides — read/save the manual context-window override of one provider.
 *
 * `PUT /api/provider-models` has always accepted `contextWindowOverride` for rows that have no
 * custom-model entry (the `compatOnly` branch), but only `CompatibleModelsSection` ever read the
 * value back (#14337). Feature D (plan §6) needs the same read in the PASSTHROUGH section, so the
 * fetch/parse half is lifted here instead of copied into a second component:
 *
 *   - `overrides` — `modelId -> contextWindowOverride` for every row of the provider;
 *   - `save(modelId, value)` — number sets, `null` clears, `NaN` is rejected as invalid input
 *     (the row signals invalid text that way rather than guessing a number);
 *   - `reload()` — re-read after a write, so the badge always shows what the server stored.
 *
 * The hook does not render messages: each caller already has its own translator and notification
 * store, and it passes the returned error into them.
 *
 * Kept out of `providerPageHelpers` on purpose: that module is imported by server-rendered
 * helpers too, and a React hook has no business there. `CompatibleModelsSection` keeps its own
 * in-component copy for now — rewriting a stable component is not part of this wave — the two
 * differ only in where the notification is raised.
 *
 * @module hooks/useModelContextOverrides
 */

import { useCallback, useEffect, useState } from "react";
import { formatProviderModelsErrorResponse } from "../providerPageHelpers";

/** Read `<provider>`'s context overrides, or `null` when the read itself failed. */
export async function fetchProviderContextOverrides(
  providerId: string
): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`/api/provider-models?provider=${encodeURIComponent(providerId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const rows = Array.isArray(data?.modelContextOverrides) ? data.modelContextOverrides : [];
    const next: Record<string, number> = {};
    for (const row of rows) {
      const id = typeof row?.modelId === "string" ? row.modelId : null;
      const value = row?.contextWindowOverride;
      if (id && typeof value === "number") next[id] = value;
    }
    return next;
  } catch {
    // A failed read leaves the badges absent; editing still works.
    return null;
  }
}

export interface SaveContextOverrideResult {
  ok: boolean;
  /** Sanitized server message when the write failed. */
  error?: string;
  /** True when the value was rejected locally (not a number). */
  invalid?: boolean;
}

export function useModelContextOverrides(providerId: string) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [savingModelId, setSavingModelId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchProviderContextOverrides(providerId);
    if (next) setOverrides(next);
  }, [providerId]);

  useEffect(() => {
    const run = async () => {
      const next = await fetchProviderContextOverrides(providerId);
      if (next) setOverrides(next);
    };
    void run();
  }, [providerId]);

  const save = useCallback(
    async (modelId: string, value: number | null): Promise<SaveContextOverrideResult> => {
      // The row signals invalid input as NaN rather than guessing a value.
      if (typeof value === "number" && Number.isNaN(value)) {
        return { ok: false, invalid: true };
      }
      setSavingModelId(modelId);
      try {
        const res = await fetch("/api/provider-models", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: providerId,
            modelId,
            // #4125 semantics, unchanged: a number sets the override, null clears it and the
            // model falls back to the discovered/catalog value.
            contextWindowOverride: value,
          }),
        });
        if (!res.ok) {
          return { ok: false, error: await formatProviderModelsErrorResponse(res) };
        }
        await reload();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : undefined };
      } finally {
        setSavingModelId(null);
      }
    },
    [providerId, reload]
  );

  return { overrides, savingModelId, reload, save };
}
