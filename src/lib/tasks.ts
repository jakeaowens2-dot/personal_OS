import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyFocusItem,
  DailyFocusItemWithTask,
  DailyFocusList,
  DailyFocusStatus,
  Task,
  TaskActorType,
  TaskAgentPayload,
  TaskPriority,
  TaskRevision,
  TaskStatus,
} from "@/lib/types";

const TASK_SELECT_COLUMNS = [
  "id",
  "user_id",
  "parent_task_id",
  "title",
  "description",
  "status",
  "priority",
  "area",
  "due_at",
  "source",
  "completed_at",
  "archived_at",
  "last_seen_at",
  "human_summary",
  "agent_payload_json",
  "schema_version",
  "updated_by_actor_type",
  "updated_by_actor_label",
  "last_change_reason",
  "created_at",
  "updated_at",
].join(", ");

const TASK_REVISION_SELECT_COLUMNS = [
  "id",
  "task_id",
  "user_id",
  "action_type",
  "actor_type",
  "actor_label",
  "change_reason",
  "before_json",
  "after_json",
  "created_at",
].join(", ");

const DAILY_FOCUS_LIST_SELECT_COLUMNS = [
  "id",
  "user_id",
  "date",
  "created_at",
  "updated_at",
].join(", ");

const DAILY_FOCUS_ITEM_SELECT_COLUMNS = [
  "id",
  "daily_focus_list_id",
  "task_id",
  "position",
  "focus_status",
  "note",
  "created_at",
  "updated_at",
  `task:tasks!daily_focus_items_task_id_fkey(${TASK_SELECT_COLUMNS})`,
].join(", ");

export const TASK_PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "medium", "low"];
export const TASK_STATUS_ORDER: TaskStatus[] = ["open", "in_progress", "blocked", "completed", "archived"];

export type TaskMutationActor = {
  label?: string;
  type?: TaskActorType;
};

export type TaskCreateInput = {
  actor?: TaskMutationActor;
  area?: string;
  description?: string;
  dueAt?: string | null;
  humanSummary?: string;
  parentTaskId?: string | null;
  priority?: TaskPriority;
  reason?: string;
  source?: string;
  status?: TaskStatus;
  title: string;
  userId: string;
  agentPayload?: TaskAgentPayload;
};

export type TaskUpdateInput = {
  actor?: TaskMutationActor;
  area?: string | null;
  description?: string | null;
  dueAt?: string | null;
  humanSummary?: string | null;
  parentTaskId?: string | null;
  priority?: TaskPriority;
  reason?: string;
  source?: string;
  status?: TaskStatus;
  taskId: string;
  title?: string;
  userId: string;
  agentPayload?: TaskAgentPayload;
};

export type DailyFocusItemUpdateInput = {
  focusStatus?: DailyFocusStatus;
  note?: string | null;
};

const ACTIVE_DAILY_FOCUS_STATUSES: DailyFocusStatus[] = ["planned", "active"];
const HOUSEKEEPING_TASK_SOURCE = "system_housekeeping";

function isSchemaCacheTableError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("schema cache") && normalizedMessage.includes("public.");
}

function enhanceTaskStorageError(message: string, tableLabel: string) {
  if (isSchemaCacheTableError(message)) {
    return `Supabase cannot see the ${tableLabel} tables yet. Apply the latest migrations to refresh the schema cache, then reload the app.`;
  }

  return message;
}

function isSchemaCacheRelationError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("schema cache") || normalizedMessage.includes("could not find");
}

function toErrorMessage(error: unknown, fallback: string) {
  let message = fallback;

  if (error instanceof Error && error.message) {
    message = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    message = error.message;
  } else if (typeof error === "string" && error) {
    message = error;
  }

  return message;
}

export function createDefaultTaskAgentPayload(title: string): TaskAgentPayload {
  return {
    acceptance_criteria: [],
    background: "",
    constraints: [],
    decision_log: [],
    dependencies: [],
    objective: title,
    open_questions: [],
    related_entities: [],
    tags: [],
  };
}

