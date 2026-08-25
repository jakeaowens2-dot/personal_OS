import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyFocusItemWithTask,
  Task,
  WorkBlockAttribution,
} from "@/lib/types";
import { fetchDailyFocusItems, fetchTasks } from "@/lib/tasks";

// ---------------------------------------------------------------------------
// Planning context — the deterministic, database-backed retrieval layer for
// "let's plan the day." No AI calls; pure Postgres reads. See TASKS 7.1.
// ---------------------------------------------------------------------------

function getTodayDateKey() {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 10);
}

function getYesterdayDateKey() {
  const today = new Date();
  today.setDate(today.getDate() - 1);
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 10);
}

function daysFromNow(isoDate: string) {
  const target = new Date(isoDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------

export type FocusItemSummary = {
  id: string;
  taskId: string;
  title: string;
  priority: string;
  focusStatus: string;
  carriedForward: boolean;
  position: number;
  statusReason: string | null;
};

export type CarryoverItem = {
  focusItemId: string;
  taskId: string;
  title: string;
  priority: string;
  daysCarried: number | null;
};

export type RecentlyCompletedTask = {
  taskId: string;
  title: string;
  priority: string;
  area: string | null;
  completedAt: string;
};

export type DeadlineItem = {
  taskId: string;
  title: string;
  priority: string;
  area: string | null;
  dueAt: string;
  daysUntilDue: number;
};

export type RecentAttribution = {
  attributionId: string;
  workBlockId: string;
  taskId: string;
  title: string;
  attributedMinutes: number;
  earnedAt: string;
};

export type PlanningContextPacketV1 = {
  date: string;
  todayFocus: FocusItemSummary[];
  yesterdayFocus: FocusItemSummary[];
  carryover: CarryoverItem[];
  recentlyCompleted: RecentlyCompletedTask[];
  recentAttributions: RecentAttribution[];
  deadlinePressure: DeadlineItem[];
  backlogPressure: {
    totalOpen: number;
    byPriority: Record<string, number>;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFocusItemSummary(item: DailyFocusItemWithTask): FocusItemSummary {
  return {
    id: item.id,
    taskId: item.task_id,
    title: item.task.title,
    priority: item.task.priority,
    focusStatus: item.focus_status,
    carriedForward: item.carried_forward,
    position: item.position,
    statusReason: item.status_reason,
  };
}

// ---------------------------------------------------------------------------
// Query logic
// ---------------------------------------------------------------------------

async function fetchTodayFocus(
  supabase: SupabaseClient,
  userId: string,
) {
  const items = await fetchDailyFocusItems(supabase, userId, {
    date: getTodayDateKey(),
    includeInactive: true,
  });
  return items.map(toFocusItemSummary);
}

async function fetchYesterdayFocus(
  supabase: SupabaseClient,
  userId: string,
) {
  const items = await fetchDailyFocusItems(supabase, userId, {
    date: getYesterdayDateKey(),
    includeInactive: true,
  });
  return items.map(toFocusItemSummary);
}

async function fetchCarryover(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("daily_focus_items")
    .select("id, task_id, position, focus_status, carried_forward, status_reason, task:tasks!inner(id, title, priority)")
    .eq("user_id", userId)
    .eq("carried_forward", true)
    .in("focus_status", ["planned", "active"])
    .order("position", { ascending: true });

  if (error) {
    return [] as CarryoverItem[];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    task_id: string;
    focus_status: string;
    task: unknown;
  }>).map((row) => ({
    focusItemId: row.id,
    taskId: row.task_id,
    title: (row.task as { title?: string } | undefined)?.title ?? "Unknown",
    priority: (row.task as { priority?: string } | undefined)?.priority ?? "medium",
    daysCarried: null,
  }));
}

async function fetchRecentlyCompleted(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, priority, area, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(10);

  if (error) {
    return [] as RecentlyCompletedTask[];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    title: string;
    priority: string;
    area: string | null;
    completed_at: string;
  }>).map((row) => ({
    taskId: row.id,
    title: row.title,
    priority: row.priority,
    area: row.area,
    completedAt: row.completed_at,
  }));
}

async function fetchRecentAttributions(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("work_block_attributions")
    .select("id, work_block_id, task_id, attributed_minutes, created_at, task:tasks!inner(id, title)")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return [] as RecentAttribution[];
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    work_block_id: string;
    task_id: string;
    attributed_minutes: number;
    created_at: string;
    task: unknown;
  }>;

  return rows.map((row) => ({
    attributionId: row.id,
    workBlockId: row.work_block_id,
    taskId: row.task_id,
    title: (row.task as { title?: string } | undefined)?.title ?? "Unknown",
    attributedMinutes: row.attributed_minutes,
    earnedAt: row.created_at,
  }));
}

async function fetchDeadlinePressure(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, priority, area, due_at")
    .eq("user_id", userId)
    .in("status", ["open", "in_progress"])
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(10);

  if (error) {
    return [] as DeadlineItem[];
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    title: string;
    priority: string;
    area: string | null;
    due_at: string;
  }>;

  return rows
    .filter((row) => daysFromNow(row.due_at) <= 14)
    .map((row) => ({
      taskId: row.id,
      title: row.title,
      priority: row.priority,
      area: row.area,
      dueAt: row.due_at,
      daysUntilDue: daysFromNow(row.due_at),
    }));
}

async function fetchBacklogPressure(
  supabase: SupabaseClient,
  userId: string,
) {
  const tasks = await fetchTasks(supabase, userId, { includeArchived: false });

  const openTasks = tasks.filter((task) =>
    task.status === "open" || task.status === "in_progress" || task.status === "blocked",
  );

  const byPriority: Record<string, number> = {};

  for (const task of openTasks) {
    byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
  }

  return {
    totalOpen: openTasks.length,
    byPriority,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildPlanningContextPacket(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlanningContextPacketV1> {
  const [todayFocus, yesterdayFocus, carryover, recentlyCompleted, recentAttributions, deadlinePressure, backlogPressure] =
    await Promise.all([
      fetchTodayFocus(supabase, userId),
      fetchYesterdayFocus(supabase, userId),
      fetchCarryover(supabase, userId),
      fetchRecentlyCompleted(supabase, userId),
      fetchRecentAttributions(supabase, userId),
      fetchDeadlinePressure(supabase, userId),
      fetchBacklogPressure(supabase, userId),
    ]);

  return {
    date: getTodayDateKey(),
    todayFocus,
    yesterdayFocus,
    carryover,
    recentlyCompleted,
    recentAttributions,
    deadlinePressure,
    backlogPressure,
  };
}