import type { BehaviorEvent, LedgerEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Canonical block-economy math. See docs/ECONOMY.md for the full model.
// 1 block = 1 hour in every currency (work, reward, penalty).
// ---------------------------------------------------------------------------

export const WORK_BLOCK_WORK_MINUTES = 50;
export const WORK_BLOCK_REST_MINUTES = 10;
export const REWARD_BLOCK_MINUTES = 60;
export const WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK = 20;
export const WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK = 30;
export const WEEKEND_REWARD_MULTIPLIER_LABEL = "1.5x";

// --- Dates & rates -----------------------------------------------------------

export function isWeekendDate(isoTimestamp: string) {
  const day = new Date(isoTimestamp).getDay();
  return day === 0 || day === 6;
}

export function rewardMinutesPerWorkBlock(isWeekend: boolean) {
  return isWeekend ? WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK : WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK;
}

// --- Work currency -----------------------------------------------------------

export function workBlocksFromMinutes(workMinutes: number) {
  return workMinutes / WORK_BLOCK_WORK_MINUTES;
}

export function rewardMinutesForWorkMinutes(workMinutes: number, isWeekend: boolean) {
  return workBlocksFromMinutes(workMinutes) * rewardMinutesPerWorkBlock(isWeekend);
}

// Rest duty: 10 min rest per 50 min work, rounded to the nearest standard block.
export function restMinutesForWorkMinutes(workMinutes: number) {
  return Math.max(1, Math.round(workBlocksFromMinutes(workMinutes))) * WORK_BLOCK_REST_MINUTES;
}

// Whole-block count for a ledger label (cosmetic; exact count is duration-derived).
export function workBlockDeltaForDuration(workMinutes: number) {
  return Math.max(1, Math.round(workBlocksFromMinutes(workMinutes)));
}

// --- Partial-block decomposition ---------------------------------------------

export type BlockDecomposition = {
  fullBlocks: number;
  partialRatio: number;
};

export function decomposeMinutes(minutes: number, minutesPerBlock: number): BlockDecomposition {
  const total = Math.max(0, minutes) / minutesPerBlock;
  const fullBlocks = Math.floor(total);
  const partialRatio = total - fullBlocks;
  return { fullBlocks, partialRatio };
}

// --- Ledger aggregation ------------------------------------------------------

export function getWorkDurationMinutes(event: LedgerEvent) {
  const duration = event.metadata?.duration_minutes;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? duration
    : WORK_BLOCK_WORK_MINUTES;
}

export function sumWorkRewardMinutes(events: LedgerEvent[]) {
  return events.reduce((total, event) => {
    if (event.event_type !== "work_earned") {
      return total;
    }

    return (
      total +
      rewardMinutesForWorkMinutes(getWorkDurationMinutes(event), isWeekendDate(event.created_at))
    );
  }, 0);
}

export function getSpentRewardMinutes(event: LedgerEvent) {
  const rewardMinutes = event.metadata?.reward_minutes;

  if (typeof rewardMinutes === "number" && Number.isFinite(rewardMinutes)) {
    return rewardMinutes;
  }

  return Math.abs(event.delta_reward_blocks) * REWARD_BLOCK_MINUTES;
}

export function sumSpentRewardMinutes(events: LedgerEvent[]) {
  return events.reduce(
    (total, event) =>
      event.event_type === "reward_spent" ? total + getSpentRewardMinutes(event) : total,
    0,
  );
}

// --- Settlement (sequential, penalty-first) ---------------------------------
//
// Penalty and overdraw are two INDEPENDENT liabilities, not a single negative
// balance to be lumped together:
//   - A penalty is a standing charge that earned reward "erodes" away first.
//   - An overdraw is an "empty glass" of spent-but-unearned reward that fills up
//     as reward is paid back in.
//
// Events are replayed in chronological order so that a penalty logged on top of
// an existing overdraw becomes its own distinct block (rather than inflating the
// overdraw), and incoming reward erodes penalty first, then fills the overdraw
// glass, then accumulates as solid reward. See docs/ECONOMY.md.

export type SettlementEvent =
  | { kind: "credit"; minutes: number; at: string }
  | { kind: "spend"; minutes: number; at: string }
  | { kind: "penalty"; minutes: number; at: string };

export type Settlement = {
  penaltyRemainingMinutes: number; // distinct penalty blocks (eroded first)
  debtMinutes: number;             // overdraw glass remaining (frame - fill)
  overdrawFrameMinutes: number;    // glass frame: fixed size as it fills
  overdrawFillMinutes: number;     // glass fill: reward paid back in
  positiveMinutes: number;         // solid reward once everything is cleared
  netMinutes: number;              // positive - penalty - debt
};

export function ledgerEventsToSettlementEvents(events: LedgerEvent[]): SettlementEvent[] {
  const result: SettlementEvent[] = [];

  for (const event of events) {
    if (event.event_type === "work_earned") {
      result.push({
        kind: "credit",
        minutes: rewardMinutesForWorkMinutes(
          getWorkDurationMinutes(event),
          isWeekendDate(event.created_at),
        ),
        at: event.created_at,
      });
    } else if (event.event_type === "reward_spent") {
      result.push({
        kind: "spend",
        minutes: getSpentRewardMinutes(event),
        at: event.created_at,
      });
    }
    // "bonus" and "correction" events are intentionally excluded, matching the
    // prior aggregate-only settlement.
  }

  return result;
}

export function behaviorEventsToSettlementEvents(events: BehaviorEvent[]): SettlementEvent[] {
  const result: SettlementEvent[] = [];

  for (const event of events) {
    if (event.behavior_type === "exercise") {
      result.push({ kind: "credit", minutes: event.duration_minutes ?? 0, at: event.occurred_at });
    } else {
      result.push({ kind: "penalty", minutes: event.penalty_minutes ?? 0, at: event.occurred_at });
    }
  }

  return result;
}

export function computeSettlement(events: SettlementEvent[]): Settlement {
  const sorted = [...events].sort((left, right) => left.at.localeCompare(right.at));

  let positive = 0;
  let overdrawFrame = 0;
  let overdrawFill = 0;
  let penalty = 0;

  for (const event of sorted) {
    if (event.kind === "penalty") {
      penalty += Math.max(0, event.minutes);
      continue;
    }

    if (event.kind === "spend") {
      // Spending drains positive reward first, then overdraws.
      let remaining = Math.max(0, event.minutes);

      if (positive > 0) {
        const consumed = Math.min(positive, remaining);
        positive -= consumed;
        remaining -= consumed;
      }

      if (remaining > 0) {
        overdrawFrame += remaining;
      }

      continue;
    }

    // Credit: erode penalty first, then fill the overdraw glass, then go positive.
    let credit = Math.max(0, event.minutes);

    if (penalty > 0) {
      const eroded = Math.min(penalty, credit);
      penalty -= eroded;
      credit -= eroded;
    }

    if (credit > 0) {
      const remainingDebt = overdrawFrame - overdrawFill;

      if (remainingDebt > 0) {
        const filled = Math.min(remainingDebt, credit);
        overdrawFill += filled;
        credit -= filled;

        if (overdrawFill >= overdrawFrame) {
          overdrawFrame = 0;
          overdrawFill = 0;
        }
      }
    }

    positive += credit;
  }

  const debtMinutes = Math.max(0, overdrawFrame - overdrawFill);
  const netMinutes = positive - penalty - debtMinutes;

  return {
    penaltyRemainingMinutes: penalty,
    debtMinutes,
    overdrawFrameMinutes: overdrawFrame,
    overdrawFillMinutes: overdrawFill,
    positiveMinutes: positive,
    netMinutes,
  };
}
