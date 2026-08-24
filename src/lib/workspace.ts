import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalCompletionArtifacts } from "@/lib/ledger";
import { workBlockDeltaForDuration } from "@/lib/economy";
import type {
  LedgerEvent,
  RewardRedemption,
  RewardRule,
  TimerMode,
  TimerSession,
  WorkBlock,
  WorkBlockAttribution,
} from "@/lib/types";

export type WorkspaceData = {
  ledgerEvents: LedgerEvent[];
  timerSessions: TimerSession[];
  workBlocks: WorkBlock[];
};

type PersistCompletionInput = {
  completedAt: string;
  durationMinutes?: number;
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

type WorkBlockAttributionSelection = {
  label: string;
  taskId: string;
};

type PersistWorkBlockAttributionsInput = {
  durationMinutes: number;
  ledgerEvent: LedgerEvent;
  note?: string;
  selections: WorkBlockAttributionSelection[];
  userId: string;
  workBlockId: string;
};

type SoftDeleteInput = {
  actorLabel: string;
  deletionReason: string;
  ledgerEvent: LedgerEvent;
  userId: string;
};

type UpdateManualWorkEntryInput = {
  actorLabel: string;
  durationMinutes: number;
  ledgerEvent: LedgerEvent;
  note?: string;
  selections: WorkBlockAttributionSelection[];
  userId: string;
};

type UpdateRewardSpendEntryInput = {
  costWorkBlocks: number;
  ledgerEvent: LedgerEvent;
  notes?: string;
  redeemedAt: string;
  rewardMinutes: number;
  rewardName: string;
  userId: string;
};

export const AUTH_REQUIRED_MESSAGE = "Sign in with your email to load your workspace.";

function isSchemaCacheTableError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("schema cache") && normalizedMessage.includes("public.");
}

