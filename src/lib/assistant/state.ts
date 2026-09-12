// Canonical application state; no Hermes types or session formats cross this boundary.
export const ASSISTANT_TIME_ZONE = "America/Chicago";
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
  sourceMessageId?: string;
  reviewDate?: string;
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
};
export type TaskProposal = {
  id: string;
  turn_id: string;
  task_id: string | null;
  expected_updated_at: string | null;
  patch_json: TaskPatch;
  before_json: (TaskPatch & { title: string }) | null;
  reason: string;
  source_ids: string[];
  status: "pending" | "applied" | "rejected";
  created_at: string;
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
};

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ASSISTANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
    "sourceMessageId",
    "reviewDate",
  ]);
  const kind = choice(v.kind, ["message", "closeout", "catch_up"] as const);
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
    ...(v.sourceMessageId ? { sourceMessageId: uuid(v.sourceMessageId) } : {}),
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
  const v = object(value, ["title", "status", "priority", "human_summary"]);
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
  return patch;
}
