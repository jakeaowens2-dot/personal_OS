"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { getModeLabel } from "@/lib/timer";
import type { TimerMode } from "@/lib/types";

type TimerModeTabsProps = {
  activeMode: TimerMode;
  activeModeClassName?: string;
  activeModeStyle?: CSSProperties;
  disabled?: boolean;
  inactiveModeClassName?: string;
  onModeChange: (mode: TimerMode) => void;
};

const MODES: TimerMode[] = ["work", "break", "long_break"];

export function TimerModeTabs({
  activeMode,
  activeModeClassName,
  activeModeStyle,
  disabled = false,
  inactiveModeClassName,
  onModeChange,
}: TimerModeTabsProps) {
  return (
    <div className="grid gap-2 rounded-2xl bg-white/65 p-2 ring-1 ring-white/70 backdrop-blur sm:grid-cols-3">
      {MODES.map((mode) => {
        const selected = mode === activeMode;

        return (
          <Button
            key={mode}
            aria-pressed={selected}
            className={cn(
              "justify-center rounded-2xl px-5",
              selected &&
                cn(
                  "text-white shadow-[0_10px_30px_rgba(15,23,42,0.12)] hover:brightness-[0.98]",
                  activeModeClassName,
                ),
              !selected && cn("text-slate-600 hover:bg-white/75", inactiveModeClassName),
            )}
            disabled={disabled}
            onClick={() => onModeChange(mode)}
            style={selected ? activeModeStyle : undefined}
            variant={selected ? "primary" : "ghost"}
          >
            {getModeLabel(mode)}
          </Button>
        );
      })}
    </div>
  );
}
