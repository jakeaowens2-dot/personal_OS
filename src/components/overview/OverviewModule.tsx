import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

type OverviewModuleProps = {
  action?: ReactNode;
  badge?: ReactNode;
  body: ReactNode;
  className?: string;
  footer?: ReactNode;
  ruleClassName?: string;
  ruleStyle?: CSSProperties;
  title: string;
};

// Overview modules below the timer share one layout skeleton so headings, actions,
// block rows, and footer text align across neighboring modules. Add content through
// these slots instead of introducing ad hoc internal flex layouts per module.
export function OverviewModule({
  action,
  badge,
  body,
  className,
  footer,
  ruleClassName,
  ruleStyle,
  title,
}: OverviewModuleProps) {
  return (
    <section className={cn("grid grid-rows-[auto_auto_1fr_auto] gap-4", className)}>
      <div
        aria-hidden="true"
        className={cn("h-1.5 w-24 bg-slate-300/80", ruleClassName)}
        style={ruleStyle}
      />

      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {badge}
        </div>
        {action ? <div className="flex items-end justify-end">{action}</div> : <div />}
      </div>

      <div>{body}</div>

      <div className="min-h-6">{footer}</div>
    </section>
  );
}
