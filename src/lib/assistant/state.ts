// Canonical application state; no Hermes types or session formats cross this boundary.
import { PRODUCTIVITY_TIME_ZONE, wakingDateKey } from "../activity-day";
export const ASSISTANT_TIME_ZONE = PRODUCTIVITY_TIME_ZONE;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MemoryKind = "preferences" | "daily" | "priorities";
export type Disposition =
  | "relevant_next_day"
  | "not_relevant_next_day"
  | "uncertain";
export type MemoryEntry = {
  id: string;
  text: string;
  source_ids: string[];
  updated_at?: string;
  last_confirmed_at?: string | null;
  origin?: "user_stated" | "inferred";
  state?: "active" | "superseded" | "paused" | "resolved";
  scope?: string;
  title?: string;
  rationale?: string;
  disposition?: Disposition;
};
export type MemoryDocument = {
  id: string;
  kind: MemoryKind;
  document_key: string;
  revision: number;
  content_json: { entries: MemoryEntry[] };
  updated_at: string;
};
export type StoredMessage = {
  id: string;
  turn_id: string;
  role: "user" | "assistant" | "system";
  text: string;
  local_date: string;
  created_at: string;
  source_message_id: string | null;
};
export type PlanningTurnInput = {
  id: string;
  kind: "message" | "closeout" | "catch_up";
  text: string;
  morningAction?: "begin" | "continue" | "pause";
  sourceMessageId?: string;
  steeringForTurnId?: string;
  reviewDate?: string;
};
export type MorningPhase =
  | "idle"
  | "awaiting_available_time"
  | "awaiting_brain_dump"
  | "awaiting_company_move"
  | "synthesizing"
  | "paused"
  | "deferred"
  | "complete";
export type DailyInitializationState = {
  phase: MorningPhase;
  availableTimeAnswered: boolean;
  brainDumpAnswered: boolean;
  companyMoveAnswered: boolean;
  completedAt: string | null;
};
export type PlanningTurn = {
  id: string;
  input_json: Omit<PlanningTurnInput, "id">;
  status: "running" | "completed" | "failed";
  local_date: string;
  memory_status: "pending" | "reviewed";
  error: string | null;
  created_at: string;
  updated_at: string;
};
export type TaskPatch = {
  title?: string;
  status?: "open" | "in_progress" | "blocked" | "completed";
  priority?: "low" | "medium" | "high" | "critical";
  human_summary?: string;
  description?: string;
  prerequisite_task_ids?: string[];
};
export type TaskProposal = {
  id: string;
  turn_id: string;
  task_id: string | null;
  expected_updated_at: string | null;
  patch_json: TaskPatch;
  before_json: (Omit<TaskPatch, "description" | "prerequisite_task_ids"> & {
    title: string;
    description?: string | null;
    agent_payload_json?: { dependencies?: string[]; prerequisite_task_ids?: string[] };
  }) | null;
  prerequisite_snapshot_json?: { id: string; title: string; status: string; updated_at: string }[] | null;
  reason: string;
  source_ids: string[];
  status: "pending" | "applied" | "rejected";
  planned_focus_date?: string | null;
  planned_focus_position?: number | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_message_id?: string | null;
  task_history?: { id: string; at: string; text: string }[];
};
export type DailyReview = {
  id: string;
  local_date: string;
  revision: number;
  origin: "closeout" | "catch_up";
  entries_json: MemoryEntry[];
  created_at: string;
};
export type ToolReceipt = {
  id: string;
  turn_id: string;
  tool: string;
  result_json: Record<string, unknown>;
  created_at: string;
};
export type AssistantState = {
  userId: string;
  today: string;
  date: string;
  messages: StoredMessage[];
  documents: MemoryDocument[];
  proposals: TaskProposal[];
  turns: PlanningTurn[];
  receipts: ToolReceipt[];
  reviews: DailyReview[];
  lastActiveDate: string | null;
  dates: string[];
  presentations: { review_id: string; view_date: string }[];
  warnings: string[];
  initialization?: DailyInitializationState;
};

