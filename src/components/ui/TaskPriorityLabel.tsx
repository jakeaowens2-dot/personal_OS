import type { TaskPriority } from "@/lib/types";

// Priority color coding: the label word stays neutral; only the value is tinted.
// low = green, medium = amber, high = red, critical = rose.
const PRIORITY_TONE: Record<TaskPriority, string> = {
  critical: "text-rose-700",
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-emerald-600",
};

export function TaskPriorityLabel({
  area,
  priority,
}: {
  area?: string | null;
  priority: TaskPriority;
}) {
  return (
    <p className="text-xs uppercase tracking-[0.18em]">
      <span className="text-slate-500">Priority: </span>
      <span className={PRIORITY_TONE[priority]}>{priority}</span>
      {area ? <span className="text-slate-500"> · {area}</span> : null}
    </p>
  );
}
