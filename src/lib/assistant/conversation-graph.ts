import {
  Annotation,
  Command,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { assistantGraphThreadId } from "./checkpointer";
import type {
  DailyInitializationState,
  MorningPhase,
  PlanningTurnInput,
} from "./state";

export type ConversationEvent = Omit<PlanningTurnInput, "id"> & {
  turnId: string;
  messageId: string;
};

type MorningAnswer = {
  text: string;
  sourceMessageId: string;
};

export type AgentFlowContext = {
  purpose: "normal" | "review" | "morning_transition" | "morning_synthesis";
  phase: MorningPhase;
  offerMorningOpening: boolean;
  morningTransition?: {
    requiredNextQuestion: string;
  };
  morning?: {
    availableTime: MorningAnswer;
    brainDump: MorningAnswer;
    companyMove: MorningAnswer;
  };
  steering?: {
    originalTurnId: string;
    originalText: string;
    direction: string;
  };
};

export type AgentFlowResult = {
  answer: string;
  reviewed: boolean;
};

type ConversationGraphDependencies = {
  runAgent: (
    event: ConversationEvent,
    flow: AgentFlowContext,
  ) => Promise<AgentFlowResult>;
};

const WAITING_QUESTION: Record<
  Extract<
    MorningPhase,
    | "awaiting_available_time"
    | "awaiting_brain_dump"
    | "awaiting_company_move"
  >,
  string
> = {
  awaiting_available_time:
    "How much time do you have available for the day? Tell me any obligations you have away from the desk.",
  awaiting_brain_dump:
    "Now, do a brain dump. What is on your mind? Don’t prioritize it yet—just give me what is competing for attention.",
  awaiting_company_move:
    "What would you be able to do today that moves the company forward the most? Give me the highest-leverage outcome as you currently see it.",
};

const GraphState = Annotation.Root({
  schemaVersion: Annotation<number>(),
  localDate: Annotation<string>(),
  phase: Annotation<MorningPhase>(),
  resumePhase: Annotation<MorningPhase | null>(),
  event: Annotation<ConversationEvent | null>(),
  steeringFrom: Annotation<ConversationEvent | null>(),
  assistantMessage: Annotation<string>(),
  availableTime: Annotation<MorningAnswer | null>(),
  brainDump: Annotation<MorningAnswer | null>(),
  companyMove: Annotation<MorningAnswer | null>(),
  requiredQuestion: Annotation<string | null>(),
  completedAt: Annotation<string | null>(),
  lastProcessedTurnId: Annotation<string | null>(),
  lastProcessedReviewed: Annotation<boolean>(),
});

type ConversationGraphState = typeof GraphState.State;

const affirmative = (text: string) => {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.!?]+$/g, "");
  return (
    (normalized.length <= 100 &&
      /^(yes|yep|yeah|sure|okay|ok|let'?s (begin|start|do it|go)|begin|start|start the morning|begin the morning|let'?s continue( the morning( opening| ritual)?)?|continue the morning( opening| ritual)?)( now| please)?$/.test(
        normalized,
      )) ||
    (normalized.length <= 140 &&
      /^(i )?(want to|would like to|am ready to) (go through|begin|start|do) (our |the |my )?(morning (opening|ritual|flow)|daily (opening|initialization|flow))( now| please)?$/.test(
        normalized,
      ))
  );
};

const decline = (text: string) => {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.!?]+$/g, "");
  return (
    normalized.length <= 100 &&
    /^(no|nope|not now|not yet|later|skip|skip it|pause|stop|let'?s pause|maybe later)( please| for now)?$|^pause (the )?morning (opening|ritual)( for now)?$/.test(
      normalized,
    )
  );
};

function answer(event: ConversationEvent): MorningAnswer {
  return { text: event.text.trim(), sourceMessageId: event.messageId };
}

function requireEvent(state: ConversationGraphState) {
  if (!state.event) throw new Error("The conversation graph has no user event.");
  return state.event;
}

function withRequiredQuestion(response: string, question: string) {
  const conversationalResponse = (
    response
      .split(question)
      .join("")
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []
  )
    .filter((sentence) => !sentence.trimEnd().endsWith("?"))
    .join("")
    .trim();
  return conversationalResponse
    ? `${conversationalResponse}\n\n${question}`
    : question;
}

