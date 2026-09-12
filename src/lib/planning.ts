import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyFocusItemWithTask } from "@/lib/types";
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

export type PlanningContextWarning = {
  code:
    | "today_focus_unavailable"
    | "yesterday_focus_unavailable"
    | "carryover_unavailable"
    | "recently_completed_unavailable"
    | "recent_attributions_unavailable"
    | "deadline_pressure_unavailable"
    | "backlog_pressure_unavailable";
  message: string;
};

export type RepeatedDeferralsContext = {
  status: "not_computed";
  items: [];
};

export type CandidateDailyPlanContext = {
  status: "not_computed";
  primary: [];
  secondary: [];
  intentionalDeferrals: [];
};

export type PlanningContextPacketV1 = {
  schemaVersion: 1;
  generatedAt: string;
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
  repeatedDeferrals: RepeatedDeferralsContext;
  candidateDailyPlan: CandidateDailyPlanContext;
  contextWarnings: PlanningContextWarning[];
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
    .select(
      "id, task_id, position, focus_status, carried_forward, status_reason, created_at, daily_focus_lists!inner(date, user_id), task:tasks!inner(id, title, priority, status)",
    )
    .eq("daily_focus_lists.user_id", userId)
    .eq("carried_forward", true)
    .in("focus_status", ["planned", "active"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error("Could not load unresolved carryover.");
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    task_id: string;
    focus_status: string;
    task: { priority: string; status: string; title: string } | null;
    daily_focus_lists: { date: string; user_id: string } | null;
  }>;
  const newestItemByTask = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    if (!row.task || !row.daily_focus_lists) {
      continue;
    }

    if (row.task.status !== "open" && row.task.status !== "in_progress" && row.task.status !== "blocked") {
      continue;
    }

    const existing = newestItemByTask.get(row.task_id);

    if (!existing || row.daily_focus_lists.date > (existing.daily_focus_lists?.date ?? "")) {
      newestItemByTask.set(row.task_id, row);
    }
  }

  return [...newestItemByTask.values()]
    .map((row) => ({
      focusItemId: row.id,
      taskId: row.task_id,
      title: row.task?.title ?? "Unknown",
      priority: row.task?.priority ?? "medium",
      daysCarried: row.daily_focus_lists ? daysBetweenDateKeys(row.daily_focus_lists.date, getTodayDateKey()) : null,
    }))
    .sort((left, right) => right.daysCarried! - left.daysCarried! || left.title.localeCompare(right.title));
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
    throw new Error("Could not load recently completed tasks.");
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
    throw new Error("Could not load recent work attributions.");
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
    throw new Error("Could not load deadline pressure.");
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
  const [todayFocus, yesterdayFocus, carryover, recentlyCompleted, recentAttributions, deadlinePressure, backlogPressure] = await Promise.all([
    loadPlanningSection("today_focus_unavailable", "Today’s focus could not be loaded.", [], () => fetchTodayFocus(supabase, userId)),
    loadPlanningSection("yesterday_focus_unavailable", "Yesterday’s focus could not be loaded.", [], () => fetchYesterdayFocus(supabase, userId)),
    loadPlanningSection("carryover_unavailable", "Carryover could not be loaded.", [], () => fetchCarryover(supabase, userId)),
    loadPlanningSection("recently_completed_unavailable", "Recently completed tasks could not be loaded.", [], () => fetchRecentlyCompleted(supabase, userId)),
    loadPlanningSection("recent_attributions_unavailable", "Recent work attributions could not be loaded.", [], () => fetchRecentAttributions(supabase, userId)),
    loadPlanningSection("deadline_pressure_unavailable", "Deadline pressure could not be loaded.", [], () => fetchDeadlinePressure(supabase, userId)),
    loadPlanningSection("backlog_pressure_unavailable", "Backlog pressure could not be loaded.", { totalOpen: 0, byPriority: {} }, () => fetchBacklogPressure(supabase, userId)),
  ]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    date: getTodayDateKey(),
    todayFocus: todayFocus.value,
    yesterdayFocus: yesterdayFocus.value,
    carryover: carryover.value,
    recentlyCompleted: recentlyCompleted.value,
    recentAttributions: recentAttributions.value,
    deadlinePressure: deadlinePressure.value,
    backlogPressure: backlogPressure.value,
    repeatedDeferrals: {
      status: "not_computed",
      items: [],
    },
    candidateDailyPlan: {
      status: "not_computed",
      primary: [],
      secondary: [],
      intentionalDeferrals: [],
    },
    contextWarnings: [
      ...todayFocus.warnings,
      ...yesterdayFocus.warnings,
      ...carryover.warnings,
      ...recentlyCompleted.warnings,
      ...recentAttributions.warnings,
      ...deadlinePressure.warnings,
      ...backlogPressure.warnings,
    ],
  };
}

type PlanningSectionResult<T> = {
  value: T;
  warnings: PlanningContextWarning[];
};

async function loadPlanningSection<T>(
  code: PlanningContextWarning["code"],
  message: string,
  fallback: T,
  loader: () => Promise<T>,
): Promise<PlanningSectionResult<T>> {
  try {
    return {
      value: await loader(),
      warnings: [],
    };
  } catch {
    return {
      value: fallback,
      warnings: [{ code, message }],
    };
  }
}

function daysBetweenDateKeys(earlierDate: string, laterDate: string) {
  const [earlierYear, earlierMonth, earlierDay] = earlierDate.split("-").map(Number);
  const [laterYear, laterMonth, laterDay] = laterDate.split("-").map(Number);
  const earlierUtc = Date.UTC(earlierYear, earlierMonth - 1, earlierDay);
  const laterUtc = Date.UTC(laterYear, laterMonth - 1, laterDay);

  return Math.max(0, Math.floor((laterUtc - earlierUtc) / (1000 * 60 * 60 * 24)));
}
