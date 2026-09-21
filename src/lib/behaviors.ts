import type { SupabaseClient } from "@supabase/supabase-js";
import { HEALTHY_BEHAVIOR_REWARD_MINUTES, usesEconomyPolicyV2 } from "@/lib/economy";
import type { BehaviorEvent, BehaviorType, HealthyBehaviorType } from "@/lib/types";

export const INDULGENCE_PENALTY_MINUTES = 60;

export function isHealthyBehaviorType(
  behaviorType: BehaviorType,
): behaviorType is HealthyBehaviorType {
  return behaviorType === "waking_routine" || behaviorType === "gallon_water";
}

const BEHAVIOR_SELECT_COLUMNS = [
  "id",
  "user_id",
  "behavior_type",
  "occurred_at",
  "duration_minutes",
  "penalty_minutes",
  "healthy_behavior_succeeded",
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
    case "waking_routine":
      return "Healthy morning habits";
    case "gallon_water":
      return "Drink 1 gallon of water";
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
  healthyBehaviorSucceeded?: boolean | null,
) {
  switch (behaviorType) {
    case "indulgence":
      return INDULGENCE_PENALTY_MINUTES;
    case "screen_time":
      return computeScreenTimePenalty(durationMinutes ?? 0, occurredAt);
    case "exercise":
      return 0;
    case "waking_routine":
    case "gallon_water":
      return healthyBehaviorSucceeded === false ? HEALTHY_BEHAVIOR_REWARD_MINUTES : 0;
  }
}

export type BehaviorEntryInput = {
  behaviorType: BehaviorType;
  durationMinutes?: number | null;
  note?: string;
  occurredAt?: string;
  healthyBehaviorSucceeded?: boolean | null;
  userId: string;
};

export async function persistBehaviorEvent(supabase: SupabaseClient, input: BehaviorEntryInput) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const penaltyMinutes = computeBehaviorPenalty(
    input.behaviorType,
    input.durationMinutes ?? null,
    occurredAt,
    input.healthyBehaviorSucceeded,
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
      healthy_behavior_succeeded: isHealthyBehaviorType(input.behaviorType)
        ? input.healthyBehaviorSucceeded ?? true
        : null,
      note: input.note?.trim() || null,
    })
    .select(BEHAVIOR_SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505" && isHealthyBehaviorType(input.behaviorType)) {
      throw new Error(`${getBehaviorTypeLabel(input.behaviorType)} is already logged for this day.`);
    }

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
    input.healthyBehaviorSucceeded,
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
      healthy_behavior_succeeded: isHealthyBehaviorType(input.behaviorType)
        ? input.healthyBehaviorSucceeded ?? true
        : null,
      note: input.note?.trim() || null,
    })
    .eq("id", input.eventId)
    .eq("user_id", input.userId)
    .select(BEHAVIOR_SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505" && isHealthyBehaviorType(input.behaviorType)) {
      throw new Error(`${getBehaviorTypeLabel(input.behaviorType)} is already logged for this day.`);
    }

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

export function isHealthyBehaviorSuccess(event: BehaviorEvent) {
  return isHealthyBehaviorType(event.behavior_type) && event.healthy_behavior_succeeded !== false;
}

// Net reward-minutes contributed by behavior events: positive behaviors add, penalties subtract.
export function getBehaviorRewardDeltaMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    if (event.behavior_type === "exercise") {
      return total + (event.duration_minutes ?? 0);
    }

    if (isHealthyBehaviorType(event.behavior_type)) {
      return total + (isHealthyBehaviorSuccess(event)
        ? HEALTHY_BEHAVIOR_REWARD_MINUTES
        : -HEALTHY_BEHAVIOR_REWARD_MINUTES);
    }

    return total - (event.penalty_minutes ?? 0);
  }, 0);
}

export function getBehaviorPenaltyMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    if (event.behavior_type === "exercise" || isHealthyBehaviorSuccess(event)) {
      return total;
    }

    return total + (event.penalty_minutes ?? 0);
  }, 0);
}

export function getPositiveBehaviorRewardMinutes(events: BehaviorEvent[]) {
  return events.reduce((total, event) => {
    if (event.behavior_type === "exercise") {
      return total + (event.duration_minutes ?? 0);
    }

    return isHealthyBehaviorSuccess(event)
      ? total + HEALTHY_BEHAVIOR_REWARD_MINUTES
      : total;
  }, 0);
}
