import { Button } from "@/components/ui/Button";
import { formatDayOffset } from "@/lib/dates";

type DayOffsetSelectorProps = {
  disabled?: boolean;
  label: string;
  onChange: (dayOffset: number) => void;
  value: number;
};

export function DayOffsetSelector({
  disabled = false,
  label,
  onChange,
  value,
}: DayOffsetSelectorProps) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center justify-between rounded-2xl border border-slate-300/80 bg-white/80 px-4 py-3">
        <Button
          className="text-slate-500"
          disabled={disabled}
          onClick={() => onChange(value - 1)}
          size="inline"
          variant="text"
        >
          ←
        </Button>
        <span className="text-sm font-medium text-slate-900">{formatDayOffset(value)}</span>
        {value < 0 ? (
          <Button
            className="text-slate-500"
            disabled={disabled}
            onClick={() => onChange(Math.min(value + 1, 0))}
            size="inline"
            variant="text"
          >
            →
          </Button>
        ) : (
          <span className="w-4" />
        )}
      </div>
    </div>
  );
}
