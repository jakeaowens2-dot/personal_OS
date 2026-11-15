import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "./types";
import { fetchTasks } from "./tasks";

export type LibraryTask = Task & { last_used_at: string | null };
export type LibrarySort = "recent_activity" | "last_used" | "newest";
const timestamp = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};
const recentActivity = (task: LibraryTask) => Math.max(timestamp(task.created_at), timestamp(task.last_used_at));

export function selectLibraryTasks(tasks: LibraryTask[], {
  query = "", sort = "recent_activity", includeCompleted = false,
}: { query?: string; sort?: LibrarySort; includeCompleted?: boolean } = {}) {
  const search = query.trim().toLowerCase();
  return tasks.filter((task) => task.status !== "archived" && task.source !== "system_housekeeping"
    && (includeCompleted || task.status !== "completed")
    && (!search || task.title.toLowerCase().includes(search)))
    .sort((a, b) => {
      const value = (task: LibraryTask) => sort === "newest" ? timestamp(task.created_at)
        : sort === "last_used" ? timestamp(task.last_used_at) : recentActivity(task);
      return value(b) - value(a) || timestamp(b.created_at) - timestamp(a.created_at) || a.id.localeCompare(b.id);
    });
}

export async function fetchTaskLibrary(client: SupabaseClient, userId: string): Promise<LibraryTask[]> {
  const [tasks, activity] = await Promise.all([
    fetchTasks(client, userId, { includeArchived: false }),
    (async () => {
      const rows: { task_id: string; last_used_at: string | null }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.rpc("task_library_activity").order("task_id").range(offset, offset + 999);
        if (error) throw new Error(`Task activity unavailable: ${error.message}`);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) return rows;
      }
    })(),
  ]);
  const byId = new Map(activity.map((row) => [row.task_id, row.last_used_at]));
  return tasks.map((task) => ({ ...task, last_used_at: byId.get(task.id) ?? null }));
}

type ArchiveDecision = { task_id: string | null; expected_updated_at: string | null; status: string };

export function buildTaskLibraryReview(tasks: LibraryTask[], {
  now = new Date(), protectedTaskIds = [], decisions = [], limit = 3,
}: { now?: Date; protectedTaskIds?: string[]; decisions?: ArchiveDecision[]; limit?: number } = {}) {
  const day = 86_400_000;
  const protectedIds = new Set([
    ...protectedTaskIds,
    ...tasks.filter((task) => task.status !== "completed" && task.status !== "archived")
      .flatMap((task) => [
        ...(task.parent_task_id ? [task.parent_task_id] : []),
        ...(task.agent_payload_json?.prerequisite_task_ids ?? []),
      ]),
  ]);
  const candidates = tasks.flatMap((task) => {
    if (task.source === "system_housekeeping" || task.status === "archived" || protectedIds.has(task.id)) return [];
    // A rejected archive remains dismissed until the task itself changes.
    if (decisions.some((decision) => decision.task_id === task.id &&
      (decision.status === "pending" || timestamp(decision.expected_updated_at) === timestamp(task.updated_at)))) return [];
    const lastActivity = Math.max(recentActivity(task), timestamp(task.updated_at), timestamp(task.completed_at));
    const inactiveDays = Math.floor((now.getTime() - lastActivity) / day);
    const completed = task.status === "completed";
    if (inactiveDays < (completed ? 7 : 30)) return [];
    return [{ task, inactiveDays, reason: completed ? "completed_history" as const : "inactive_needs_review" as const }];
  }).sort((a, b) => Number(b.reason === "completed_history") - Number(a.reason === "completed_history")
    || b.inactiveDays - a.inactiveDays || a.task.id.localeCompare(b.task.id));
  return {
    available: true, scannedCount: tasks.length, candidateCount: candidates.length,
    hasMore: candidates.length > limit, candidates: candidates.slice(0, limit),
    policy: "Review candidates only. Inactivity is not proof of irrelevance or completion. Archive proposals require user acceptance; preserve work history.",
  };
}

export async function fetchTaskLibraryReview(client: SupabaseClient, userId: string, protectedTaskIds: string[]) {
  const [tasks, decisions] = await Promise.all([
    fetchTaskLibrary(client, userId),
    (async () => {
      const rows: ArchiveDecision[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from("assistant_task_proposals")
          .select("task_id,expected_updated_at,status").eq("user_id", userId)
          .in("status", ["pending", "rejected"]).contains("patch_json", { status: "archived" })
          .order("id").range(offset, offset + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) return rows;
      }
    })(),
  ]);
  return buildTaskLibraryReview(tasks, { protectedTaskIds, decisions });
}
