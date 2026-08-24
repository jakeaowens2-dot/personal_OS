import { Badge } from "@/components/ui/Badge";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { getBehaviorTypeLabel } from "@/lib/behaviors";
import { exercisePalette, penaltyPalette, rewardPalette, timerPalette } from "@/lib/timerPalette";
import type { BehaviorEvent, LedgerEvent } from "@/lib/types";

export type ActivityItem =
  | { kind: "ledger"; event: LedgerEvent }
  | { kind: "behavior"; event: BehaviorEvent };

type LedgerEventListProps = {
  emptyMessage: string;
  items: ActivityItem[];
  maxItems?: number;
  onRequestDelete?: (event: LedgerEvent) => void;
  onRequestEdit?: (event: LedgerEvent) => void;
  onRequestDeleteBehavior?: (event: BehaviorEvent) => void;
  onRequestEditBehavior?: (event: BehaviorEvent) => void;
  showDeleteAction?: (event: LedgerEvent) => boolean;
  showEditAction?: (event: LedgerEvent) => boolean;
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

function getBehaviorDisplayType(event: BehaviorEvent) {
  return getBehaviorTypeLabel(event.behavior_type);
}

function getBehaviorDeltaLabel(event: BehaviorEvent) {
  if (event.behavior_type === "exercise") {
    return `+${Math.ceil(event.duration_minutes ?? 0)} min reward`;
  }

  return `-${Math.ceil(event.penalty_minutes ?? 0)} min reward`;
}

function getBehaviorDetail(event: BehaviorEvent) {
  const base = formatTimestamp(event.occurred_at);
  return event.note ? `${base} · ${event.note}` : base;
}

function getBehaviorSwatchColor(event: BehaviorEvent) {
  return event.behavior_type === "exercise" ? exercisePalette.progress : penaltyPalette.progress;
}

export function LedgerEventList({
  emptyMessage,
  items,
  maxItems,
  onRequestDelete,
  onRequestEdit,
  onRequestDeleteBehavior,
  onRequestEditBehavior,
  showDeleteAction,
  showEditAction,
}: LedgerEventListProps) {
  const visibleItems = typeof maxItems === "number" ? items.slice(0, maxItems) : items;

  if (visibleItems.length === 0) {
    return <div className="px-1 py-4 text-sm text-slate-600">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3">
      {visibleItems.map((item) => {
        if (item.kind === "behavior") {
          const event = item.event;

          return (
            <article
              key={`behavior-${event.id}`}
              className="flex items-start justify-between gap-4 border-t border-slate-300/60 px-1 py-4 first:border-t-0"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="normal-case tracking-normal" tone="neutral">
                    {getBehaviorDisplayType(event)}
                  </Badge>
                  <span className="text-sm font-medium text-slate-900">{getBehaviorDeltaLabel(event)}</span>
                </div>
                <p className="text-sm text-slate-600">{getBehaviorDetail(event)}</p>
              </div>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 h-3.5 w-3.5 rounded-[4px]"
                  style={{ backgroundColor: getBehaviorSwatchColor(event) }}
                />
                {onRequestEditBehavior || onRequestDeleteBehavior ? (
                  <PopoverMenu
                    buttonClassName="-mt-1 px-2 py-0.5 text-lg font-semibold leading-none text-slate-500 hover:text-slate-900"
                    label="⋯"
                  >
                    {onRequestEditBehavior ? (
                      <button
                        className="block w-full rounded-[0.6rem] px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/90 hover:text-slate-950"
                        onClick={() => onRequestEditBehavior(event)}
                        type="button"
                      >
                        Edit
                      </button>
                    ) : null}
                    {onRequestDeleteBehavior ? (
                      <button
                        className="block w-full rounded-[0.6rem] px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/90 hover:text-slate-950"
                        onClick={() => onRequestDeleteBehavior(event)}
                        type="button"
                      >
                        Delete
                      </button>
                    ) : null}
                  </PopoverMenu>
                ) : null}
              </div>
            </article>
          );
        }

        const event = item.event;

        return (
          <article
            key={event.id}
            className="flex items-start justify-between gap-4 border-t border-slate-300/60 px-1 py-4 first:border-t-0"
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
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-1 h-3.5 w-3.5 rounded-[4px]"
                style={{ backgroundColor: getDeltaSwatchColor(event) }}
              />
              {onRequestEdit || onRequestDelete ? (
                <PopoverMenu
                  buttonClassName="-mt-1 px-2 py-0.5 text-lg font-semibold leading-none text-slate-500 hover:text-slate-900"
                  label="⋯"
                >
                  {onRequestEdit && (showEditAction ? showEditAction(event) : true) ? (
                    <button
                      className="block w-full rounded-[0.6rem] px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/90 hover:text-slate-950"
                      onClick={() => onRequestEdit(event)}
                      type="button"
                    >
                      Edit
                    </button>
                  ) : null}
                  {onRequestDelete && (showDeleteAction ? showDeleteAction(event) : true) ? (
                    <button
                      className="block w-full rounded-[0.6rem] px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/90 hover:text-slate-950"
                      onClick={() => onRequestDelete(event)}
                      type="button"
                    >
                      Delete
                    </button>
                  ) : null}
                </PopoverMenu>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
