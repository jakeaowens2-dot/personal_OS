import type { TimerMode } from "@/lib/types";

export const TIMER_DURATIONS = {
  work: 50,
  break: 10,
  long_break: 30,
} satisfies Record<TimerMode, number>;

export function minutesToSeconds(minutes: number) {
  return minutes * 60;
}

export function getModeDurationSeconds(mode: TimerMode) {
  return minutesToSeconds(TIMER_DURATIONS[mode]);
}

export function getModeDurationMinutes(mode: TimerMode) {
  return TIMER_DURATIONS[mode];
}

export function formatTimeRemaining(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getModeLabel(mode: TimerMode) {
  switch (mode) {
    case "work":
      return "Work";
    case "break":
      return "Break";
    case "long_break":
      return "Long Break";
  }
}
