import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalCompletionArtifacts } from "@/lib/ledger";
import type {
  LedgerEvent,
  RewardRedemption,
  RewardRule,
  TimerMode,
  TimerSession,
  WorkBlock,
} from "@/lib/types";

export type WorkspaceData = {
  ledgerEvents: LedgerEvent[];
  timerSessions: TimerSession[];
  workBlocks: WorkBlock[];
};

type PersistCompletionInput = {
  completedAt: string;
  mode: TimerMode;
  userId: string;
};

type PersistManualWorkBlockInput = {
  completedAt: string;
  durationMinutes: number;
  note?: string;
  userId: string;
};

type PersistRewardSpendInput = {
  costWorkBlocks: number;
  notes?: string;
  redeemedAt: string;
  rewardMinutes: number;
  rewardName: string;
  userId: string;
};

const AUTH_REQUIRED_MESSAGE =
  "Sign in with your email to load your workspace.";

function isMissingSessionError(error: unknown) {
  const message = toErrorMessage(error, "").toLowerCase();
  return message.includes("auth session missing");
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return fallback;
}

export async function ensureWorkspaceUser(supabase: SupabaseClient) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isMissingSessionError(error)) {
    throw new Error(toErrorMessage(error, "Could not read the current workspace session."));
  }

  if (!user) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
  }

  return user;
}

