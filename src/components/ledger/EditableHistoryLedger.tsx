"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState, type InputHTMLAttributes } from "react";
import { LedgerEventList } from "@/components/ledger/LedgerEventList";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  hardDeleteBehaviorEvent,
  updateBehaviorEvent,
} from "@/lib/behaviors";
import { WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK } from "@/lib/economy";
import type { ActivityItem } from "@/lib/history";
import type { BehaviorType, LedgerEvent } from "@/lib/types";
import {
  fetchAttributionSelectionsForWorkBlock,
  getManualWorkDefaultsFromLedgerEvent,
  getRewardSpendDefaultsFromLedgerEvent,
  hardDeleteLedgerEvent,
  isDeletableLedgerEvent,
  isEditableLedgerEvent,
  updateManualWorkEntry,
  updateRewardSpendEntry,
} from "@/lib/workspace";

type AttributionSelection = {
  label: string;
  taskId: string;
};

type EditableHistoryLedgerProps = {
  emptyMessage: string;
  items: ActivityItem[];
  onDeleted: (item: ActivityItem) => void;
  onUpdated: (item: ActivityItem) => void;
  supabase: SupabaseClient;
  userId: string;
};

type FieldProps = { label: string } & InputHTMLAttributes<HTMLInputElement>;

function Field({ label, ...props }: FieldProps) {
  return (
    <label className="space-y-2">
      <span className="text-sm text-slate-600">{label}</span>
      <input
        className="h-11 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
        {...props}
      />
    </label>
  );
}

