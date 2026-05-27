import type { LedgerEvent } from "@/lib/types";

export const WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK = 20;
export const WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK = 30;
export const WEEKEND_REWARD_MULTIPLIER_LABEL = "1.5x";
export const REWARD_BLOCK_MINUTES = 60;

export function isWeekendDate(isoTimestamp: string) {
  const day = new Date(isoTimestamp).getDay();
  return day === 0 || day === 6;
}

export function getRewardMinutesForWorkEvent(event: LedgerEvent) {
  if (event.event_type !== "work_earned") {
    return 0;
  }

  return isWeekendDate(event.created_at)
    ? WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK
    : WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK;
}

export function getRewardMinutesForSpendEvent(event: LedgerEvent) {
  if (event.event_type !== "reward_spent") {
    return 0;
  }

  const rewardMinutes = event.metadata?.reward_minutes;

  if (typeof rewardMinutes === "number" && Number.isFinite(rewardMinutes)) {
    return rewardMinutes;
  }

  return Math.abs(event.delta_reward_blocks) * REWARD_BLOCK_MINUTES;
}

export function getRewardBalanceMinutes(events: LedgerEvent[]) {
  return events.reduce((total, event) => {
    if (event.event_type === "work_earned") {
      return total + getRewardMinutesForWorkEvent(event);
    }

    if (event.event_type === "reward_spent") {
      return total - getRewardMinutesForSpendEvent(event);
    }

    return total + event.delta_reward_blocks * REWARD_BLOCK_MINUTES;
  }, 0);
}