function buildConversationGraph(
  checkpointer: BaseCheckpointSaver,
  dependencies: ConversationGraphDependencies,
) {
  const dispatch = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    if (event.kind === "closeout" || event.kind === "catch_up")
      return new Command({ goto: "agent" });
    if (
      (event.morningAction === "pause" || decline(event.text)) &&
      state.phase !== "complete"
    )
      return new Command({ goto: "defer_morning" });
    if (
      (state.phase === "idle" ||
        state.phase === "deferred" ||
        state.phase === "paused") &&
      (event.morningAction === "begin" ||
        event.morningAction === "continue" ||
        affirmative(event.text))
    )
      return new Command({ goto: "begin_morning" });
    if (state.phase === "awaiting_available_time")
      return new Command({ goto: "record_available_time" });
    if (state.phase === "awaiting_brain_dump")
      return new Command({ goto: "record_brain_dump" });
    if (state.phase === "awaiting_company_move")
      return new Command({ goto: "prepare_synthesis" });
    return new Command({ goto: "agent" });
  };

  const beginMorning = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    const resumed = state.phase === "paused" ? state.resumePhase : null;
    const phase =
      resumed === "awaiting_available_time" ||
      resumed === "awaiting_brain_dump" ||
      resumed === "awaiting_company_move"
        ? resumed
        : "awaiting_available_time";
    return new Command({
      update: {
        phase,
        resumePhase: null,
        requiredQuestion: null,
        assistantMessage: WAITING_QUESTION[phase],
        lastProcessedTurnId: event.turnId,
        lastProcessedReviewed: true,
      },
      goto: "await_input",
    });
  };

  const deferMorning = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    const inProgress = state.phase.startsWith("awaiting_");
    return new Command({
      update: {
        phase: inProgress ? "paused" : "deferred",
        resumePhase: inProgress ? state.phase : null,
        requiredQuestion: null,
        assistantMessage: inProgress
          ? "Paused. I’ll keep our place in the morning opening, and we can return to it when you’re ready."
          : "Understood. We can leave the morning opening for later and continue normally.",
        lastProcessedTurnId: event.turnId,
        lastProcessedReviewed: true,
      },
      goto: "await_input",
    });
  };

  const recordAvailableTime = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    return new Command({
      update: {
        availableTime: answer(event),
        phase: "awaiting_brain_dump",
        requiredQuestion: WAITING_QUESTION.awaiting_brain_dump,
        assistantMessage: "",
      },
      goto: "agent",
    });
  };

  const recordBrainDump = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    return new Command({
      update: {
        brainDump: answer(event),
        phase: "awaiting_company_move",
        requiredQuestion: WAITING_QUESTION.awaiting_company_move,
        assistantMessage: "",
      },
      goto: "agent",
    });
  };

  const prepareSynthesis = (state: ConversationGraphState) => {
    const event = requireEvent(state);
    return new Command({
      update: {
        companyMove: answer(event),
        phase: "synthesizing",
        requiredQuestion: null,
        assistantMessage: "",
      },
      goto: "agent",
    });
  };

  const agent = async (state: ConversationGraphState) => {
    const event = requireEvent(state);
    const requiredQuestion = state.requiredQuestion;
    const morning =
      state.phase === "synthesizing" &&
      state.availableTime &&
      state.brainDump &&
      state.companyMove
        ? {
            availableTime: state.availableTime,
            brainDump: state.brainDump,
            companyMove: state.companyMove,
          }
        : undefined;
    if (state.phase === "synthesizing" && !morning)
      throw new Error("The morning opening is missing an answer.");
    const result = await dependencies.runAgent(event, {
      purpose: morning
        ? "morning_synthesis"
        : requiredQuestion
          ? "morning_transition"
          : event.kind === "message"
            ? "normal"
            : "review",
      phase: state.phase,
      offerMorningOpening:
        event.kind === "message" && state.phase === "idle" && !requiredQuestion,
      ...(requiredQuestion
        ? {
            morningTransition: {
              requiredNextQuestion: requiredQuestion,
            },
          }
        : {}),
      ...(morning ? { morning } : {}),
      ...(state.steeringFrom
        ? {
            steering: {
              originalTurnId: state.steeringFrom.turnId,
              originalText: state.steeringFrom.text,
              direction: event.text,
            },
          }
        : {}),
    });
    return new Command({
      update: {
        phase: morning ? "complete" : state.phase,
        completedAt: morning ? new Date().toISOString() : state.completedAt,
        assistantMessage: requiredQuestion
          ? withRequiredQuestion(result.answer, requiredQuestion)
          : result.answer,
        requiredQuestion: null,
        lastProcessedTurnId: event.turnId,
        lastProcessedReviewed: result.reviewed,
        steeringFrom: null,
      },
      goto: "await_input",
    });
  };

  const awaitInput = (state: ConversationGraphState) => {
    const event = interrupt({
      kind: "user_input",
      phase: state.phase,
      assistantMessage: state.assistantMessage,
    }) as ConversationEvent;
    return new Command({ update: { event }, goto: "dispatch" });
  };

  return new StateGraph(GraphState)
    .addNode("dispatch", dispatch, {
      ends: [
        "agent",
        "begin_morning",
        "defer_morning",
        "record_available_time",
        "record_brain_dump",
        "prepare_synthesis",
      ],
    })
    .addNode("begin_morning", beginMorning, { ends: ["await_input"] })
    .addNode("defer_morning", deferMorning, { ends: ["await_input"] })
    .addNode("record_available_time", recordAvailableTime, {
      ends: ["agent"],
    })
    .addNode("record_brain_dump", recordBrainDump, {
      ends: ["agent"],
    })
    .addNode("prepare_synthesis", prepareSynthesis, { ends: ["agent"] })
    .addNode("agent", agent, { ends: ["await_input"] })
    .addNode("await_input", awaitInput, { ends: ["dispatch"] })
    .addEdge(START, "dispatch")
    .compile({ checkpointer });
}

