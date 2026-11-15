import { randomUUID } from "node:crypto";
import {
  isLocalAssistantRequest,
  MAX_REQUEST_BYTES,
} from "@/lib/assistant/contracts";
import { runHermes } from "@/lib/assistant/hermes";
import { withAssistantRun } from "@/lib/assistant/turn-runtime";
import { getAssistantCheckpointer } from "@/lib/assistant/checkpointer";
import {
  loadDailyInitialization,
  runConversationGraph,
  type AgentFlowContext,
} from "@/lib/assistant/conversation-graph";
import {
  buildAssistantContext,
  loadAssistantState,
} from "@/lib/assistant/store";
import {
  constrainPlanningToolsForFlow,
  createPlanningToolHandler,
  rpc,
} from "@/lib/assistant/tools";
import {
  localDate,
  object,
  parseTurn,
  uuid,
  validDate,
} from "@/lib/assistant/state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const enabled = (request: Request) =>
  isLocalAssistantRequest(
    request,
    process.env.PERSONAL_ASSISTANT_LOCAL === "1" && !process.env.VERCEL,
  );
const errorResponse = (error: unknown, status = 503) =>
  Response.json(
    {
      error: error instanceof Error ? error.message : "Assistant unavailable.",
    },
    { status, headers },
  );
async function session() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  const user = error || !data.user?.email || data.user.is_anonymous ? null : data.user;
  return { client, user };
}

async function stateWithInitialization(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  date?: string,
) {
  const state = await loadAssistantState(client, userId, date);
  const checkpointer = await getAssistantCheckpointer();
  state.initialization = await loadDailyInitialization({
    checkpointer,
    userId,
    date: state.date,
  });
  return state;
}

