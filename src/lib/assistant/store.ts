import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanningContextPacket } from "../planning";
import {
  ASSISTANT_TIME_ZONE,
  localDate,
  type AssistantState,
  type DailyReview,
  type MemoryDocument,
  type PlanningTurn,
  type StoredMessage,
  type TaskProposal,
  type ToolReceipt,
} from "./state";

export async function loadAssistantState(
  client: SupabaseClient,
  userId: string,
  date = localDate(),
  extraDate?: string,
): Promise<AssistantState> {
  const today = localDate();
  const previous = await client
    .from("assistant_messages")
    .select("local_date")
    .eq("user_id", userId)
    .eq("role", "user")
    .lt("local_date", today)
    .order("local_date", { ascending: false })
    .limit(1);
  if (previous.error)
    throw new Error(
      `Assistant storage unavailable: ${previous.error.message}. Apply the assistant daily-planning migration.`,
    );
  const lastActiveDate = previous.data?.[0]?.local_date ?? null;
  const relevantDates = [
    ...new Set(
      [date, today, lastActiveDate, extraDate].filter((d): d is string =>
        Boolean(d),
      ),
    ),
  ];
  const results = await Promise.all([
    client
      .from("assistant_messages")
      .select("id,turn_id,role,text,local_date,created_at,source_message_id")
      .eq("user_id", userId)
      .eq("local_date", date)
      .order("created_at")
      .order("id")
      .limit(1001),
    client
      .from("assistant_memory_documents")
      .select("id,kind,document_key,revision,content_json,updated_at")
      .eq("user_id", userId)
      .or(`kind.neq.daily,document_key.in.(${relevantDates.join(",")})`)
      .order("document_key", { ascending: false }),
    client
      .from("assistant_task_proposals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(201),
    client
      .from("assistant_turns")
      .select(
        "id,input_json,status,local_date,memory_status,error,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(101),
    client
      .from("assistant_tool_receipts")
      .select("id,turn_id,tool,result_json,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(201),
    client
      .from("assistant_daily_reviews")
      .select("id,local_date,revision,origin,entries_json,created_at")
      .eq("user_id", userId)
      .in("local_date", relevantDates)
      .order("created_at", { ascending: false })
      .limit(1000),
    client
      .from("assistant_review_presentations")
      .select("review_id,view_date")
      .eq("user_id", userId)
      .eq("view_date", today),
    client.rpc("assistant_active_dates"),
  ]);
  for (const result of results)
    if (result.error)
      throw new Error(
        `Assistant storage unavailable: ${result.error.message}. Apply the assistant daily-planning migration if it has not been installed.`,
      );
  const [
    messages,
    documents,
    recentProposals,
    turns,
    receipts,
    reviews,
    presentations,
    days,
  ] = results.map((r) => r.data ?? []);
  const pending = await client
    .from("assistant_task_proposals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (pending.error) throw new Error(pending.error.message);
  if ((pending.data?.length ?? 0) >= 1000)
    throw new Error(
      "Review pending proposals before the queue exceeds 1,000; no pending item was silently omitted.",
    );
  const proposals = [
    ...(pending.data ?? []),
    ...recentProposals.filter((p: TaskProposal) => p.status !== "pending"),
  ];
  const dates = days as string[];
  const warnings: string[] = [];
  if (reviews.length >= 1000)
    throw new Error(
      "Review history needs pagination; no old review is silently hidden.",
    );
  if (messages.length >= 1000)
    throw new Error(
      "This date reaches the 1,000-message view limit. Use source-history search; the daily view is not silently truncated.",
    );
  if (recentProposals.length > 200)
    warnings.push(
      "Showing recent resolved proposals plus every pending proposal. Older task changes remain in the task vault.",
    );
  return {
    userId,
    today,
    date,
    messages: messages as StoredMessage[],
    documents: documents as MemoryDocument[],
    proposals: proposals as TaskProposal[],
    turns: turns.slice(0, 100) as PlanningTurn[],
    receipts: receipts.slice(0, 200) as ToolReceipt[],
    reviews: reviews as DailyReview[],
    presentations: presentations as AssistantState["presentations"],
    dates,
    lastActiveDate,
    warnings,
  };
}

export async function buildAssistantContext(
  client: SupabaseClient,
  userId: string,
  turnId: string,
  reviewDate?: string,
) {
  const state = await loadAssistantState(
    client,
    userId,
    localDate(),
    reviewDate,
  );
  const [planning, tasks, messages, previousReview] = await Promise.all([
    buildPlanningContextPacket(client, userId),
    client
      .from("tasks")
      .select("id,title,status,priority,human_summary,due_at,updated_at")
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(61),
    client
      .from("assistant_messages")
      .select("id,turn_id,role,text,local_date,created_at,source_message_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(31),
    client
      .from("assistant_daily_reviews")
      .select("id,local_date,revision,origin,entries_json,created_at")
      .eq("user_id", userId)
      .lt("local_date", reviewDate || state.today)
      .order("local_date", { ascending: false })
      .order("revision", { ascending: false })
      .limit(1),
  ]);
  if (previousReview.error) throw new Error(previousReview.error.message);
  if (tasks.error || messages.error)
    throw new Error(tasks.error?.message ?? messages.error?.message);
  const active = (d: MemoryDocument) => ({
    ...d,
    content_json: {
      entries: d.content_json.entries.filter(
        (e) => e.state === "active" && e.origin === "user_stated",
      ),
    },
  });
  const homes = state.documents.filter((d) => d.kind !== "daily");
  const dailyDates = new Set(
    [state.today, state.lastActiveDate, reviewDate].filter(Boolean),
  );
  return {
    schemaVersion: 1,
    date: state.today,
    timeZone: ASSISTANT_TIME_ZONE,
    turnId,
    reviewDate: reviewDate ?? null,
    preferences: homes.filter((d) => d.kind === "preferences").map(active),
    priorities: homes.filter((d) => d.kind === "priorities").map(active),
    // Full current homes are also available for corrections, including tentative/superseded entries.
    memoryHomes: homes,
    dailyNotes: state.documents.filter(
      (d) => d.kind === "daily" && dailyDates.has(d.document_key),
    ),
    lastActiveDate: state.lastActiveDate,
    previousHandoff: previousReview.data?.[0] ?? null,
    carryForwardReviews: state.reviews.filter((r) =>
      dailyDates.has(r.local_date),
    ),
    tasks: tasks.data?.slice(0, 60),
    tasksHaveMore: (tasks.data?.length ?? 0) > 60,
    planning,
    pendingProposals: state.proposals.filter((p) => p.status === "pending"),
    recentProposalOutcomes: state.proposals
      .filter((p) => p.status !== "pending")
      .slice(0, 10),
    recentMessages: messages.data?.slice(0, 30).reverse(),
    recentMessagesHaveMore: (messages.data?.length ?? 0) > 30,
    warnings: state.warnings,
  };
}
