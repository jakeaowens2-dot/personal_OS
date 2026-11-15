import type { SupabaseClient } from "@supabase/supabase-js";
import { taskRevisionSummary } from "./proposal-presentation";
import { buildPlanningContextPacket } from "../planning";
import { fetchTaskLibraryReview } from "../task-library";
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
  includeTaskHistory = true,
): Promise<AssistantState> {
  const recovery = await client.rpc("assistant_reconcile_turns");
  if (recovery.error) throw new Error(`Assistant recovery unavailable: ${recovery.error.message}`);
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
  const messageIds = (messages as StoredMessage[]).filter((m) => m.role === "assistant").map((m) => m.id);
  const resolved = messageIds.length ? await client.from("assistant_task_proposals")
    .select("*").eq("user_id", userId).in("resolved_message_id", messageIds)
    .neq("status", "pending").order("resolved_at").order("id").limit(1001) : { data: [], error: null };
  if (resolved.error) throw new Error(resolved.error.message);
  if ((resolved.data?.length ?? 0) > 1000) throw new Error("This date exceeds 1,000 task decisions; history was not silently truncated.");
  const proposals = [...(pending.data ?? []), ...(resolved.data ?? [])] as TaskProposal[];
  const taskIds = [...new Set(proposals.map((p) => p.task_id).filter((id): id is string => Boolean(id)))];
  // Fetch in pages so a busy task's history cannot silently consume another's.
  const revisions: { id: string; task_id: string; created_at: string; before_json: Record<string, unknown> | null; after_json: Record<string, unknown> }[] = [];
  for (let offset = 0; includeTaskHistory && taskIds.length; offset += 1000) {
    const page = await client.from("task_revisions").select("id,task_id,created_at,before_json,after_json")
      .eq("user_id", userId).in("task_id", taskIds).order("created_at").order("id").range(offset, offset + 999);
    if (page.error) throw new Error(page.error.message);
    revisions.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) break;
    if (offset >= 9000) throw new Error("Task history needs pagination beyond 10,000 revisions; no history was silently omitted.");
  }
  for (const proposal of proposals) {
    const cutoff = proposal.status === "pending" ? proposal.created_at : proposal.resolved_at ?? proposal.created_at;
    proposal.task_history = revisions.filter((r) => r.task_id === proposal.task_id && r.created_at <= cutoff)
      .map((r) => ({ id: r.id, at: r.created_at, text: taskRevisionSummary(r.before_json, r.after_json) }));
  }
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
  includeTaskLibraryReview = false,
) {
  const state = await loadAssistantState(
    client,
    userId,
    localDate(),
    reviewDate,
    false,
  );
  const [planning, tasks, messages, previousReview, proposalOutcomes] = await Promise.all([
    buildPlanningContextPacket(client, userId),
    client
      .from("tasks")
      .select("id,title,description,status,priority,human_summary,agent_payload_json,due_at,updated_at")
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
    client.from("assistant_task_proposals").select("*").eq("user_id", userId)
      .neq("status", "pending").order("resolved_at", { ascending: false }).limit(10),
  ]);
  if (proposalOutcomes.error) throw new Error(proposalOutcomes.error.message);
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
  const taskLibraryReview = includeTaskLibraryReview
    ? await fetchTaskLibraryReview(client, userId, [
        ...planning.todayFocus.map((item) => item.taskId),
        ...state.proposals.filter((p) => p.status === "pending").flatMap((p) => p.task_id ? [p.task_id] : []),
      ]).catch((error: unknown) => ({ available: false, error: error instanceof Error ? error.message : "Task library review unavailable." }))
    : undefined;
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
    ...(taskLibraryReview ? { taskLibraryReview } : {}),
    planning,
    pendingProposals: state.proposals.filter((p) => p.status === "pending").map((p) => ({ ...p, task_history: undefined })),
    recentProposalOutcomes: proposalOutcomes.data ?? [],
    recentMessages: messages.data?.slice(0, 30).reverse(),
    recentMessagesHaveMore: (messages.data?.length ?? 0) > 30,
    warnings: state.warnings,
  };
}
