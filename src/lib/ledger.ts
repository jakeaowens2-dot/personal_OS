import { getModeDurationMinutes } from "@/lib/timer";
import type { LedgerEvent, TimerMode, TimerSession, WorkBlock } from "@/lib/types";

type CreateLocalCompletionArtifactsInput = {
  completedAt?: Date;
  mode: TimerMode;
  userId?: string;
};

type CompletionArtifacts = {
  ledgerEvent: LedgerEvent;
  timerSession: TimerSession;
  workBlock: WorkBlock;
};

const LOCAL_USER_ID = "local-user";

export function dedupeLedgerEvents(ledgerEvents: LedgerEvent[]) {
  const seen = new Set<string>();

  return ledgerEvents.filter((event) => {
    const metadata = event.metadata ?? {};
    const key = [
      event.event_type,
      event.source,
      event.created_at,
      event.delta_work_blocks,
      event.delta_reward_blocks,
      typeof metadata.reward_name === "string" ? metadata.reward_name : "",
      typeof metadata.duration_minutes === "number" ? metadata.duration_minutes : "",
      typeof metadata.mode === "string" ? metadata.mode : "",
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function createLocalCompletionArtifacts({
  completedAt = new Date(),
  mode,
  userId = LOCAL_USER_ID,
}: CreateLocalCompletionArtifactsInput): CompletionArtifacts | null {
  if (mode !== "work") {
    return null;
  }

  const durationMinutes = getModeDurationMinutes(mode);
  const endedAt = completedAt.toISOString();
  const startedAt = new Date(completedAt.getTime() - durationMinutes * 60 * 1000).toISOString();
  const timerSessionId = crypto.randomUUID();

  const timerSession: TimerSession = {
    id: timerSessionId,
    user_id: userId,
    mode,
    planned_minutes: durationMinutes,
    started_at: startedAt,
    ended_at: endedAt,
    completed: true,
    interrupted: false,
    notes: null,
  };

  const workBlock: WorkBlock = {
    id: crypto.randomUUID(),
    user_id: userId,
    timer_session_id: timerSession.id,
    earned_at: endedAt,
    duration_minutes: durationMinutes,
    tag: null,
    quality_rating: null,
  };

  const ledgerEvent: LedgerEvent = {
    id: crypto.randomUUID(),
    user_id: userId,
    event_type: "work_earned",
    delta_work_blocks: 1,
    delta_reward_blocks: 0,
    source: "pomodoro_timer",
    metadata: {
      timer_session_id: timerSession.id,
      work_block_id: workBlock.id,
      mode,
      duration_minutes: durationMinutes,
    },
    created_at: endedAt,
  };

  return {
    ledgerEvent,
    timerSession,
    workBlock,
  };
}
