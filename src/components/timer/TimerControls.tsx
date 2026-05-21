"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";

type TimerControlsProps = {
  accentClassName?: string;
  accentStyle?: CSSProperties;
  isRunning: boolean;
  onPause: () => void;
  onReset: () => void;
  onStart: () => void;
};

export function TimerControls({
  accentClassName,
  accentStyle,
  isRunning,
  onPause,
  onReset,
  onStart,
}: TimerControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button className={accentClassName} onClick={isRunning ? onPause : onStart} style={accentStyle}>
        {isRunning ? "Pause timer" : "Start timer"}
      </Button>
      <Button
        className="border-slate-300/80 bg-white/70 hover:bg-white"
        onClick={onReset}
        variant="secondary"
      >
        Reset
      </Button>
    </div>
  );
}
