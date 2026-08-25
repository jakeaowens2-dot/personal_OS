export type TaskAgentPayloadV1 = {
  schema_version: number;
  summary: string;
  context: string;
  next_action: string;
  known_blockers: string[];
  source_notes: string;
  tags: string[];
  estimated_remaining_blocks: number | null;
  last_agent_reviewed_at: string | null;
};

const DEFAULT_PAYLOAD_V1: TaskAgentPayloadV1 = {
  schema_version: 1,
  summary: "",
  context: "",
  next_action: "",
  known_blockers: [],
  source_notes: "",
  tags: [],
  estimated_remaining_blocks: null,
  last_agent_reviewed_at: null,
};

// Parse a raw agent_payload_json (from the tasks table) into a typed v1 payload.
// Tolerates null, malformed, missing, and older-schema payloads — if the payload
// can't be parsed or lacks a schema_version of 1, it falls back to a default
// empty v1 object so downstream reads never crash.
export function parseAgentPayloadV1(raw: unknown): TaskAgentPayloadV1 {
  if (raw == null || typeof raw !== "object") {
    return { ...DEFAULT_PAYLOAD_V1 };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schema_version !== "number" || obj.schema_version !== 1) {
    return { ...DEFAULT_PAYLOAD_V1 };
  }

  return {
    schema_version: 1,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    context: typeof obj.context === "string" ? obj.context : "",
    next_action: typeof obj.next_action === "string" ? obj.next_action : "",
    known_blockers: Array.isArray(obj.known_blockers)
      ? obj.known_blockers.filter((b): b is string => typeof b === "string")
      : [],
    source_notes: typeof obj.source_notes === "string" ? obj.source_notes : "",
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string") : [],
    estimated_remaining_blocks:
      typeof obj.estimated_remaining_blocks === "number" ? obj.estimated_remaining_blocks : null,
    last_agent_reviewed_at:
      typeof obj.last_agent_reviewed_at === "string" ? obj.last_agent_reviewed_at : null,
  };
}

// Create a fresh v1 payload from partial values.
export function createAgentPayloadV1(
  input: Partial<Omit<TaskAgentPayloadV1, "schema_version">>,
): TaskAgentPayloadV1 {
  return {
    ...DEFAULT_PAYLOAD_V1,
    ...input,
    schema_version: 1,
  };
}