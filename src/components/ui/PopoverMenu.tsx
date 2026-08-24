"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type PopoverMenuProps = {
  buttonClassName?: string;
  label: ReactNode;
  menuClassName?: string;
  children: ReactNode;
};

const CLOSE_DELAY_MS = 150;

// Opens on click and closes when the pointer leaves the popover for good.
// A short close delay plus a hover bridge (padding, not margin, between the
// button and the panel) keeps the menu "sticky" around small local mouse
// movements instead of snapping shut the moment the cursor drifts.
export function PopoverMenu({ buttonClassName, label, menuClassName, children }: PopoverMenuProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    };
  }, []);

  return (
    <div className="relative" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "cursor-pointer rounded-[0.6rem] px-2 py-1 transition hover:bg-slate-100",
          buttonClassName,
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 pt-1">
          <div
            className={cn(
              "min-w-32 rounded-[0.8rem] border border-slate-200/90 bg-white/95 p-2 shadow-[0_16px_28px_rgba(15,23,42,0.1)]",
              menuClassName,
            )}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