function initialState(date: string, event: ConversationEvent) {
  return {
    schemaVersion: 2,
    localDate: date,
    phase: "idle" as MorningPhase,
    resumePhase: null,
    event,
    steeringFrom: null,
    assistantMessage: "",
    availableTime: null,
    brainDump: null,
    companyMove: null,
    requiredQuestion: null,
    completedAt: null,
    lastProcessedTurnId: null,
    lastProcessedReviewed: true,
  };
}

export async function runConversationGraph(options: {
  checkpointer: BaseCheckpointSaver;
  userId: string;
  date: string;
  event: ConversationEvent;
  dependencies: ConversationGraphDependencies;
  signal?: AbortSignal;
}) {
  const graph = buildConversationGraph(
    options.checkpointer,
    options.dependencies,
  );
  const config = {
    configurable: {
      thread_id: assistantGraphThreadId(options.userId, options.date),
    },
    durability: "sync" as const,
    recursionLimit: 12,
    signal: options.signal,
  };
  const snapshot = await graph.getState(config);
  const current = snapshot.values as Partial<ConversationGraphState>;
  if (current.lastProcessedTurnId === options.event.turnId) {
    if (!current.assistantMessage)
      throw new Error("The saved graph turn has no assistant response.");
    return {
      answer: current.assistantMessage,
      reviewed: current.lastProcessedReviewed === true,
      phase: current.phase ?? "idle",
      resumed: true,
    };
  }

  let input: Parameters<typeof graph.invoke>[0];
  let invocationConfig: Parameters<typeof graph.invoke>[1] = config;
  const interruption = snapshot.tasks?.some(
    (task) => task.interrupts && task.interrupts.length > 0,
  );
  if (interruption) {
    input = new Command({ resume: options.event });
  } else if (snapshot.next?.length) {
    if (
      current.event?.turnId &&
      current.event.turnId !== options.event.turnId
    ) {
      if (
        current.event.kind === "catch_up" &&
        options.event.kind !== "catch_up"
      ) {
        invocationConfig = await graph.updateState(
          config,
          {
            event: options.event,
            steeringFrom: null,
            requiredQuestion: null,
          },
          START,
        );
        input = null;
      } else {
        if (
          options.event.kind !== "message" ||
          options.event.steeringForTurnId !== current.event.turnId
        )
          throw new Error(
            "A different saved exchange must be resumed before starting another.",
          );
        input = new Command({
          update: {
            event: options.event,
            steeringFrom: current.event,
          },
          goto: "agent",
        });
      }
    } else input = null;
  } else {
    input = initialState(options.date, options.event);
  }

  const result = (await graph.invoke(
    input,
    invocationConfig,
  )) as ConversationGraphState & {
    __interrupt__?: unknown;
  };
  if (result.lastProcessedTurnId !== options.event.turnId)
    throw new Error("The conversation graph stopped before producing a reply.");
  if (!result.assistantMessage)
    throw new Error("The conversation graph produced no assistant response.");
  return {
    answer: result.assistantMessage,
    reviewed: result.lastProcessedReviewed,
    phase: result.phase,
    resumed: false,
  };
}

function initializationFromValues(
  values: Partial<ConversationGraphState> | undefined,
): DailyInitializationState {
  const phase = values?.phase ?? "idle";
  return {
    phase,
    availableTimeAnswered: Boolean(values?.availableTime),
    brainDumpAnswered: Boolean(values?.brainDump),
    companyMoveAnswered: Boolean(values?.companyMove),
    completedAt: values?.completedAt ?? null,
  };
}

export async function loadDailyInitialization(options: {
  checkpointer: BaseCheckpointSaver;
  userId: string;
  date: string;
}) {
  const checkpoint = await options.checkpointer.get({
    configurable: {
      thread_id: assistantGraphThreadId(options.userId, options.date),
    },
  });
  return initializationFromValues(
    checkpoint?.channel_values as Partial<ConversationGraphState> | undefined,
  );
}

export const conversationGraphTestContract = {
  affirmative,
  decline,
  initializationFromValues,
  withRequiredQuestion,
};
