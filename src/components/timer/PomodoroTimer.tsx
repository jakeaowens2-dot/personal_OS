"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { TimerControls } from "@/components/timer/TimerControls";
import { TimerModeTabs } from "@/components/timer/TimerModeTabs";
import { formatTimeRemaining, getModeDurationSeconds, getModeLabel } from "@/lib/timer";
import { timerPalette } from "@/lib/timerPalette";
import {
  advanceDurableTimerState,
  parseDurableTimerState,
  timerStorageKey,
  type DurableTimerState,
} from "@/lib/timerRuntime";
import type { TimerMode } from "@/lib/types";

export type TimerStatus = "idle" | "running" | "paused" | "complete" | "overage";

const STATUS_COPY: Partial<Record<TimerStatus, string>> = {
  running: "Session running",
  paused: "Paused",
  complete: "Work block complete",
  overage: "Session rolling",
};

const MODE_ICON_LABEL: Record<TimerMode, string> = {
  work: "W",
  break: "B",
  long_break: "L",
};

function createFaviconHref(mode: TimerMode) {
  const palette = timerPalette[mode];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="29" fill="${palette.progress}" />
      <text
        x="32"
        y="42"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="34"
        font-weight="700"
        fill="white"
      >
        ${MODE_ICON_LABEL[mode]}
      </text>
    </svg>
  `;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function setFavicon(href: string) {
  let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");

  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }

  favicon.href = href;
}

function playCompletionChime() {
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    return;
  }

  const audioContext = new AudioContextCtor();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const startTime = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(659.25, startTime);
  oscillator.frequency.linearRampToValueAtTime(880, startTime + 0.18);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.08, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.52);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + 0.54);
  oscillator.addEventListener("ended", () => {
    void audioContext.close();
  });
}

export type SessionEndInfo = {
  completedAt: string;
  mode: TimerMode;
  overageSeconds: number;
};

type PomodoroTimerProps = {
  userId: string;
  onComplete?: (completion: { completedAt: string; mode: TimerMode }) => void;
  onEndSession?: (session: SessionEndInfo) => void;
  onStateChange?: (state: { mode: TimerMode; status: TimerStatus }) => void;
  breakRequest?: { token: number; minutes: number } | null;
};

export function PomodoroTimer({
  userId,
  onComplete,
  onEndSession,
  onStateChange,
  breakRequest,
}: PomodoroTimerProps) {
  const [mode, setMode] = useState<TimerMode>("work");
  const [remainingSeconds, setRemainingSeconds] = useState(getModeDurationSeconds("work"));
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [overageSeconds, setOverageSeconds] = useState(0);
  const [breakDurationSeconds, setBreakDurationSeconds] = useState<number | null>(null);
  const [lastCompletedMode, setLastCompletedMode] = useState<TimerMode | null>(null);
  const [timerHydrated, setTimerHydrated] = useState(false);
  const completionEmittedRef = useRef(false);
  const modeRef = useRef<TimerMode>(mode);
  const remainingSecondsRef = useRef(remainingSeconds);
  const clockSavedAtRef = useRef(0);
  const handledBreakRequestToken = useRef<number | null>(null);

  const palette = timerPalette[mode];
  const modeTotalSeconds =
    mode === "break" && breakDurationSeconds != null
      ? breakDurationSeconds
      : getModeDurationSeconds(mode);
  const totalSeconds = modeTotalSeconds;
  const isOverage = status === "overage";

  const progress = useMemo(() => {
    if (isOverage) {
      return 100;
    }

    const elapsed = totalSeconds - remainingSeconds;
    return Math.max(0, Math.min(100, (elapsed / totalSeconds) * 100));
  }, [remainingSeconds, totalSeconds, isOverage]);

  const reconcileClock = useEffectEvent((now = Date.now()) => {
    const currentState: DurableTimerState = {
      version: 1,
      mode,
      status,
      remainingSeconds,
      overageSeconds,
      breakDurationSeconds,
      lastCompletedMode,
      savedAt: clockSavedAtRef.current,
    };
    const nextState = advanceDurableTimerState(currentState, now);

    clockSavedAtRef.current = nextState.savedAt;
    modeRef.current = nextState.mode;
    remainingSecondsRef.current = nextState.remainingSeconds;

    if (nextState.remainingSeconds !== remainingSeconds) {
      setRemainingSeconds(nextState.remainingSeconds);
    }
    if (nextState.overageSeconds !== overageSeconds) {
      setOverageSeconds(nextState.overageSeconds);
    }
    if (nextState.lastCompletedMode !== lastCompletedMode) {
      setLastCompletedMode(nextState.lastCompletedMode);
    }
    if (nextState.status !== status) {
      completionEmittedRef.current =
        nextState.status === "complete" || nextState.status === "overage";
      setStatus(nextState.status);

      if (nextState.status === "complete") {
        onComplete?.({
          completedAt: new Date(now).toISOString(),
          mode: nextState.mode,
        });
      }
    }

    return nextState;
  });

  useEffect(() => {
    if (status !== "running" && status !== "overage") {
      return;
    }

    const refreshFromClock = () => reconcileClock();
    refreshFromClock();
    const intervalId = window.setInterval(refreshFromClock, 1000);
    window.addEventListener("focus", refreshFromClock);
    document.addEventListener("visibilitychange", refreshFromClock);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshFromClock);
      document.removeEventListener("visibilitychange", refreshFromClock);
    };
  }, [status]);

  useEffect(() => {
    if (!breakRequest) {
      return;
    }

    if (handledBreakRequestToken.current === breakRequest.token) {
      return;
    }

    handledBreakRequestToken.current = breakRequest.token;
    const seconds = breakRequest.minutes * 60;

    completionEmittedRef.current = false;
    modeRef.current = "break";
    setMode("break");
    setBreakDurationSeconds(seconds);
    setRemainingSeconds(seconds);
    remainingSecondsRef.current = seconds;
    clockSavedAtRef.current = Date.now();
    setOverageSeconds(0);
    setStatus("idle");
    setLastCompletedMode(null);
  }, [breakRequest]);

  useEffect(() => {
    onStateChange?.({ mode, status });
  }, [mode, onStateChange, status]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const storedState = parseDurableTimerState(
          localStorage.getItem(timerStorageKey(userId)),
        );

        if (storedState) {
          const restoredState = advanceDurableTimerState(storedState);
          completionEmittedRef.current =
            restoredState.status === "complete" || restoredState.status === "overage";
          modeRef.current = restoredState.mode;
          remainingSecondsRef.current = restoredState.remainingSeconds;
          clockSavedAtRef.current = restoredState.savedAt;
          setMode(restoredState.mode);
          setStatus(restoredState.status);
          setRemainingSeconds(restoredState.remainingSeconds);
          setOverageSeconds(restoredState.overageSeconds);
          setBreakDurationSeconds(restoredState.breakDurationSeconds);
          setLastCompletedMode(restoredState.lastCompletedMode);
        }
      } catch {
        /* Start from a clean timer if local storage is unavailable. */
      } finally {
        setTimerHydrated(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [userId]);

  useEffect(() => {
    remainingSecondsRef.current = remainingSeconds;

    if (!timerHydrated) {
      return;
    }

    try {
      const snapshot: DurableTimerState = {
        version: 1,
        mode,
        status,
        remainingSeconds,
        overageSeconds,
        breakDurationSeconds,
        lastCompletedMode,
        savedAt: clockSavedAtRef.current,
      };
      localStorage.setItem(timerStorageKey(userId), JSON.stringify(snapshot));
    } catch {
      /* Timer continuity remains in memory if local storage is unavailable. */
    }
  }, [
    breakDurationSeconds,
    lastCompletedMode,
    mode,
    overageSeconds,
    remainingSeconds,
    status,
    timerHydrated,
    userId,
  ]);

  useEffect(() => {
    if (status === "complete") {
      document.title = `${getModeLabel(mode)} complete - Productivity OS`;
    } else if (status === "overage") {
      document.title = `+${formatTimeRemaining(overageSeconds)} overage - Productivity OS`;
    } else {
      document.title = `${formatTimeRemaining(remainingSeconds)} - ${getModeLabel(mode)}`;
    }

    setFavicon(createFaviconHref(mode));

    return () => {
      document.title = "Productivity OS";
      setFavicon(createFaviconHref("work"));
    };
  }, [mode, remainingSeconds, status, overageSeconds]);

  useEffect(() => {
    if (status === "complete" || status === "overage") {
      playCompletionChime();
    }
  }, [status]);

  const handleModeChange = (nextMode: TimerMode) => {
    const nextRemainingSeconds = getModeDurationSeconds(nextMode);
    completionEmittedRef.current = false;
    setMode(nextMode);
    modeRef.current = nextMode;
    setBreakDurationSeconds(null);
    setRemainingSeconds(nextRemainingSeconds);
    remainingSecondsRef.current = nextRemainingSeconds;
    clockSavedAtRef.current = Date.now();
    setOverageSeconds(0);
    setStatus("idle");
    setLastCompletedMode(null);
  };

  const handleStart = () => {
    const nextRemainingSeconds =
      remainingSeconds === 0 ? modeTotalSeconds : remainingSeconds;
    completionEmittedRef.current = false;
    if (remainingSeconds === 0) {
      setRemainingSeconds(nextRemainingSeconds);
      remainingSecondsRef.current = nextRemainingSeconds;
    }

    clockSavedAtRef.current = Date.now();
    setStatus("running");
    setLastCompletedMode(null);
  };

  const handlePause = () => {
    const now = Date.now();
    const reconciledState = advanceDurableTimerState({
      version: 1,
      mode,
      status,
      remainingSeconds,
      overageSeconds,
      breakDurationSeconds,
      lastCompletedMode,
      savedAt: clockSavedAtRef.current,
    }, now);

    clockSavedAtRef.current = reconciledState.savedAt;
    remainingSecondsRef.current = reconciledState.remainingSeconds;
    setRemainingSeconds(reconciledState.remainingSeconds);
    setOverageSeconds(reconciledState.overageSeconds);
    setLastCompletedMode(reconciledState.lastCompletedMode);

    if (reconciledState.status === "running") {
      setStatus("paused");
    } else {
      completionEmittedRef.current =
        reconciledState.status === "complete" || reconciledState.status === "overage";
      setStatus(reconciledState.status);

      if (reconciledState.status === "complete") {
        onComplete?.({
          completedAt: new Date(now).toISOString(),
          mode: reconciledState.mode,
        });
      }
    }
  };

  const handleReset = () => {
    completionEmittedRef.current = false;
    setRemainingSeconds(modeTotalSeconds);
    remainingSecondsRef.current = modeTotalSeconds;
    clockSavedAtRef.current = Date.now();
    setOverageSeconds(0);
    setStatus("idle");
    setLastCompletedMode(null);
  };

  const handleEndSession = () => {
    const endedMode = modeRef.current;

    onEndSession?.({
      completedAt: new Date().toISOString(),
      mode: endedMode,
      overageSeconds,
    });

    completionEmittedRef.current = false;
    const resetSeconds = getModeDurationSeconds("work");
    setRemainingSeconds(resetSeconds);
    remainingSecondsRef.current = resetSeconds;
    clockSavedAtRef.current = Date.now();
    setOverageSeconds(0);
    setStatus("idle");
    setLastCompletedMode(null);
  };

  const circumference = 2 * Math.PI * 120;
  const dashOffset = circumference - (progress / 100) * circumference;
  const completionMode = lastCompletedMode ?? mode;
  const timerSurfaceColor =
    status === "running" || status === "overage" ? palette.backgroundActive : palette.backgroundInactive;
  const displayTime = isOverage
    ? `+${formatTimeRemaining(overageSeconds)}`
    : formatTimeRemaining(remainingSeconds);

  return (
    <section
      className="rounded-[2rem] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.06)] transition-[background-color,box-shadow] duration-500 sm:p-8"
      style={{
        backgroundColor: timerSurfaceColor,
        boxShadow:
          status === "running" || status === "overage"
            ? `0 28px 90px ${palette.glow}`
            : "0 24px 60px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 text-center">
        <TimerModeTabs
          activeMode={mode}
          activeModeClassName="text-white hover:brightness-[0.96]"
          activeModeStyle={{ backgroundColor: palette.progress }}
          inactiveModeClassName="hover:text-slate-700"
          onModeChange={handleModeChange}
        />

        <div className="flex w-full flex-col items-center gap-5">
          <div
            className="flex h-[19rem] w-[19rem] items-center justify-center rounded-full ring-1 ring-white/70 sm:h-[24rem] sm:w-[24rem]"
            style={{ backgroundColor: palette.central }}
          >
            <div
              className="relative flex h-[15rem] w-[15rem] items-center justify-center rounded-full sm:h-[19.5rem] sm:w-[19.5rem]"
            >
              <svg
                aria-hidden="true"
                className="-rotate-90 absolute inset-0 h-full w-full"
                viewBox="0 0 260 260"
              >
                <circle cx="130" cy="130" fill="none" r="120" stroke="rgba(255,255,255,0.95)" strokeWidth="10" />
                <circle
                  cx="130"
                  cy="130"
                  fill="none"
                  r="120"
                  strokeWidth="10"
                  strokeLinecap="round"
                  style={{
                    stroke: palette.progress,
                    strokeDasharray: circumference,
                    strokeDashoffset: dashOffset,
                  }}
                />
              </svg>

              <div className="relative z-10 flex flex-col items-center gap-4">
                <Badge
                  className="normal-case tracking-normal"
                  style={{
                    backgroundColor: palette.backgroundInactive,
                    color: palette.progress,
                  }}
                >
                  {getModeLabel(mode)}
                </Badge>
                {STATUS_COPY[status] ? (
                  <p className="text-sm text-slate-700">{STATUS_COPY[status]}</p>
                ) : null}
                <p
                  className="text-6xl font-semibold tracking-[-0.08em] sm:text-8xl"
                  style={{ color: palette.progress }}
                >
                  {displayTime}
                </p>
              </div>
            </div>
          </div>

          <TimerControls
            accentClassName="text-white hover:brightness-[0.96]"
            accentStyle={{ backgroundColor: palette.progress }}
            isRunning={status === "running"}
            onEndSession={handleEndSession}
            onPause={handlePause}
            onReset={handleReset}
            onStart={handleStart}
            overageMode={isOverage}
          />
        </div>

        {status === "complete" ? (
          <div
            className="w-full max-w-2xl rounded-full px-5 py-3 text-sm text-slate-700 ring-1 ring-slate-200/60"
            style={{ backgroundColor: palette.glow }}
          >
            Completion event detected for the {getModeLabel(completionMode)} session.
          </div>
        ) : null}

        {status === "overage" ? (
          <div
            className="w-full max-w-2xl rounded-full px-5 py-3 text-sm text-slate-700 ring-1 ring-slate-200/60"
            style={{ backgroundColor: palette.glow }}
          >
            Work session complete — the timer is rolling forward. End the session to log it.
          </div>
        ) : null}
      </div>
    </section>
  );
}
