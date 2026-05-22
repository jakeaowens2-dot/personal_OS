import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type DialogProps = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
} & HTMLAttributes<HTMLDivElement>;

export function Dialog({
  children,
  className,
  onClose,
  open,
  title,
  ...props
}: DialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      aria-labelledby="dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-10"
      role="dialog"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.2)]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="text-xl font-semibold tracking-tight text-slate-950">
            {title}
          </h2>
          <button
            aria-label="Close dialog"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
