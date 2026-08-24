"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";

type TimerControlsProps = {
  accentClassName?: string;
  accentStyle?: CSSProperties;
  isRunning: boolean;
  onEndSession?: () => void;
  onPause: () => void;
  onReset: () => void;
  onStart: () => void;
  overageMode?: boolean;
};

export function TimerControls({
  accentClassName,
  accentStyle,
  isRunning,
  onEndSession,
  onPause,
  onReset,
  onStart,
  overageMode = false,
}: TimerControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button
        className={accentClassName}
        onClick={overageMode ? onEndSession : isRunning ? onPause : onStart}
        style={accentStyle}
      >
        {overageMode ? "End session" : isRunning ? "Pause timer" : "Start timer"}
      </Button>
      {!overageMode ? (
        <Button
          className="border-slate-300/80 bg-white/70 hover:bg-white"
          onClick={onReset}
          variant="secondary"
        >
          Reset
        </Button>
      ) : null}
    </div>
  );
}