export function localDate(now = new Date()) {
  return wakingDateKey(now);
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function object(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key)))
    throw new Error("Unexpected fields in request.");
  return record;
}
export function string(value: unknown, label: string, max = 6000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} must contain 1–${max} characters.`);
  return value;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error("Invalid record ID.");
  return value;
}
export function sources(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new Error("Provide persisted source message IDs.");
  return [...new Set(value.map(uuid))];
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Expected a current revision number.");
  return value as number;
}
export function choice<T extends string>(
  value: unknown,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new Error(`Expected one of: ${values.join(", ")}.`);
  return value as T;
}
export function parseTurn(value: unknown): PlanningTurnInput {
  const v = object(value, [
    "id",
    "kind",
    "text",
    "morningAction",
    "sourceMessageId",
    "steeringForTurnId",
    "reviewDate",
  ]);
  const kind = choice(v.kind, ["message", "closeout", "catch_up"] as const);
  const morningAction =
    v.morningAction === undefined
      ? undefined
      : choice(v.morningAction, ["begin", "continue", "pause"] as const);
  if (morningAction && kind !== "message")
    throw new Error("Morning controls must be message turns.");
  if (
    v.reviewDate !== undefined &&
    (!validDate(v.reviewDate) || v.reviewDate > localDate())
  )
    throw new Error("Invalid review date.");
  if (kind !== "message" && !v.reviewDate)
    throw new Error("A review needs its date.");
  return {
    id: uuid(v.id),
    kind,
    text: string(v.text, "Message", 8000),
    ...(morningAction ? { morningAction } : {}),
    ...(v.sourceMessageId ? { sourceMessageId: uuid(v.sourceMessageId) } : {}),
    ...(v.steeringForTurnId
      ? { steeringForTurnId: uuid(v.steeringForTurnId) }
      : {}),
    ...(v.reviewDate ? { reviewDate: v.reviewDate as string } : {}),
  };
}
export function parseEntry(kind: MemoryKind, value: unknown): MemoryEntry {
  const fields =
    kind === "daily"
      ? ["disposition", "rationale"]
      : kind === "preferences"
        ? ["origin", "state", "scope"]
        : ["origin", "state", "title", "rationale"];
  const v = object(value, ["id", "text", "source_ids", ...fields]);
  const base = {
    id: uuid(v.id),
    text: string(v.text, "Memory text"),
    source_ids: sources(v.source_ids),
  };
  if (kind === "daily")
    return {
      ...base,
      disposition: choice(v.disposition, [
        "relevant_next_day",
        "not_relevant_next_day",
        "uncertain",
      ] as const),
      rationale: string(v.rationale, "Carry-forward reason", 2000),
    };
  const core = {
    ...base,
    origin: choice(v.origin, ["user_stated", "inferred"] as const),
    state: choice(v.state, [
      "active",
      "superseded",
      "paused",
      "resolved",
    ] as const),
  };
  return kind === "preferences"
    ? { ...core, scope: string(v.scope, "Preference scope", 300) }
    : {
        ...core,
        title: string(v.title, "Priority title", 300),
        rationale: string(v.rationale, "Priority rationale", 2000),
      };
}
export function parseTaskPatch(value: unknown): TaskPatch {
  const v = object(value, ["title", "status", "priority", "human_summary", "description", "prerequisite_task_ids"]);
  const patch: TaskPatch = {};
  if (!Object.keys(v).length)
    throw new Error("An empty proposal changes nothing.");
  if (v.title !== undefined) patch.title = string(v.title, "Task title", 300);
  if (v.status !== undefined)
    patch.status = choice(v.status, [
      "open",
      "in_progress",
      "blocked",
      "completed",
    ] as const);
  if (v.priority !== undefined)
    patch.priority = choice(v.priority, [
      "low",
      "medium",
      "high",
      "critical",
    ] as const);
  if (v.human_summary !== undefined)
    patch.human_summary = string(v.human_summary, "Progress note");
  if (v.description !== undefined) {
    if (typeof v.description !== "string" || v.description.length > 6000)
      throw new Error("Description must be text, at most 6000 characters.");
    patch.description = v.description;
  }
  if (v.prerequisite_task_ids !== undefined) {
    if (!Array.isArray(v.prerequisite_task_ids) || v.prerequisite_task_ids.length > 30)
      throw new Error("Provide at most 30 prerequisite task IDs.");
    patch.prerequisite_task_ids = v.prerequisite_task_ids.map(uuid);
    if (new Set(patch.prerequisite_task_ids).size !== patch.prerequisite_task_ids.length)
      throw new Error("Prerequisite task IDs must be unique.");
  }
  return patch;
}