function enhanceWorkspaceError(message: string, tableLabel: string) {
  if (isSchemaCacheTableError(message)) {
    return `Supabase cannot see the ${tableLabel} tables yet. Apply the latest migrations to refresh the schema cache, then reload the app.`;
  }

  return message;
}

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
      .is("deleted_at", null)
      .order("started_at", { ascending: false }),
    supabase
      .from("work_blocks")
      .select("id, user_id, timer_session_id, earned_at, duration_minutes, tag, quality_rating")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("earned_at", { ascending: false }),
    supabase
      .from("ledger_events")
      .select("id, user_id, event_type, delta_work_blocks, delta_reward_blocks, source, metadata, created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
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
  { completedAt, durationMinutes, mode, userId }: PersistCompletionInput,
) {
  const artifacts = createLocalCompletionArtifacts({
    completedAt: new Date(completedAt),
    durationMinutes,
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
    delta_work_blocks: workBlockDeltaForDuration(durationMinutes),
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

function buildAttributionSummary(labels: string[]) {
  if (labels.length === 0) {
    return null;
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels[0]} + ${labels.length - 1} more`;
}

function buildDeletedFields(actorLabel: string, deletionReason: string) {
  return {
    deleted_at: new Date().toISOString(),
    deleted_by_actor_label: actorLabel,
    deletion_reason: deletionReason.trim(),
  };
}

function buildManualWorkLedgerMetadata({
  durationMinutes,
  ledgerEvent,
  note,
  selections,
}: {
  durationMinutes: number;
  ledgerEvent: LedgerEvent;
  note?: string;
  selections: WorkBlockAttributionSelection[];
}) {
  const attributionLabels = selections.map((selection) => selection.label);
  const attributionSummary = buildAttributionSummary(attributionLabels);

  return {
    ...(ledgerEvent.metadata ?? {}),
    attribution_count: selections.length,
    attribution_labels: attributionLabels,
    attribution_summary: attributionSummary,
    attributed_minutes: durationMinutes,
    attributed_task_ids: selections.map((selection) => selection.taskId),
    duration_minutes: durationMinutes,
    note: note?.trim() || null,
  };
}

function getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" ? value : null;
}

async function softDeleteAttributionsForWorkBlock(
  supabase: SupabaseClient,
  {
    actorLabel,
    deletionReason,
    userId,
    workBlockId,
  }: {
    actorLabel: string;
    deletionReason: string;
    userId: string;
    workBlockId: string;
  },
) {
  const { error } = await supabase
    .from("work_block_attributions")
    .update(buildDeletedFields(actorLabel, deletionReason))
    .eq("user_id", userId)
    .eq("work_block_id", workBlockId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(
      enhanceWorkspaceError(
        toErrorMessage(error, "Could not update work block attributions."),
        "work attribution",
      ),
    );
  }
}

export async function persistWorkBlockAttributions(
  supabase: SupabaseClient,
  { durationMinutes, ledgerEvent, note, selections, userId, workBlockId }: PersistWorkBlockAttributionsInput,
) {
  const shareCount = selections.length;

  if (shareCount === 0) {
    throw new Error("Choose at least one task or category for this work block.");
  }

  const baseMinutes = Math.floor(durationMinutes / shareCount);
  const remainderMinutes = durationMinutes % shareCount;

  const attributions: WorkBlockAttribution[] = selections.map((selection, index) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    work_block_id: workBlockId,
    task_id: selection.taskId,
    attribution_label: selection.label,
    share_ratio: 1 / shareCount,
    attributed_minutes: baseMinutes + (index < remainderMinutes ? 1 : 0),
    created_at: ledgerEvent.created_at,
  }));

  const { error: insertError } = await supabase
    .from("work_block_attributions")
    .insert(attributions);

  if (insertError) {
    throw new Error(
      enhanceWorkspaceError(
        toErrorMessage(insertError, "Could not save the work block attribution."),
        "work attribution",
      ),
    );
  }

  const updatedLedgerMetadata = buildManualWorkLedgerMetadata({
    durationMinutes,
    ledgerEvent,
    note,
    selections,
  });

  const { error: ledgerEventError } = await supabase
    .from("ledger_events")
    .update({
      metadata: updatedLedgerMetadata,
    })
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId);

  if (ledgerEventError) {
    throw new Error(
      enhanceWorkspaceError(
        toErrorMessage(ledgerEventError, "Could not update the work ledger event with task attribution."),
        "work attribution",
      ),
    );
  }

  return {
    attributions,
    ledgerEvent: {
      ...ledgerEvent,
      metadata: updatedLedgerMetadata,
    },
  };
}

export async function fetchAttributionSelectionsForWorkBlock(
  supabase: SupabaseClient,
  { userId, workBlockId }: { userId: string; workBlockId: string },
) {
  const { data, error } = await supabase
    .from("work_block_attributions")
    .select("task_id, attribution_label")
    .eq("user_id", userId)
    .eq("work_block_id", workBlockId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      enhanceWorkspaceError(
        toErrorMessage(error, "Could not load work block attributions."),
        "work attribution",
      ),
    );
  }

  return (data ?? []).map((row) => ({
    label: row.attribution_label as string,
    taskId: row.task_id as string,
  }));
}

export async function updateManualWorkEntry(
  supabase: SupabaseClient,
  { actorLabel, durationMinutes, ledgerEvent, note, selections, userId }: UpdateManualWorkEntryInput,
) {
  const timerSessionId = getMetadataString(ledgerEvent.metadata, "timer_session_id");
  const workBlockId = getMetadataString(ledgerEvent.metadata, "work_block_id");

  if (!timerSessionId || !workBlockId) {
    throw new Error("This work event is missing its linked session records and cannot be edited safely.");
  }

  const endedAt = ledgerEvent.created_at;
  const startedAt = new Date(new Date(endedAt).getTime() - durationMinutes * 60 * 1000).toISOString();

  const { error: timerSessionError } = await supabase
    .from("timer_sessions")
    .update({
      planned_minutes: durationMinutes,
      started_at: startedAt,
      ended_at: endedAt,
      notes: note?.trim() || "Manual work block entry",
    })
    .eq("id", timerSessionId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (timerSessionError) {
    throw new Error(toErrorMessage(timerSessionError, "Could not update the manual timer session."));
  }

  const { error: workBlockError } = await supabase
    .from("work_blocks")
    .update({
      duration_minutes: durationMinutes,
      earned_at: endedAt,
      tag: "manual",
    })
    .eq("id", workBlockId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (workBlockError) {
    throw new Error(toErrorMessage(workBlockError, "Could not update the manual work block."));
  }

  await softDeleteAttributionsForWorkBlock(supabase, {
    actorLabel,
    deletionReason: "Superseded by a later edit.",
    userId,
    workBlockId,
  });

  const updatedLedgerMetadata = buildManualWorkLedgerMetadata({
    durationMinutes,
    ledgerEvent,
    note,
    selections,
  });

  const { error: ledgerEventError } = await supabase
    .from("ledger_events")
    .update({
      metadata: updatedLedgerMetadata,
    })
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (ledgerEventError) {
    throw new Error(toErrorMessage(ledgerEventError, "Could not update the ledger event."));
  }

  const attributionResult = await persistWorkBlockAttributions(supabase, {
    durationMinutes,
    ledgerEvent: {
      ...ledgerEvent,
      metadata: updatedLedgerMetadata,
    },
    selections,
    userId,
    workBlockId,
  });

  return {
    ledgerEvent: attributionResult.ledgerEvent,
  };
}

export async function softDeleteWorkEvent(
  supabase: SupabaseClient,
  { actorLabel, deletionReason, ledgerEvent, userId }: SoftDeleteInput,
) {
  const workBlockId = getMetadataString(ledgerEvent.metadata, "work_block_id");
  const timerSessionId = getMetadataString(ledgerEvent.metadata, "timer_session_id");
  const deletedFields = buildDeletedFields(actorLabel, deletionReason);

  if (workBlockId) {
    await softDeleteAttributionsForWorkBlock(supabase, {
      actorLabel,
      deletionReason,
      userId,
      workBlockId,
    });

    const { error: workBlockError } = await supabase
      .from("work_blocks")
      .update(deletedFields)
      .eq("id", workBlockId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (workBlockError) {
      throw new Error(toErrorMessage(workBlockError, "Could not delete the work block."));
    }
  }

  if (timerSessionId) {
    const { error: timerSessionError } = await supabase
      .from("timer_sessions")
      .update(deletedFields)
      .eq("id", timerSessionId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (timerSessionError) {
      throw new Error(toErrorMessage(timerSessionError, "Could not delete the timer session."));
    }
  }

  const { error: ledgerEventError } = await supabase
    .from("ledger_events")
    .update(deletedFields)
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (ledgerEventError) {
    throw new Error(toErrorMessage(ledgerEventError, "Could not delete the ledger event."));
  }
}

export async function hardDeleteWorkEvent(
  supabase: SupabaseClient,
  { ledgerEvent, userId }: { ledgerEvent: LedgerEvent; userId: string },
) {
  const workBlockId = getMetadataString(ledgerEvent.metadata, "work_block_id");
  const timerSessionId = getMetadataString(ledgerEvent.metadata, "timer_session_id");

  if (workBlockId) {
    const { error: attributionError } = await supabase
      .from("work_block_attributions")
      .delete()
      .eq("work_block_id", workBlockId)
      .eq("user_id", userId);

    if (attributionError) {
      throw new Error(
        toErrorMessage(attributionError, "Could not remove the work block attribution."),
      );
    }

    const { error: workBlockError } = await supabase
      .from("work_blocks")
      .delete()
      .eq("id", workBlockId)
      .eq("user_id", userId);

    if (workBlockError) {
      throw new Error(toErrorMessage(workBlockError, "Could not remove the work block."));
    }
  }

  if (timerSessionId) {
    const { error: timerSessionError } = await supabase
      .from("timer_sessions")
      .delete()
      .eq("id", timerSessionId)
      .eq("user_id", userId);

    if (timerSessionError) {
      throw new Error(toErrorMessage(timerSessionError, "Could not remove the timer session."));
    }
  }

  const { error: ledgerError } = await supabase
    .from("ledger_events")
    .delete()
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId);

  if (ledgerError) {
    throw new Error(toErrorMessage(ledgerError, "Could not remove the ledger event."));
  }
}

export async function hardDeleteRewardSpendEvent(
  supabase: SupabaseClient,
  { ledgerEvent, userId }: { ledgerEvent: LedgerEvent; userId: string },
) {
  const rewardRedemptionId = getMetadataString(ledgerEvent.metadata, "reward_redemption_id");
  const rewardRuleId = getMetadataString(ledgerEvent.metadata, "reward_rule_id");

  if (rewardRedemptionId) {
    const { error } = await supabase
      .from("reward_redemptions")
      .delete()
      .eq("id", rewardRedemptionId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(toErrorMessage(error, "Could not remove the reward redemption."));
    }
  }

  if (rewardRuleId) {
    const { error } = await supabase
      .from("reward_rules")
      .delete()
      .eq("id", rewardRuleId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(toErrorMessage(error, "Could not remove the reward rule."));
    }
  }

  const { error } = await supabase
    .from("ledger_events")
    .delete()
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(toErrorMessage(error, "Could not remove the ledger event."));
  }
}

export async function hardDeleteLedgerEvent(
  supabase: SupabaseClient,
  { ledgerEvent, userId }: { ledgerEvent: LedgerEvent; userId: string },
) {
  if (ledgerEvent.event_type === "reward_spent") {
    return hardDeleteRewardSpendEvent(supabase, { ledgerEvent, userId });
  }

  return hardDeleteWorkEvent(supabase, { ledgerEvent, userId });
}

export async function hardResetWorkspace(
  supabase: SupabaseClient,
  { userId }: { userId: string },
) {
  // Deletion order respects foreign keys: attributions -> work blocks -> timer sessions,
  // then reward redemptions -> reward rules (restrict), then ledger events.
  const tables = [
    "work_block_attributions",
    "work_blocks",
    "timer_sessions",
    "reward_redemptions",
    "reward_rules",
    "behavior_events",
    "ledger_events",
  ] as const;

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);

    if (error) {
      throw new Error(toErrorMessage(error, `Could not clear ${table}.`));
    }
  }
}

export async function updateRewardSpendEntry(
  supabase: SupabaseClient,
  { costWorkBlocks, ledgerEvent, notes, redeemedAt, rewardMinutes, rewardName, userId }: UpdateRewardSpendEntryInput,
) {
  const rewardRedemptionId = getMetadataString(ledgerEvent.metadata, "reward_redemption_id");
  const rewardRuleId = getMetadataString(ledgerEvent.metadata, "reward_rule_id");

  if (!rewardRedemptionId || !rewardRuleId) {
    throw new Error("This reward event is missing its linked reward records and cannot be edited safely.");
  }

  const trimmedRewardName = rewardName.trim();
  const trimmedNotes = notes?.trim() || null;

  const { error: rewardRuleError } = await supabase
    .from("reward_rules")
    .update({
      name: trimmedRewardName,
      cost_work_blocks: costWorkBlocks,
      reward_minutes: rewardMinutes,
    })
    .eq("id", rewardRuleId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (rewardRuleError) {
    throw new Error(toErrorMessage(rewardRuleError, "Could not update the reward rule."));
  }

  const { error: rewardRedemptionError } = await supabase
    .from("reward_redemptions")
    .update({
      reward_name: trimmedRewardName,
      cost_work_blocks: costWorkBlocks,
      redeemed_at: redeemedAt,
      notes: trimmedNotes,
    })
    .eq("id", rewardRedemptionId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (rewardRedemptionError) {
    throw new Error(toErrorMessage(rewardRedemptionError, "Could not update the reward redemption."));
  }

  const updatedMetadata = {
    ...(ledgerEvent.metadata ?? {}),
    reward_redemption_id: rewardRedemptionId,
    reward_rule_id: rewardRuleId,
    reward_name: trimmedRewardName,
    reward_minutes: rewardMinutes,
    notes: trimmedNotes,
  };

  const { error: ledgerEventError } = await supabase
    .from("ledger_events")
    .update({
      created_at: redeemedAt,
      delta_work_blocks: -costWorkBlocks,
      metadata: updatedMetadata,
    })
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (ledgerEventError) {
    throw new Error(toErrorMessage(ledgerEventError, "Could not update the reward ledger event."));
  }

  return {
    ledgerEvent: {
      ...ledgerEvent,
      created_at: redeemedAt,
      delta_work_blocks: -costWorkBlocks,
      metadata: updatedMetadata,
    },
  };
}

export async function softDeleteRewardSpendEvent(
  supabase: SupabaseClient,
  { actorLabel, deletionReason, ledgerEvent, userId }: SoftDeleteInput,
) {
  const rewardRedemptionId = getMetadataString(ledgerEvent.metadata, "reward_redemption_id");
  const rewardRuleId = getMetadataString(ledgerEvent.metadata, "reward_rule_id");
  const deletedFields = buildDeletedFields(actorLabel, deletionReason);

  if (rewardRedemptionId) {
    const { error: rewardRedemptionError } = await supabase
      .from("reward_redemptions")
      .update(deletedFields)
      .eq("id", rewardRedemptionId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (rewardRedemptionError) {
      throw new Error(toErrorMessage(rewardRedemptionError, "Could not delete the reward redemption."));
    }
  }

  if (rewardRuleId) {
    const { error: rewardRuleError } = await supabase
      .from("reward_rules")
      .update(deletedFields)
      .eq("id", rewardRuleId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (rewardRuleError) {
      throw new Error(toErrorMessage(rewardRuleError, "Could not delete the reward rule."));
    }
  }

  const { error: ledgerEventError } = await supabase
    .from("ledger_events")
    .update(deletedFields)
    .eq("id", ledgerEvent.id)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (ledgerEventError) {
    throw new Error(toErrorMessage(ledgerEventError, "Could not delete the reward ledger event."));
  }
}

export function isEditableLedgerEvent(event: LedgerEvent) {
  return (
    (event.event_type === "work_earned" && event.source === "manual_entry") ||
    (event.event_type === "reward_spent" && event.source === "manual_reward_redemption")
  );
}

export function isDeletableLedgerEvent(event: LedgerEvent) {
  if (event.event_type === "reward_spent" && event.source === "manual_reward_redemption") {
    return true;
  }

  return event.event_type === "work_earned" && (event.source === "manual_entry" || event.source === "pomodoro_timer");
}

export function getManualWorkDefaultsFromLedgerEvent(event: LedgerEvent) {
  return {
    durationMinutes: getMetadataNumber(event.metadata, "duration_minutes"),
    note: getMetadataString(event.metadata, "note"),
    workBlockId: getMetadataString(event.metadata, "work_block_id"),
  };
}

export function getRewardSpendDefaultsFromLedgerEvent(event: LedgerEvent) {
  return {
    notes: getMetadataString(event.metadata, "notes") ?? "",
    rewardMinutes: getMetadataNumber(event.metadata, "reward_minutes"),
  };
}
