import { cn } from "@/lib/cn";
import { getBehaviorTypeLabel } from "@/lib/behaviors";
import type { HealthyBehaviorType } from "@/lib/types";

export type HealthyBehaviorOutcomes = Record<HealthyBehaviorType, boolean | null>;

const HEALTHY_BEHAVIORS: HealthyBehaviorType[] = ["gallon_water", "waking_routine"];

function OutcomeSwitch({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
  value: boolean | null;
}) {
  const position = value === true
    ? "translate-x-0"
    : value === false
      ? "translate-x-[4.25rem]"
      : "translate-x-[2.125rem]";

  return (
    <div
      aria-label={label}
      className="relative grid h-11 w-28 grid-cols-2 rounded-full bg-slate-200/80 p-1"
      role="group"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1 top-1 h-9 w-9 rounded-full shadow-sm transition-[transform,background-color] duration-300 ease-out",
          value === true ? "bg-emerald-500" : value === false ? "bg-rose-500" : "bg-white",
          position,
        )}
      />
      <button
        aria-pressed={value === true}
        className={cn(
          "relative z-10 rounded-full text-xs font-semibold transition-colors duration-300",
          value === true ? "text-white" : "text-slate-500 hover:text-emerald-700",
        )}
        disabled={disabled}
        onClick={() => onChange(true)}
        type="button"
      >
        Yes
      </button>
      <button
        aria-pressed={value === false}
        className={cn(
          "relative z-10 rounded-full text-xs font-semibold transition-colors duration-300",
          value === false ? "text-white" : "text-slate-500 hover:text-rose-700",
        )}
        disabled={disabled}
        onClick={() => onChange(false)}
        type="button"
      >
        No
      </button>
    </div>
  );
}

export function HealthyBehaviorCheckin({
  disabled,
  onChange,
  outcomes,
}: {
  disabled?: boolean;
  onChange: (type: HealthyBehaviorType, value: boolean) => void;
  outcomes: HealthyBehaviorOutcomes;
}) {
  return (
    <div className="divide-y divide-slate-200/80 border-y border-slate-200/80">
      {HEALTHY_BEHAVIORS.map((type) => (
        <div className="flex min-h-16 items-center justify-between gap-4 py-3" key={type}>
          <span className="text-sm font-medium text-slate-800">{getBehaviorTypeLabel(type)}</span>
          <OutcomeSwitch
            disabled={disabled}
            label={`${getBehaviorTypeLabel(type)} outcome`}
            onChange={(value) => onChange(type, value)}
            value={outcomes[type]}
          />
        </div>
      ))}
    </div>
  );
}
