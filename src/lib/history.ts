import type { SupabaseClient } from "@supabase/supabase-js";
import type { BehaviorEvent, LedgerEvent } from "@/lib/types";

export type ActivityItem =
  | { kind: "ledger"; event: LedgerEvent }
  | { kind: "behavior"; event: BehaviorEvent };

export type ActivityHistoryPage = {
  items: ActivityItem[];
  nextCursor: string | null;
};

const LEDGER_COLUMNS = [
  "id",
  "user_id",
  "event_type",
  "delta_work_blocks",
  "delta_reward_blocks",
  "source",
  "metadata",
  "created_at",
].join(", ");

const BEHAVIOR_COLUMNS = [
  "id",
  "user_id",
  "behavior_type",
  "occurred_at",
  "duration_minutes",
  "penalty_minutes",
  "note",
  "created_at",
].join(", ");

function getTimestamp(item: ActivityItem) {
  return item.kind === "ledger" ? item.event.created_at : item.event.occurred_at;
}

export async function fetchActivityHistoryPage(
  supabase: SupabaseClient,
  userId: string,
  { before, pageSize = 30 }: { before?: string | null; pageSize?: number } = {},
): Promise<ActivityHistoryPage> {
  let ledgerQuery = supabase
    .from("ledger_events")
    .select(LEDGER_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);
  let behaviorQuery = supabase
    .from("behavior_events")
    .select(BEHAVIOR_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(pageSize + 1);

  if (before) {
    ledgerQuery = ledgerQuery.lt("created_at", before);
    behaviorQuery = behaviorQuery.lt("occurred_at", before);
  }

  const [ledgerResult, behaviorResult] = await Promise.all([ledgerQuery, behaviorQuery]);

  if (ledgerResult.error) {
    throw new Error(ledgerResult.error.message || "Could not load ledger history.");
  }

  if (behaviorResult.error) {
    throw new Error(behaviorResult.error.message || "Could not load behavior history.");
  }

  const merged: ActivityItem[] = [
    ...((ledgerResult.data ?? []) as unknown as LedgerEvent[]).map(
      (event): ActivityItem => ({ kind: "ledger", event }),
    ),
    ...((behaviorResult.data ?? []) as unknown as BehaviorEvent[]).map(
      (event): ActivityItem => ({ kind: "behavior", event }),
    ),
  ].sort((left, right) => getTimestamp(right).localeCompare(getTimestamp(left)));

  const items = merged.slice(0, pageSize);

  return {
    items,
    nextCursor: merged.length > pageSize && items.length > 0
      ? getTimestamp(items[items.length - 1])
      : null,
  };
}
