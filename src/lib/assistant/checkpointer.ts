import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const CHECKPOINT_SCHEMA = "assistant_langgraph";

type CheckpointerGlobal = typeof globalThis & {
  __personalOsAssistantCheckpointer?: PostgresSaver;
  __personalOsAssistantCheckpointerSetup?: Promise<void>;
};

function connectionString() {
  const value = process.env.SUPABASE_URL_SESSION_POOLER;
  if (!value)
    throw new Error(
      "Durable assistant flow is unavailable. Configure SUPABASE_URL_SESSION_POOLER.",
    );
  return value;
}

export async function getAssistantCheckpointer() {
  const shared = globalThis as CheckpointerGlobal;
  if (!shared.__personalOsAssistantCheckpointer) {
    shared.__personalOsAssistantCheckpointer = PostgresSaver.fromConnString(
      connectionString(),
      { schema: CHECKPOINT_SCHEMA },
    );
  }
  if (!shared.__personalOsAssistantCheckpointerSetup) {
    shared.__personalOsAssistantCheckpointerSetup =
      shared.__personalOsAssistantCheckpointer.setup();
  }
  await shared.__personalOsAssistantCheckpointerSetup;
  return shared.__personalOsAssistantCheckpointer;
}

export function assistantGraphThreadId(userId: string, date: string) {
  return `personal-os:${userId}:${date}`;
}