export async function GET(request: Request) {
  if (!enabled(request))
    return errorResponse(
      new Error("Start npm run assistant and open its localhost address."),
      404,
    );
  try {
    const { client, user } = await session();
    if (!user)
      return errorResponse(
        new Error(
          "Sign in on Personal OS Home at this localhost address to use durable planning.",
        ),
        401,
      );
    const url = new URL(request.url);
    if (url.searchParams.has("source")) {
      const { data, error } = await client
        .from("assistant_messages")
        .select("id,role,text,local_date,created_at")
        .eq("user_id", user.id)
        .eq("id", uuid(url.searchParams.get("source")))
        .single();
      if (error) throw new Error("That source is unavailable.");
      return Response.json({ source: data }, { headers });
    }
    if (url.searchParams.has("revisions")) {
      const { data, error } = await client
        .from("assistant_memory_revisions")
        .select("revision,reason,source_ids,content_json,created_at")
        .eq("user_id", user.id)
        .eq("document_id", uuid(url.searchParams.get("revisions")))
        .order("revision", { ascending: false })
        .limit(101);
      if (error) throw new Error(error.message);
      return Response.json(
        { revisions: data?.slice(0, 100), has_more: (data?.length ?? 0) > 100 },
        { headers },
      );
    }
    const date = url.searchParams.get("date") || localDate();
    if (!validDate(date) || date > localDate())
      return errorResponse(new Error("Invalid history date."), 400);
    const state = await stateWithInitialization(client, user.id, date);
    let connection;
    let runtimeError;
    if (url.searchParams.get("check") === "1") {
      try {
        connection = (
          await runHermes({ userId: user.id, signal: request.signal })
        ).connection;
      } catch (error) {
        runtimeError =
          error instanceof Error ? error.message : "Hermes unavailable.";
      }
    }
    return Response.json({ state, connection, runtimeError }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!enabled(request))
    return errorResponse(
      new Error("The assistant accepts same-origin local requests only."),
      403,
    );
  try {
    const { client, user } = await session();
    if (!user)
      return errorResponse(
        new Error("Sign in on Home to save assistant work."),
        401,
      );
    const reader = request.body?.getReader();
    if (!reader) return errorResponse(new Error("Missing request."), 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return errorResponse(new Error("Request too large."), 413);
      }
      chunks.push(value);
    }
    let body: Record<string, unknown>;
    try {
      body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")), [
        "action",
        "input",
        "id",
        "apply",
      ]);
    } catch (error) {
      return errorResponse(error, 400);
    }
    if (body.action === "resolve") {
      if (typeof body.apply !== "boolean")
        return errorResponse(new Error("Choose apply or reject."), 400);
      const proposal = await rpc(client, "assistant_resolve_proposal", {
        p_id: uuid(body.id),
        p_apply: body.apply,
      });
      return Response.json(
        { proposal, state: await stateWithInitialization(client, user.id) },
        { headers },
      );
    }
    if (body.action === "present") {
      await rpc(client, "assistant_present_review", { p_id: uuid(body.id) });
      return Response.json({ presented: true }, { headers });
    }
    if (body.action !== "turn")
      return errorResponse(new Error("Unknown assistant action."), 400);
    let input;
    try {
      input = parseTurn(body.input);
    } catch (error) {
      return errorResponse(error, 400);
    }
    const { id, ...payload } = input;
    return await withAssistantRun(user.id, input.kind, request.signal, async (signal) => {
      const lease = randomUUID();
      const turn = await rpc(client, "assistant_begin_turn", {
        p_id: id,
        p_input: payload,
        p_lease: lease,
      });
      if (turn.status === "completed")
        return Response.json(
          { state: await stateWithInitialization(client, user.id) },
          { headers },
        );
      let finished = false;
      let runningAgent: ReturnType<typeof runHermes> | undefined;
      try {
        const { data: runtimeSession, error: sessionError } = await client
          .from("assistant_sessions")
          .select("runtime_session_id")
          .eq("user_id", user.id)
          .single();
        if (sessionError) throw new Error(sessionError.message);
        const context = (includeTaskLibraryReview = false) =>
          buildAssistantContext(client, user.id, id, input.reviewDate, includeTaskLibraryReview);
        const handler = createPlanningToolHandler({
          client,
          userId: user.id,
          turnId: id,
          leaseId: lease,
          context,
          reviewDate: input.reviewDate,
          reviewOrigin:
            input.kind === "message"
              ? undefined
              : input.kind === "closeout"
                ? "closeout"
                : "catch_up",
        });
        const source = await client
          .from("assistant_messages")
          .select("id")
          .eq("user_id", user.id)
          .eq("turn_id", id)
          .in("role", ["user", "system"])
          .single();
        if (source.error) throw new Error(source.error.message);
        const checkpointer = await getAssistantCheckpointer();
        const result = await runConversationGraph({
          checkpointer,
          userId: user.id,
          date: turn.local_date,
          event: {
            turnId: id,
            messageId: source.data.id,
            ...payload,
          },
          dependencies: {
            runAgent: async (event, flow: AgentFlowContext) => {
              const tool = constrainPlanningToolsForFlow(
                handler.handle,
                flow.purpose,
              );
              const currentApplicationState = await context(flow.purpose === "morning_synthesis");
              // Graph cancellation can return before an async node unwinds.
              // Do not launch a late worker after its context read completes.
              signal.throwIfAborted();
              runningAgent = runHermes({
                userId: user.id,
                sessionId: runtimeSession.runtime_session_id,
                turnId: event.turnId,
                prompt: {
                  currentApplicationState,
                  request: payload,
                  dailyInitialization: flow,
                  sourceTurnId: event.turnId,
                },
                tool,
                signal,
              });
              const agentResult = await runningAgent;
              if (!agentResult.answer)
                throw new Error("Hermes returned no assistant response.");
              return {
                answer: agentResult.answer,
                reviewed: agentResult.reviewed === true,
              };
            },
          },
          signal,
        });
        await rpc(client, "assistant_finish_turn", {
          p_turn: id,
          p_lease: lease,
          p_answer: result.answer,
          p_error: null,
          p_reviewed: result.reviewed === true,
        });
        finished = true;
        return Response.json(
          {
            state: await stateWithInitialization(client, user.id),
          },
          { headers },
        );
      } catch (error) {
        // Drain the actual child process, not merely the graph's abort race,
        // before withAssistantRun admits another loop into the same profile.
        await runningAgent?.catch(() => undefined);
        if (!finished) {
          try {
            await rpc(client, "assistant_finish_turn", {
              p_turn: id,
              p_lease: lease,
              p_answer: null,
              p_error: error instanceof Error ? error.message : "Reply failed",
              p_reviewed: false,
            });
          } catch {
            /* A lost lease must not clear a successor's turn. The next refresh shows durable state. */
          }
        }
        throw error;
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