export async function fetchWorkspaceData(supabase: SupabaseClient, userId: string): Promise<WorkspaceData> {
  const [timerSessionsResult, workBlocksResult, ledgerEventsResult] = await Promise.all([
    supabase
      .from("timer_sessions")
      .select("id, user_id, mode, planned_minutes, started_at, ended_at, completed, interrupted, notes")
      .eq("user_id", userId)
      .order("started_at", { ascending: false }),
    supabase
      .from("work_blocks")
      .select("id, user_id, timer_session_id, earned_at, duration_minutes, tag, quality_rating")
      .eq("user_id", userId)
      .order("earned_at", { ascending: false }),
    supabase
      .from("ledger_events")
      .select("id, user_id, event_type, delta_work_blocks, delta_reward_blocks, source, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (timerSessionsResult.error) {
    throw new Error(toErrorMessage(timerSessionsResult.error, "Could not load saved timer sessions."));
  }

  if (workBlocksResult.error) {
    throw new Error(toErrorMessage(workBlocksResult.error, "Could not load saved work blocks."));
  }

  if (ledgerEventsResult.error) {
    throw new Error(toErrorMessage(ledgerEventsResult.error, "Could not load saved ledger events."));
  }

  return {
    ledgerEvents: (ledgerEventsResult.data ?? []) as LedgerEvent[],
    timerSessions: (timerSessionsResult.data ?? []) as TimerSession[],
    workBlocks: (workBlocksResult.data ?? []) as WorkBlock[],
  };
}

export async function persistCompletedWorkSession(
  supabase: SupabaseClient,
  { completedAt, mode, userId }: PersistCompletionInput,
) {
  const artifacts = createLocalCompletionArtifacts({
    completedAt: new Date(completedAt),
    mode,
    userId,
  });

  if (!artifacts) {
    return null;
  }

  const { timerSession, workBlock, ledgerEvent } = artifacts;

  const timerSessionResult = await supabase
    .from("timer_sessions")
    .upsert(timerSession, { onConflict: "id" });

  if (timerSessionResult.error) {
    throw new Error(toErrorMessage(timerSessionResult.error, "Could not save the completed timer session."));
  }

  const workBlockResult = await supabase
    .from("work_blocks")
    .upsert(workBlock, { onConflict: "id" });

  if (workBlockResult.error) {
    throw new Error(toErrorMessage(workBlockResult.error, "Could not save the earned work block."));
  }

  const ledgerEventResult = await supabase
    .from("ledger_events")
    .upsert(ledgerEvent, { onConflict: "id" });

  if (ledgerEventResult.error) {
    throw new Error(toErrorMessage(ledgerEventResult.error, "Could not save the ledger event."));
  }

  return artifacts;
}

export async function persistManualWorkBlock(
  supabase: SupabaseClient,
  { completedAt, durationMinutes, note, userId }: PersistManualWorkBlockInput,
) {
  const endedAt = completedAt;
  const startedAt = new Date(new Date(completedAt).getTime() - durationMinutes * 60 * 1000).toISOString();
  const timerSessionId = crypto.randomUUID();

  const timerSession: TimerSession = {
    id: timerSessionId,
    user_id: userId,
    mode: "work",
    planned_minutes: durationMinutes,
    started_at: startedAt,
    ended_at: endedAt,
    completed: true,
    interrupted: false,
    notes: note?.trim() || "Manual work block entry",
  };

  const workBlock: WorkBlock = {
    id: crypto.randomUUID(),
    user_id: userId,
    timer_session_id: timerSessionId,
    earned_at: endedAt,
    duration_minutes: durationMinutes,
    tag: "manual",
    quality_rating: null,
  };

  const ledgerEvent: LedgerEvent = {
    id: crypto.randomUUID(),
    user_id: userId,
    event_type: "work_earned",
    delta_work_blocks: 1,
    delta_reward_blocks: 0,
    source: "manual_entry",
    metadata: {
      timer_session_id: timerSessionId,
      work_block_id: workBlock.id,
      mode: "work",
      duration_minutes: durationMinutes,
      note: note?.trim() || null,
    },
    created_at: endedAt,
  };

  const timerSessionResult = await supabase
    .from("timer_sessions")
    .upsert(timerSession, { onConflict: "id" });

  if (timerSessionResult.error) {
    throw new Error(toErrorMessage(timerSessionResult.error, "Could not save the manual timer session."));
  }

  const workBlockResult = await supabase
    .from("work_blocks")
    .upsert(workBlock, { onConflict: "id" });

  if (workBlockResult.error) {
    throw new Error(toErrorMessage(workBlockResult.error, "Could not save the manual work block."));
  }

  const ledgerEventResult = await supabase
    .from("ledger_events")
    .upsert(ledgerEvent, { onConflict: "id" });

  if (ledgerEventResult.error) {
    throw new Error(toErrorMessage(ledgerEventResult.error, "Could not save the manual ledger event."));
  }

  return {
    ledgerEvent,
    timerSession,
    workBlock,
  };
}

export async function persistRewardSpend(
  supabase: SupabaseClient,
  { costWorkBlocks, notes, redeemedAt, rewardMinutes, rewardName, userId }: PersistRewardSpendInput,
) {
  const rewardRule: RewardRule = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: rewardName.trim(),
    cost_work_blocks: costWorkBlocks,
    reward_minutes: rewardMinutes,
    active: true,
  };

  const rewardRuleResult = await supabase
    .from("reward_rules")
    .insert(rewardRule)
    .select("id")
    .single();

  if (rewardRuleResult.error) {
    throw new Error(toErrorMessage(rewardRuleResult.error, "Could not save the reward rule."));
  }

  const rewardRedemption: RewardRedemption = {
    id: crypto.randomUUID(),
    user_id: userId,
    reward_rule_id: rewardRuleResult.data.id,
    reward_name: rewardName.trim(),
    cost_work_blocks: costWorkBlocks,
    redeemed_at: redeemedAt,
    notes: notes?.trim() || null,
  };

  const rewardRedemptionResult = await supabase
    .from("reward_redemptions")
    .upsert(rewardRedemption, { onConflict: "id" });

  if (rewardRedemptionResult.error) {
    throw new Error(toErrorMessage(rewardRedemptionResult.error, "Could not save the reward redemption."));
  }

  const ledgerEvent: LedgerEvent = {
    id: crypto.randomUUID(),
    user_id: userId,
    event_type: "reward_spent",
    delta_work_blocks: -costWorkBlocks,
    delta_reward_blocks: 0,
    source: "manual_reward_redemption",
    metadata: {
      reward_redemption_id: rewardRedemption.id,
      reward_rule_id: rewardRedemption.reward_rule_id,
      reward_name: rewardName.trim(),
      reward_minutes: rewardMinutes,
      notes: notes?.trim() || null,
    },
    created_at: redeemedAt,
  };

  const ledgerEventResult = await supabase
    .from("ledger_events")
    .upsert(ledgerEvent, { onConflict: "id" });

  if (ledgerEventResult.error) {
    throw new Error(toErrorMessage(ledgerEventResult.error, "Could not save the reward ledger event."));
  }

  return {
    ledgerEvent,
    rewardRedemption,
  };
}
