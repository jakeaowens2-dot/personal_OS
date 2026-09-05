import type { SupabaseClient } from "@supabase/supabase-js";
import { usesEconomyPolicyV2 } from "@/lib/economy";
import type { BehaviorEvent, BehaviorType } from "@/lib/types";

export const INDULGENCE_PENALTY_MINUTES = 60;

const BEHAVIOR_SELECT_COLUMNS = [
  "id",
  "user_id",
  "behavior_type",
  "occurred_at",
  "duration_minutes",
  "penalty_minutes",
  "note",
  "deleted_at",
  "deleted_by_actor_label",
  "deletion_reason",
  "created_at",
].join(", ");

export function getBehaviorTypeLabel(behaviorType: BehaviorType) {
  switch (behaviorType) {
    case "indulgence":
      return "Indulgent behavior";
    case "screen_time":
      return "Screen time";
    case "exercise":
      return "Exercise";
  }
}

export function computeScreenTimePenalty(
  screenTimeMinutes: number,
  occurredAt = new Date().toISOString(),
) {
  if (!usesEconomyPolicyV2(occurredAt)) {
    return Math.max(0.5 * screenTimeMinutes, screenTimeMinutes - 60);
  }

  return Math.max(0, screenTimeMinutes);
}

export function computeBehaviorPenalty(
  behaviorType: BehaviorType,
  durationMinutes: number | null,
  occurredAt?: string,
) {
  switch (behaviorType) {
    case "indulgence":
      return INDULGENCE_PENALTY_MINUTES;
    case "screen_time":
      return computeScreenTimePenalty(durationMinutes ?? 0, occurredAt);
    case "exercise":
      return 0;
  }
}

export type BehaviorEntryInput = {
  behaviorType: BehaviorType;
  durationMinutes?: number | null;
  note?: string;
  occurredAt?: string;
  userId: string;
};

export async function persistBehaviorEvent(supabase: SupabaseClient, input: BehaviorEntryInput) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const penaltyMinutes = computeBehaviorPenalty(
    input.behaviorType,
    input.durationMinutes ?? null,
    occurredAt,
  );
  const durationMinutes =
    input.behaviorType === "exercise" || input.behaviorType === "screen_time"
      ? input.durationMinutes ?? null
      : null;

  const { data, error } = await supabase
    .from("behavior_events")
    .insert({
      user_id: input.userId,
      behavior_type: input.behaviorType,
      occurred_at: occurredAt,
      duration_minutes: durationMinutes,
      penalty_minutes: penaltyMinutes,
      note: input.note?.trim() || null,
    })
    .select(BEHAVIOR_SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message || "Could not save the behavior event.");
  }

  return data as unknown as BehaviorEvent;
}

export async function updateBehaviorEvent(
  supabase: SupabaseClient,
  input: BehaviorEntryInput & { eventId: string },
) {
  const penaltyMinutes = computeBehaviorPenalty(
    input.behaviorType,
    input.durationMinutes ?? null,
    input.occurredAt,
  );
  const durationMinutes =
    input.behaviorType === "exercise" || input.behaviorType === "screen_time"
      ? input.durationMinutes ?? null
      : null;

  const { data, error } = await supabase
    .from("behavior_events")
    .update({
      behavior_type: input.behaviorType,
      occurred_at: input.occurredAt ?? undefined,
      duration_minutes: durationMinutes,
      penalty_minutes: penaltyMinutes,
      note: input.note?.trim() || null,
    })
    .eq("id", input.eventId)
    .eq("user_id", input.userId)
    .select(BEHAVIOR_SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message || "Could not update the behavior event.");
  }

  return data as unknown as BehaviorEvent;
}

export async function hardDeleteBehaviorEvent(
  supabase: SupabaseClient,
  { eventId, userId }: { eventId: string; userId: string },
) {
  const { error } = await supabase
    .from("behavior_events")
    .delete()
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message || "Could not delete the behavior event.");
  }
}

export async function fetchBehaviorEvents(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("behavior_events")
    .select(BEHAVIOR_SELECT_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message || "Could not load behavior events.");
  }

  return (data ?? []) as unknown as BehaviorEvent[];
}

// Net reward-minutes contributed by behavior events: exercise adds minutes, penalties subtract.
export function getBehaviorRewardDeltaMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    if (event.behavior_type === "exercise") {
      return total + (event.duration_minutes ?? 0);
    }

    return total - (event.penalty_minutes ?? 0);
  }, 0);
}

export function getBehaviorPenaltyMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    if (event.behavior_type === "exercise") {
      return total;
    }

    return total + (event.penalty_minutes ?? 0);
  }, 0);
}

export function getBehaviorExerciseMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    return event.behavior_type === "exercise" ? total + (event.duration_minutes ?? 0) : total;
  }, 0);
}