function toDateInputValue(timestamp: string) {
  const date = new Date(timestamp);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function timestampForDate(date: string, fallback: string) {
  return date ? new Date(`${date}T12:00:00`).toISOString() : fallback;
}

function itemLabel(item: ActivityItem) {
  if (item.kind === "behavior") {
    return item.event.behavior_type.replaceAll("_", " ");
  }

  return item.event.event_type === "reward_spent" ? "reward spend" : "work entry";
}

export function EditableHistoryLedger({
  emptyMessage,
  items,
  onDeleted,
  onUpdated,
  supabase,
  userId,
}: EditableHistoryLedgerProps) {
  const [editTarget, setEditTarget] = useState<ActivityItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityItem | null>(null);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [note, setNote] = useState("");
  const [rewardName, setRewardName] = useState("");
  const [behaviorType, setBehaviorType] = useState<BehaviorType>("indulgence");
  const [attributions, setAttributions] = useState<AttributionSelection[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLedgerEdit = async (event: LedgerEvent) => {
    setError(null);

    if (event.event_type === "work_earned" && event.source === "manual_entry") {
      const defaults = getManualWorkDefaultsFromLedgerEvent(event);

      if (!defaults.workBlockId || !defaults.durationMinutes) {
        setError("This manual work entry is missing its linked work-block details.");
        return;
      }

      try {
        const selections = await fetchAttributionSelectionsForWorkBlock(supabase, {
          userId,
          workBlockId: defaults.workBlockId,
        });
        setAttributions(selections);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load work attribution.");
        return;
      }

      setDurationMinutes(String(defaults.durationMinutes));
      setNote(defaults.note ?? "");
      setEventDate(toDateInputValue(event.created_at));
      setRewardName("");
      setEditTarget({ kind: "ledger", event });
      return;
    }

    if (event.event_type === "reward_spent" && event.source === "manual_reward_redemption") {
      const defaults = getRewardSpendDefaultsFromLedgerEvent(event);
      const name = typeof event.metadata?.reward_name === "string" ? event.metadata.reward_name : "";
      setDurationMinutes(String(defaults.rewardMinutes ?? ""));
      setNote(defaults.notes);
      setEventDate(toDateInputValue(event.created_at));
      setRewardName(name);
      setAttributions([]);
      setEditTarget({ kind: "ledger", event });
    }
  };

  const requestBehaviorEdit = (item: Extract<ActivityItem, { kind: "behavior" }>["event"]) => {
    setBehaviorType(item.behavior_type);
    setDurationMinutes(String(item.duration_minutes ?? ""));
    setEventDate(toDateInputValue(item.occurred_at));
    setNote(item.note ?? "");
    setRewardName("");
    setAttributions([]);
    setError(null);
    setEditTarget({ kind: "behavior", event: item });
  };

  const saveEdit = async () => {
    if (!editTarget || isSaving) {
      return;
    }

    const parsedMinutes = Number.parseInt(durationMinutes, 10);
    setError(null);
    setIsSaving(true);

    try {
      if (editTarget.kind === "behavior") {
        const needsDuration = behaviorType === "screen_time" || behaviorType === "exercise";

        if (needsDuration && (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0)) {
          throw new Error("Enter a duration greater than zero minutes.");
        }

        const updated = await updateBehaviorEvent(supabase, {
          behaviorType,
          durationMinutes: needsDuration ? parsedMinutes : null,
          eventId: editTarget.event.id,
          note,
          occurredAt: timestampForDate(eventDate, editTarget.event.occurred_at),
          userId,
        });
        onUpdated({ kind: "behavior", event: updated });
      } else if (editTarget.event.event_type === "reward_spent") {
        if (!rewardName.trim()) {
          throw new Error("Enter a reward name.");
        }

        if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
          throw new Error("Enter reward minutes greater than zero.");
        }

        const updated = await updateRewardSpendEntry(supabase, {
          costWorkBlocks: Math.max(
            1,
            Math.ceil(parsedMinutes / WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK),
          ),
          ledgerEvent: editTarget.event,
          notes: note,
          redeemedAt: timestampForDate(eventDate, editTarget.event.created_at),
          rewardMinutes: parsedMinutes,
          rewardName,
          userId,
        });
        onUpdated({ kind: "ledger", event: updated.ledgerEvent });
      } else {
        if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
          throw new Error("Enter work minutes greater than zero.");
        }

        if (attributions.length === 0) {
          throw new Error("This work entry has no saved attribution and cannot be edited safely.");
        }

        const updated = await updateManualWorkEntry(supabase, {
          actorLabel: "Full history edit",
          durationMinutes: parsedMinutes,
          ledgerEvent: editTarget.event,
          note,
          selections: attributions,
          userId,
        });
        onUpdated({ kind: "ledger", event: updated.ledgerEvent });
      }

      setEditTarget(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update this activity.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isSaving) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      if (deleteTarget.kind === "behavior") {
        await hardDeleteBehaviorEvent(supabase, { eventId: deleteTarget.event.id, userId });
      } else {
        await hardDeleteLedgerEvent(supabase, { ledgerEvent: deleteTarget.event, userId });
      }

      onDeleted(deleteTarget);
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this activity.");
    } finally {
      setIsSaving(false);
    }
  };

  const editingReward = editTarget?.kind === "ledger" && editTarget.event.event_type === "reward_spent";
  const editingBehavior = editTarget?.kind === "behavior";

  return (
    <>
      {error && !editTarget && !deleteTarget ? (
        <p className="mb-4 text-sm text-rose-700">{error}</p>
      ) : null}

      <LedgerEventList
        emptyMessage={emptyMessage}
        items={items}
        onRequestDelete={(event) => {
          setError(null);
          setDeleteTarget({ kind: "ledger", event });
        }}
        onRequestDeleteBehavior={(event) => {
          setError(null);
          setDeleteTarget({ kind: "behavior", event });
        }}
        onRequestEdit={(event) => void requestLedgerEdit(event)}
        onRequestEditBehavior={requestBehaviorEdit}
        showDeleteAction={isDeletableLedgerEvent}
        showEditAction={isEditableLedgerEvent}
      />

      <Dialog
        onClose={() => {
          if (!isSaving) {
            setEditTarget(null);
            setError(null);
          }
        }}
        open={Boolean(editTarget)}
        title="Edit activity"
      >
        <div className="space-y-4">
          {editingBehavior ? (
            <label className="space-y-2">
              <span className="text-sm text-slate-600">Behavior</span>
              <select
                className="h-11 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none"
                onChange={(event) => setBehaviorType(event.target.value as BehaviorType)}
                value={behaviorType}
              >
                <option value="indulgence">Indulgent behavior</option>
                <option value="screen_time">Screen time</option>
                <option value="exercise">Exercise</option>
              </select>
            </label>
          ) : null}

          {editingReward ? (
            <Field label="Reward" onChange={(event) => setRewardName(event.target.value)} value={rewardName} />
          ) : null}

          {!editingBehavior || behaviorType !== "indulgence" ? (
            <Field
              inputMode="numeric"
              label={editingReward ? "Reward minutes" : "Minutes"}
              min="1"
              onChange={(event) => setDurationMinutes(event.target.value)}
              type="number"
              value={durationMinutes}
            />
          ) : null}

          {editingBehavior || editingReward ? (
            <Field
              label="Day"
              onChange={(event) => setEventDate(event.target.value)}
              type="date"
              value={eventDate}
            />
          ) : null}

          <label className="space-y-2">
            <span className="text-sm text-slate-600">Note</span>
            <textarea
              className="min-h-24 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional note"
              value={note}
            />
          </label>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button className="w-full" disabled={isSaving} onClick={() => void saveEdit()} variant="secondary">
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        onClose={() => {
          if (!isSaving) {
            setDeleteTarget(null);
            setError(null);
          }
        }}
        open={Boolean(deleteTarget)}
        title="Delete activity"
      >
        <div className="space-y-5">
          <p className="text-sm leading-6 text-slate-600">
            Delete this {deleteTarget ? itemLabel(deleteTarget) : "activity"}? Its linked accounting records will also be removed.
          </p>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <Button disabled={isSaving} onClick={() => setDeleteTarget(null)} variant="text">
              Cancel
            </Button>
            <Button disabled={isSaving} onClick={() => void confirmDelete()} variant="secondary">
              {isSaving ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
