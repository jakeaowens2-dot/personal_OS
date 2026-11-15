import type { TimerMode } from "./types";

export type DurableTimerStatus =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "overage";

export type DurableTimerState = {
  version: 1;
  mode: TimerMode;
  status: DurableTimerStatus;
  remainingSeconds: number;
  overageSeconds: number;
  breakDurationSeconds: number | null;
  lastCompletedMode: TimerMode | null;
  savedAt: number;
};

const MODES = new Set<TimerMode>(["work", "break", "long_break"]);
const STATUSES = new Set<DurableTimerStatus>([
  "idle",
  "running",
  "paused",
  "complete",
  "overage",
]);

export function timerStorageKey(userId: string) {
  return `personal-os.timer.v1:${userId}`;
}

export function parseDurableTimerState(
  value: string | null,
): DurableTimerState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DurableTimerState>;
    if (
      parsed.version !== 1 ||
      !MODES.has(parsed.mode as TimerMode) ||
      !STATUSES.has(parsed.status as DurableTimerStatus) ||
      !Number.isSafeInteger(parsed.remainingSeconds) ||
      (parsed.remainingSeconds ?? -1) < 0 ||
      !Number.isSafeInteger(parsed.overageSeconds) ||
      (parsed.overageSeconds ?? -1) < 0 ||
      !Number.isFinite(parsed.savedAt) ||
      (parsed.breakDurationSeconds !== null &&
        (!Number.isSafeInteger(parsed.breakDurationSeconds) ||
          (parsed.breakDurationSeconds ?? 0) <= 0)) ||
      (parsed.lastCompletedMode !== null &&
        !MODES.has(parsed.lastCompletedMode as TimerMode))
    )
      return null;
    return parsed as DurableTimerState;
  } catch {
    return null;
  }
}

export function advanceDurableTimerState(
  state: DurableTimerState,
  now = Date.now(),
): DurableTimerState {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - state.savedAt) / 1000),
  );
  if (!elapsedSeconds) return state;
  const advancedAt = state.savedAt + elapsedSeconds * 1000;
  if (state.status === "overage")
    return {
      ...state,
      overageSeconds: state.overageSeconds + elapsedSeconds,
      savedAt: advancedAt,
    };
  if (state.status !== "running") return { ...state, savedAt: now };
  if (elapsedSeconds < state.remainingSeconds)
    return {
      ...state,
      remainingSeconds: state.remainingSeconds - elapsedSeconds,
      savedAt: advancedAt,
    };
  if (state.mode === "work")
    return {
      ...state,
      status: "overage",
      remainingSeconds: 0,
      overageSeconds: elapsedSeconds - state.remainingSeconds,
      lastCompletedMode: "work",
      savedAt: advancedAt,
    };
  return {
    ...state,
    status: "complete",
    remainingSeconds: 0,
    lastCompletedMode: state.mode,
    savedAt: advancedAt,
  };
}
