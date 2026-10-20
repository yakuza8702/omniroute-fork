"use client";

/**
 * WorkBuddyReasoningEffortEditor — per-model reasoning-effort override (plan §6, Feature D).
 *
 * The persisted override is authoritative for BOTH the catalogue and the wire: the executor's
 * contract resolver consults it before the synced row (`0002`, B2/D6), so what is selected here
 * is what a request is actually clamped to. That is why the editor re-reads the saved value
 * instead of keeping a client-only selection, and why it only offers the vocabulary both sides
 * speak (`WORKBUDDY_EFFORT_OVERRIDE_VALUES` — see `shared/utils/workBuddyEfforts.ts`).
 *
 * The persistence lives in the SECTION, not here: one `GET /api/model-capability-overrides` loads
 * every override for the provider page, and the row's save/clear callbacks write through
 * `PATCH`/`DELETE /api/model-capability-overrides`. This component only owns the draft.
 */

import { useState } from "react";
import {
  WORKBUDDY_EFFORT_OVERRIDE_VALUES,
  formatWorkBuddyEfforts,
  serializeWorkBuddyEfforts,
  toggleWorkBuddyEffort,
  type WorkBuddyEffortOverrideValue,
} from "@/shared/utils/workBuddyEfforts";

export interface WorkBuddyReasoningEffortEditorProps {
  modelId: string;
  /** Saved override for this model, in ladder order. Empty means "no override". */
  selected: readonly string[];
  /** A save/clear for this model is in flight. */
  saving?: boolean;
  /** Hide the affordance (e.g. a provider that cannot take overrides). */
  disabled?: boolean;
  onSave: (modelId: string, efforts: string[]) => Promise<void> | void;
  onClear: (modelId: string) => Promise<void> | void;
}

export function WorkBuddyReasoningEffortEditor({
  modelId,
  selected,
  saving = false,
  disabled = false,
  onSave,
  onClear,
}: WorkBuddyReasoningEffortEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorkBuddyEffortOverrideValue[]>([]);

  // The draft is seeded when the editor OPENS, not by an effect: the saved value is the source
  // of truth between edits, so a sync-on-render would fight the user's clicks (and a
  // setState-in-effect is exactly the cascading render the lint rule rejects).
  const seedDraftFromSaved = () => {
    setDraft(
      selected.filter((value): value is WorkBuddyEffortOverrideValue =>
        (WORKBUDDY_EFFORT_OVERRIDE_VALUES as readonly string[]).includes(value)
      )
    );
  };

  const toggleOpen = () => {
    if (!open) seedDraftFromSaved();
    setOpen((value) => !value);
  };

  const caption = formatWorkBuddyEfforts(selected) ?? "auto";

  const submit = async () => {
    await onSave(modelId, draft);
    setOpen(false);
  };

  const clear = async () => {
    await onClear(modelId);
    setOpen(false);
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:border-primary/40 hover:text-primary disabled:opacity-40"
        title="Reasoning-effort override — persisted, and enforced by the executor"
        aria-label="Edit reasoning-effort override"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[13px]">tune</span>
        <span>effort: {caption}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-background p-2 shadow-lg">
          <p className="mb-1.5 text-[10px] leading-4 text-text-muted">
            Limits the efforts this model advertises and accepts. Empty means “no override”.
          </p>
          <div className="flex flex-wrap gap-1">
            {WORKBUDDY_EFFORT_OVERRIDE_VALUES.map((effort) => {
              const active = draft.includes(effort);
              return (
                <button
                  key={effort}
                  type="button"
                  onClick={() => setDraft((current) => toggleWorkBuddyEffort(current, effort))}
                  disabled={saving}
                  className={`rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-muted hover:border-primary/40"
                  }`}
                >
                  {effort}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => void clear()}
              disabled={saving}
              className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-sidebar disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={
                saving || serializeWorkBuddyEfforts(draft) === serializeWorkBuddyEfforts(selected)
              }
              className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export default WorkBuddyReasoningEffortEditor;