function normalizeTaskStatusFields(status: TaskStatus, currentTask?: Task) {
  const now = new Date().toISOString();

  return {
    archived_at:
      status === "archived" ? currentTask?.archived_at ?? now : null,
    completed_at:
      status === "completed"
        ? currentTask?.completed_at ?? now
        : status === "archived"
          ? currentTask?.completed_at ?? null
          : null,
    last_seen_at: now,
  };
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const leftArchived = left.status === "archived" ? 1 : 0;
    const rightArchived = right.status === "archived" ? 1 : 0;

    if (leftArchived !== rightArchived) {
      return leftArchived - rightArchived;
    }

    const priorityDelta =
      TASK_PRIORITY_ORDER.indexOf(left.priority) - TASK_PRIORITY_ORDER.indexOf(right.priority);

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const statusDelta =
      TASK_STATUS_ORDER.indexOf(left.status) - TASK_STATUS_ORDER.indexOf(right.status);

    if (statusDelta !== 0) {
      return statusDelta;
    }

    return right.updated_at.localeCompare(left.updated_at);
  });
}

function sortDailyFocusItems(items: DailyFocusItemWithTask[]) {
  return [...items].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    const priorityDelta =
      TASK_PRIORITY_ORDER.indexOf(left.task.priority) - TASK_PRIORITY_ORDER.indexOf(right.task.priority);

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.task.updated_at.localeCompare(right.task.updated_at);
  });
}

function getTodayDateKey() {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 10);
}

export async function fetchTasks(
  supabase: SupabaseClient,
  userId: string,
  { includeArchived = true }: { includeArchived?: boolean } = {},
) {
  let query = supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!includeArchived) {
    query = query.neq("status", "archived");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load tasks."), "task"));
  }

  return sortTasks((data ?? []) as unknown as Task[]);
}

export async function fetchTasksByIds(
  supabase: SupabaseClient,
  userId: string,
  taskIds: string[],
) {
  if (taskIds.length === 0) {
    return [] as Task[];
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("user_id", userId)
    .in("id", taskIds);

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load tasks."), "task"));
  }

  return sortTasks((data ?? []) as unknown as Task[]);
}

export async function fetchTaskRevisions(supabase: SupabaseClient, taskId: string, userId: string) {
  const { data, error } = await supabase
    .from("task_revisions")
    .select(TASK_REVISION_SELECT_COLUMNS)
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load task revisions."), "task"));
  }

  return (data ?? []) as unknown as TaskRevision[];
}

export async function createTask(supabase: SupabaseClient, input: TaskCreateInput) {
  const status = input.status ?? "open";
  const statusFields = normalizeTaskStatusFields(status);
  const payload = input.agentPayload ?? createDefaultTaskAgentPayload(input.title);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      area: input.area?.trim() || null,
      description: input.description?.trim() || null,
      due_at: input.dueAt ?? null,
      human_summary: input.humanSummary?.trim() || null,
      agent_payload_json: payload,
      last_change_reason: input.reason?.trim() || "Task created",
      parent_task_id: input.parentTaskId ?? null,
      priority: input.priority ?? "medium",
      source: input.source ?? "manual",
      status,
      title: input.title.trim(),
      updated_by_actor_label: input.actor?.label?.trim() || "Task vault",
      updated_by_actor_type: input.actor?.type ?? "human",
      user_id: input.userId,
      ...statusFields,
    })
    .select(TASK_SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not create the task."), "task"));
  }

  return data as unknown as Task;
}

export async function updateTask(supabase: SupabaseClient, currentTask: Task, input: TaskUpdateInput) {
  const status = input.status ?? currentTask.status;
  const statusFields = normalizeTaskStatusFields(status, currentTask);

  const { data, error } = await supabase
    .from("tasks")
    .update({
      area: input.area === undefined ? currentTask.area : input.area?.trim() || null,
      description:
        input.description === undefined ? currentTask.description : input.description?.trim() || null,
      due_at: input.dueAt === undefined ? currentTask.due_at : input.dueAt,
      human_summary:
        input.humanSummary === undefined
          ? currentTask.human_summary
          : input.humanSummary?.trim() || null,
      agent_payload_json: input.agentPayload ?? currentTask.agent_payload_json,
      last_change_reason: input.reason?.trim() || "Task updated",
      parent_task_id: input.parentTaskId === undefined ? currentTask.parent_task_id : input.parentTaskId,
      priority: input.priority ?? currentTask.priority,
      source: input.source ?? currentTask.source,
      status,
      title: input.title?.trim() || currentTask.title,
      updated_by_actor_label: input.actor?.label?.trim() || "Task vault",
      updated_by_actor_type: input.actor?.type ?? "human",
      ...statusFields,
    })
    .eq("id", input.taskId)
    .eq("user_id", input.userId)
    .select(TASK_SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not update the task."), "task"));
  }

  return data as unknown as Task;
}

