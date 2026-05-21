import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "accent" | "neutral";
};

const toneClasses = {
  accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  neutral: "bg-slate-100 text-slate-700",
};

export function Badge({
  children,
  className,
  tone = "accent",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
