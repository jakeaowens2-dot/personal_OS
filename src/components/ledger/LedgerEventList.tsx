import { Badge } from "@/components/ui/Badge";
import { rewardPalette, timerPalette } from "@/lib/timerPalette";
import type { LedgerEvent } from "@/lib/types";

type LedgerEventListProps = {
  emptyMessage: string;
  events: LedgerEvent[];
  maxItems?: number;
};

function formatTimestamp(isoTimestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(isoTimestamp));
}

function formatSource(source: string) {
  return source.replaceAll("_", " ");
}

function getEventDisplayType(event: LedgerEvent) {
  switch (event.event_type) {
    case "reward_spent":
      return "Reward spent";
    case "bonus":
      return "Bonus";
    case "correction":
      return "Correction";
    case "work_earned":
    default:
      return "Work earned";
  }
}

function getEventTitle(event: LedgerEvent) {
  if (event.event_type === "reward_spent") {
    const rewardName =
      typeof event.metadata?.reward_name === "string" ? event.metadata.reward_name : null;

    return rewardName || "Reward redemption";
  }

  if (event.source === "manual_entry") {
    return "Manual work block";
  }

  return "Completed focus block";
}

function getEventDetail(event: LedgerEvent) {
  if (event.event_type === "work_earned") {
    const attributionSummary =
      typeof event.metadata?.attribution_summary === "string" ? event.metadata.attribution_summary : null;

    if (attributionSummary) {
      return `${formatTimestamp(event.created_at)} on ${attributionSummary} via ${formatSource(event.source)}`;
    }
  }

  return `${formatTimestamp(event.created_at)} via ${formatSource(event.source)}`;
}

function getDeltaLabel(event: LedgerEvent) {
  if (event.delta_work_blocks !== 0) {
    const count = Math.abs(event.delta_work_blocks);
    const direction = event.delta_work_blocks > 0 ? "+" : "-";

    return `${direction}${count} work block${count === 1 ? "" : "s"}`;
  }

  if (event.delta_reward_blocks !== 0) {
    const count = Math.abs(event.delta_reward_blocks);
    const direction = event.delta_reward_blocks > 0 ? "+" : "-";

    return `${direction}${count} reward block${count === 1 ? "" : "s"}`;
  }

  return "0 blocks";
}

function getDeltaSwatchColor(event: LedgerEvent) {
  return event.event_type === "reward_spent"
    ? rewardPalette.progress
    : timerPalette.work.progress;
}

export function LedgerEventList({
  emptyMessage,
  events,
  maxItems,
}: LedgerEventListProps) {
  const visibleEvents = typeof maxItems === "number" ? events.slice(0, maxItems) : events;

  if (visibleEvents.length === 0) {
    return <div className="px-1 py-4 text-sm text-slate-600">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3">
      {visibleEvents.map((event) => (
        <article
          key={event.id}
          className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-300/60 px-1 py-4 first:border-t-0"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="normal-case tracking-normal" tone="neutral">
                {getEventDisplayType(event)}
              </Badge>
              <span className="text-sm font-medium text-slate-900">{getDeltaLabel(event)}</span>
            </div>
            <div>
              <p className="font-medium text-slate-900">{getEventTitle(event)}</p>
              <p className="mt-1 text-sm text-slate-600">{getEventDetail(event)}</p>
            </div>
          </div>
          <span
            aria-hidden="true"
            className="mt-1 h-3.5 w-3.5 rounded-[4px]"
            style={{ backgroundColor: getDeltaSwatchColor(event) }}
          />
        </article>
      ))}
    </div>
  );
}