export async function completeTask(
  supabase: SupabaseClient,
  currentTask: Task,
  actor: TaskMutationActor,
  userId: string,
) {
  return updateTask(supabase, currentTask, {
    actor,
    reason: "Task completed",
    status: "completed",
    taskId: currentTask.id,
    userId,
  });
}

export async function archiveTask(
  supabase: SupabaseClient,
  currentTask: Task,
  actor: TaskMutationActor,
  userId: string,
) {
  return updateTask(supabase, currentTask, {
    actor,
    reason: "Task archived",
    status: "archived",
    taskId: currentTask.id,
    userId,
  });
}

export async function restoreTask(
  supabase: SupabaseClient,
  currentTask: Task,
  actor: TaskMutationActor,
  userId: string,
) {
  return updateTask(supabase, currentTask, {
    actor,
    reason: "Task restored",
    status: currentTask.completed_at ? "completed" : "open",
    taskId: currentTask.id,
    userId,
  });
}

export async function ensureHousekeepingTask(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("source", HOUSEKEEPING_TASK_SOURCE)
    .maybeSingle();

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load the housekeeping task."), "task"));
  }

  if (data) {
    return data as unknown as Task;
  }

  return createTask(supabase, {
    actor: {
      label: "System",
      type: "system",
    },
    humanSummary: "Reusable catch-all task for chores, admin, and unscheduled housekeeping work.",
    priority: "low",
    reason: "Created default housekeeping task",
    source: HOUSEKEEPING_TASK_SOURCE,
    title: "Chores / housekeeping",
    userId,
  });
}

export async function fetchMostRecentAttributedTaskId(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("work_block_attributions")
    .select("task_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const message = toErrorMessage(error, "Could not load recent work attribution history.");

    // This lookup is only used to preselect a likely task in the attribution UI.
    // If Supabase has not fully exposed the new table yet, fall back to today's
    // focus list instead of blocking the entire attribution flow.
    if (isSchemaCacheRelationError(message)) {
      return null;
    }

    throw new Error(
      enhanceTaskStorageError(message, "work attribution"),
    );
  }

  return (data?.task_id as string | undefined) ?? null;
}

export async function fetchDailyFocusList(
  supabase: SupabaseClient,
  userId: string,
  date = getTodayDateKey(),
) {
  const { data, error } = await supabase
    .from("daily_focus_lists")
    .select(DAILY_FOCUS_LIST_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load the daily focus list."), "daily focus"));
  }

  return (data ?? null) as unknown as DailyFocusList | null;
}

export async function ensureDailyFocusList(
  supabase: SupabaseClient,
  userId: string,
  date = getTodayDateKey(),
) {
  const existingList = await fetchDailyFocusList(supabase, userId, date);

  if (existingList) {
    return existingList;
  }

  const { data, error } = await supabase
    .from("daily_focus_lists")
    .insert({
      date,
      user_id: userId,
    })
    .select(DAILY_FOCUS_LIST_SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not create the daily focus list."), "daily focus"));
  }

  return data as unknown as DailyFocusList;
}

export async function fetchDailyFocusItems(
  supabase: SupabaseClient,
  userId: string,
  {
    date = getTodayDateKey(),
    includeInactive = false,
  }: {
    date?: string;
    includeInactive?: boolean;
  } = {},
) {
  const list = await fetchDailyFocusList(supabase, userId, date);

  if (!list) {
    return [] as DailyFocusItemWithTask[];
  }

  let query = supabase
    .from("daily_focus_items")
    .select(DAILY_FOCUS_ITEM_SELECT_COLUMNS)
    .eq("daily_focus_list_id", list.id)
    .order("position", { ascending: true });

  if (!includeInactive) {
    query = query.in("focus_status", ACTIVE_DAILY_FOCUS_STATUSES);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not load daily focus items."), "daily focus"));
  }

  const focusItems = ((data ?? []) as unknown as DailyFocusItemWithTask[]).filter((item) => {
    if (!item.task) {
      return false;
    }

    if (!includeInactive && (item.task.status === "completed" || item.task.status === "archived")) {
      return false;
    }

    return true;
  });

  return sortDailyFocusItems(focusItems);
}

export async function addTaskToDailyFocus(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  note?: string | null,
) {
  const list = await ensureDailyFocusList(supabase, userId);

  const { data: existingItemData, error: existingItemError } = await supabase
    .from("daily_focus_items")
    .select("id, daily_focus_list_id, task_id, position, focus_status, note, created_at, updated_at")
    .eq("daily_focus_list_id", list.id)
    .eq("task_id", taskId)
    .maybeSingle();

  if (existingItemError) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(existingItemError, "Could not inspect daily focus state."), "daily focus"));
  }

  const { data: positionRows, error: positionError } = await supabase
    .from("daily_focus_items")
    .select("position")
    .eq("daily_focus_list_id", list.id)
    .in("focus_status", ACTIVE_DAILY_FOCUS_STATUSES)
    .order("position", { ascending: false })
    .limit(1);

  if (positionError) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(positionError, "Could not determine daily focus order."), "daily focus"));
  }

  const nextPosition = ((positionRows?.[0]?.position as number | undefined) ?? 0) + 1;

  if (existingItemData) {
    const { error } = await supabase
      .from("daily_focus_items")
      .update({
        focus_status: "planned",
        note: note?.trim() || existingItemData.note || null,
        position: nextPosition,
      })
      .eq("id", existingItemData.id);

    if (error) {
      throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not re-add the task to today."), "daily focus"));
    }
  } else {
    const { error } = await supabase
      .from("daily_focus_items")
      .insert({
        daily_focus_list_id: list.id,
        focus_status: "planned",
        note: note?.trim() || null,
        position: nextPosition,
        task_id: taskId,
      });

    if (error) {
      throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not add the task to today."), "daily focus"));
    }
  }

  return fetchDailyFocusItems(supabase, userId);
}

export async function updateDailyFocusItem(
  supabase: SupabaseClient,
  itemId: string,
  input: DailyFocusItemUpdateInput,
) {
  const updatePayload: Record<string, string | null> = {};

  if (input.focusStatus !== undefined) {
    updatePayload.focus_status = input.focusStatus;
  }

  if (input.note !== undefined) {
    updatePayload.note = input.note?.trim() || null;
  }

  const { error } = await supabase
    .from("daily_focus_items")
    .update(updatePayload)
    .eq("id", itemId);

  if (error) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(error, "Could not update the daily focus item."), "daily focus"));
  }
}

export async function removeTaskFromDailyFocus(
  supabase: SupabaseClient,
  itemId: string,
) {
  return updateDailyFocusItem(supabase, itemId, {
    focusStatus: "deferred",
  });
}

export async function moveDailyFocusItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  direction: "up" | "down",
) {
  const items = await fetchDailyFocusItems(supabase, userId);
  const currentIndex = items.findIndex((item) => item.id === itemId);

  if (currentIndex < 0) {
    return items;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const currentItem = items[currentIndex];
  const targetItem = items[targetIndex];

  const { error: currentError } = await supabase
    .from("daily_focus_items")
    .update({ position: targetItem.position })
    .eq("id", currentItem.id);

  if (currentError) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(currentError, "Could not reorder the daily focus list."), "daily focus"));
  }

  const { error: targetError } = await supabase
    .from("daily_focus_items")
    .update({ position: currentItem.position })
    .eq("id", targetItem.id);

  if (targetError) {
    throw new Error(enhanceTaskStorageError(toErrorMessage(targetError, "Could not reorder the daily focus list."), "daily focus"));
  }

  return fetchDailyFocusItems(supabase, userId);
}
