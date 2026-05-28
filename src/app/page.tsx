"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { LedgerEventList } from "@/components/ledger/LedgerEventList";
import { OverviewModule } from "@/components/overview/OverviewModule";
import { PomodoroTimer, type TimerStatus } from "@/components/timer/PomodoroTimer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { dedupeLedgerEvents } from "@/lib/ledger";
import {
  getRewardBalanceMinutes,
  getRewardMinutesForWorkEvent,
  isWeekendDate,
  REWARD_BLOCK_MINUTES,
  WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK,
  WEEKEND_REWARD_MINUTES_PER_WORK_BLOCK,
  WEEKEND_REWARD_MULTIPLIER_LABEL,
} from "@/lib/rewards";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createTask,
  ensureHousekeepingTask,
  fetchDailyFocusItems,
  fetchMostRecentAttributedTaskId,
} from "@/lib/tasks";
import { rewardPalette, timerPalette } from "@/lib/timerPalette";
import {
  ensureWorkspaceUser,
  fetchWorkspaceData,
  persistCompletedWorkSession,
  persistManualWorkBlock,
  persistRewardSpend,
  persistWorkBlockAttributions,
} from "@/lib/workspace";
import { archiveTask, completeTask, removeTaskFromDailyFocus } from "@/lib/tasks";
import type { DailyFocusItemWithTask, LedgerEvent, Task, TimerMode, TimerSession, WorkBlock } from "@/lib/types";

type LocalLedgerState = {
  ledgerEvents: LedgerEvent[];
  timerSessions: TimerSession[];
  workBlocks: WorkBlock[];
};

const INITIAL_STATE: LocalLedgerState = {
  ledgerEvents: [],
  timerSessions: [],
  workBlocks: [],
};

type PersistenceState =
  | { kind: "connecting"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

type AttributionSelectionState = {
  choresTask: Task;
  otherSelected: boolean;
  otherTitle: string;
  selectedTaskIds: string[];
};

type AttributionDialogState = AttributionSelectionState & {
  ledgerEvent: LedgerEvent;
  workBlock: WorkBlock;
};

function isToday(isoTimestamp: string) {
  const now = new Date();
  const date = new Date(isoTimestamp);

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatTimestamp(isoTimestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(isoTimestamp));
}

function getTodayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function isThisWeek(isoTimestamp: string) {
  const date = new Date(isoTimestamp);
  const now = new Date();
  const currentDay = now.getDay();
  const distanceFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - distanceFromMonday);

  return date >= startOfWeek;
}

function getVisibleSquares(count: number, maxVisible = 12) {
  return Array.from({ length: Math.min(count, maxVisible) });
}

function dedupeWorkBlocks(workBlocks: WorkBlock[]) {
  const seen = new Set<string>();

  return workBlocks.filter((workBlock) => {
    const key = [
      workBlock.earned_at,
      workBlock.duration_minutes,
      workBlock.tag ?? "",
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatRewardMinutes(totalMinutes: number) {
  const absoluteMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const prefix = totalMinutes < 0 ? "-" : "";

  return `${prefix}${hours}:${minutes.toString().padStart(2, "0")}`;
}

function formatDurationLabel(hours: number, minutes: number) {
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  return parts.join(" ");
}

function getRewardReportDate(dayOffset: number) {
  const date = new Date();
  // Reward reports currently capture the day only, so we normalize to local midday
  // to persist a stable, non-edge-case timestamp for that calendar date.
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function formatRewardReportDate(dayOffset: number) {
  if (dayOffset === 0) {
    return "Today";
  }

  if (dayOffset === -1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(getRewardReportDate(dayOffset));
}

type ActionFieldProps = {
  label: string;
} & InputHTMLAttributes<HTMLInputElement>;

function ActionField({ label, className, ...props }: ActionFieldProps) {
  return (
    <label className="space-y-2">
      <span className="text-sm text-slate-600">{label}</span>
      <input
        className={`h-11 w-full rounded-2xl border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400 ${className ?? ""}`}
        {...props}
      />
    </label>
  );
}

function inputClassName() {
  return "h-11 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400";
}

type AttributionFieldsProps = {
  choresTask: Task;
  dailyFocusItems: DailyFocusItemWithTask[];
  durationMinutes: number;
  emptyStateMessage: string;
  onOtherSelectedChange: (checked: boolean) => void;
  onOtherTitleChange: (value: string) => void;
  onToggleTask: (taskId: string) => void;
  otherSelected: boolean;
  otherTitle: string;
  selectedTaskIds: string[];
};

function AttributionFields({
  choresTask,
  dailyFocusItems,
  durationMinutes,
  emptyStateMessage,
  onOtherSelectedChange,
  onOtherTitleChange,
  onToggleTask,
  otherSelected,
  otherTitle,
  selectedTaskIds,
}: AttributionFieldsProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {dailyFocusItems.length > 0 ? (
          dailyFocusItems.map((item) => {
            const checked = selectedTaskIds.includes(item.task.id);

            return (
              <label
                key={item.id}
                className="flex items-start gap-3 rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3"
              >
                <input
                  checked={checked}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  onChange={() => onToggleTask(item.task.id)}
                  type="checkbox"
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-950">{item.task.title}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {item.task.priority}
                    {item.task.area ? ` · ${item.task.area}` : ""}
                  </p>
                </div>
              </label>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">{emptyStateMessage}</p>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
        <input
          checked={selectedTaskIds.includes(choresTask.id)}
          className="mt-1 h-4 w-4 accent-[var(--accent)]"
          onChange={() => onToggleTask(choresTask.id)}
          type="checkbox"
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-950">{choresTask.title}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">always available</p>
        </div>
      </label>

      <div className="space-y-3 rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
        <label className="flex items-start gap-3">
          <input
            checked={otherSelected}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
            onChange={(event) => onOtherSelectedChange(event.target.checked)}
            type="checkbox"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-950">Other</p>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">create a canonical task</p>
          </div>
        </label>
        {otherSelected ? (
          <input
            className={inputClassName()}
            onChange={(event) => onOtherTitleChange(event.target.value)}
            placeholder="Name the work you just did"
            value={otherTitle}
          />
        ) : null}
      </div>

      <p className="border-t border-slate-200/80 pt-4 text-sm text-slate-500">
        Selected tasks will split {durationMinutes} minutes evenly.
      </p>
    </div>
  );
}

type BlockMeterProps = {
  color: "reward" | "reward_negative" | "work";
  count: number;
  label: string;
  maxVisible?: number;
  partialCount?: number;
  zeroLabel?: string;
  valueLabel: string;
};

function BlockMeter({
  color,
  count,
  label,
  maxVisible = 12,
  partialCount,
  valueLabel,
  zeroLabel = "No blocks yet",
}: BlockMeterProps) {
  const palette =
    color === "work"
      ? timerPalette.work.progress
      : color === "reward"
        ? rewardPalette.progress
        : "#94a3b8";
  const visibleSquares = getVisibleSquares(Math.ceil(partialCount ?? count), maxVisible);

  return (
    <div className="space-y-3">
      {label ? <p className="text-sm text-slate-500">{label}</p> : null}
      <div className="flex min-h-4 flex-wrap gap-[2px]">
        {count === 0 ? (
          <div className="text-xs text-slate-400">{zeroLabel}</div>
        ) : (
          visibleSquares.map((_, index) => {
            const fillRatio = partialCount == null
              ? 1
              : Math.max(0, Math.min(1, partialCount - index));
            const isGroupBoundary = index > 0 && index % 3 === 0;

            return (
              <span
                key={`${label}-${index}`}
                className={`relative h-[15px] w-[15px] overflow-hidden rounded-[2px] bg-slate-200/80 ${isGroupBoundary ? "ml-[9px]" : ""}`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-[2px]"
                  style={{
                    backgroundColor: palette,
                    width: `${fillRatio * 100}%`,
                  }}
                />
              </span>
            );
          })
        )}
        {count > maxVisible ? <span className="text-xs text-slate-500">+{count - maxVisible}</span> : null}
      </div>
      {valueLabel ? <p className="text-sm font-semibold text-slate-900">{valueLabel}</p> : null}
    </div>
  );
}

export default function HomePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [localLedgerState, setLocalLedgerState] = useState(INITIAL_STATE);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>({
    kind: "connecting",
    message: "Connecting workspace...",
  });
  const [timerVisualState, setTimerVisualState] = useState<{
    mode: TimerMode;
    status: TimerStatus;
  }>({
    mode: "work",
    status: "idle",
  });
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [dailyFocusItems, setDailyFocusItems] = useState<DailyFocusItemWithTask[]>([]);
  const [dailyFocusNotice, setDailyFocusNotice] = useState<string | null>(null);
  const [attributionDialogState, setAttributionDialogState] = useState<AttributionDialogState | null>(null);
  const [manualAttributionState, setManualAttributionState] = useState<AttributionSelectionState | null>(null);
  const [manualWorkMinutes, setManualWorkMinutes] = useState("50");
  const [manualWorkNote, setManualWorkNote] = useState("");
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isRewardDialogOpen, setIsRewardDialogOpen] = useState(false);
  const [rewardHours, setRewardHours] = useState("0");
  const [rewardMinutes, setRewardMinutes] = useState("0");
  const [rewardDayOffset, setRewardDayOffset] = useState(0);
  const [rewardNote, setRewardNote] = useState("");
  const handledCompletionKeysRef = useRef(new Set<string>());

  const dedupedWorkBlocks = useMemo(
    () => dedupeWorkBlocks(localLedgerState.workBlocks),
    [localLedgerState.workBlocks],
  );

  const dedupedLedgerEvents = useMemo(
    () => dedupeLedgerEvents(localLedgerState.ledgerEvents),
    [localLedgerState.ledgerEvents],
  );

  const todaysWorkBlocks = useMemo(
    () => dedupedWorkBlocks.filter((workBlock) => isToday(workBlock.earned_at)),
    [dedupedWorkBlocks],
  );

  const currentWorkBalance = useMemo(
    () =>
      dedupedLedgerEvents.reduce(
        (total, event) => total + event.delta_work_blocks,
        0,
      ),
    [dedupedLedgerEvents],
  );

  const currentRewardMinutes = useMemo(
    () => getRewardBalanceMinutes(dedupedLedgerEvents),
    [dedupedLedgerEvents],
  );

  const currentRewardBalance = useMemo(
    () => Math.abs(currentRewardMinutes) / REWARD_BLOCK_MINUTES,
    [currentRewardMinutes],
  );

  const isWeekendBonusActive = useMemo(
    () => isWeekendDate(new Date().toISOString()),
    [],
  );

  const weeklyWorkBlocks = useMemo(
    () => dedupedWorkBlocks.filter((workBlock) => isThisWeek(workBlock.earned_at)),
    [dedupedWorkBlocks],
  );

  const weeklyRewardMinutesEarned = useMemo(
    () =>
      dedupedLedgerEvents
        .filter((event) => event.event_type === "work_earned" && isThisWeek(event.created_at))
        .reduce((total, event) => total + getRewardMinutesForWorkEvent(event), 0),
    [dedupedLedgerEvents],
  );

  const recentLedgerEvents = useMemo(
    () => dedupedLedgerEvents.slice(0, 5),
    [dedupedLedgerEvents],
  );

  const visibleDailyFocusItems = useMemo(
    () => dailyFocusItems.slice(0, 5),
    [dailyFocusItems],
  );

  const pageToneClass = useMemo(() => {
    if (timerVisualState.status !== "running") {
      return "radial-gradient(circle at top, #fff7ee 0%, #f6f0e7 40%, #f3ede4 100%)";
    }

    switch (timerVisualState.mode) {
      case "work":
        return `radial-gradient(circle at top, ${timerPalette.work.glow} 0%, ${timerPalette.work.glow} 24%, #f6f0e7 54%, #f3ede4 100%)`;
      case "break":
        return `radial-gradient(circle at top, ${timerPalette.break.glow} 0%, ${timerPalette.break.glow} 24%, #f6f0e7 54%, #f3ede4 100%)`;
      case "long_break":
        return `radial-gradient(circle at top, ${timerPalette.long_break.glow} 0%, ${timerPalette.long_break.glow} 24%, #f6f0e7 54%, #f3ede4 100%)`;
    }
  }, [timerVisualState]);

  useEffect(() => {
    let cancelled = false;

    async function connectWorkspace() {
      if (!supabase) {
        setPersistenceState({
          kind: "error",
          message: "Supabase env vars are missing for this deployment. Add the public Supabase URL and publishable key.",
        });
        return;
      }

      setPersistenceState({
        kind: "connecting",
        message: "Connecting workspace...",
      });

      try {
        const user = await ensureWorkspaceUser(supabase);

        if (cancelled) {
          return;
        }

        setWorkspaceUserId(user.id);

        const workspaceData = await fetchWorkspaceData(supabase, user.id);

        if (cancelled) {
          return;
        }

        setLocalLedgerState(workspaceData);
        try {
          const focusItems = await fetchDailyFocusItems(supabase, user.id);

          if (!cancelled) {
            setDailyFocusItems(focusItems);
            setDailyFocusNotice(null);
          }
        } catch (error) {
          if (!cancelled) {
            setDailyFocusItems([]);
            setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
          }
        }
        setPersistenceState({
          kind: "ready",
          message: "Workspace connected",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPersistenceState({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not connect the workspace.",
        });
      }
    }

    void connectWorkspace();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const reloadDailyFocusItems = async (userId: string) => {
    if (!supabase) {
      return;
    }

    try {
      const focusItems = await fetchDailyFocusItems(supabase, userId);
      setDailyFocusItems(focusItems);
      setDailyFocusNotice(null);
    } catch (error) {
      setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
      setDailyFocusItems([]);
    }
  };

  const prepareAttributionSelectionState = async (): Promise<AttributionSelectionState> => {
    if (!supabase || !workspaceUserId) {
      throw new Error("Workspace is not connected yet. Wait for the connection to finish before attributing work.");
    }

    const [focusItems, choresTask, mostRecentTaskId] = await Promise.all([
      fetchDailyFocusItems(supabase, workspaceUserId),
      ensureHousekeepingTask(supabase, workspaceUserId),
      fetchMostRecentAttributedTaskId(supabase, workspaceUserId),
    ]);

    setDailyFocusItems(focusItems);
    setDailyFocusNotice(null);

    const defaultTaskId = focusItems.some((item) => item.task_id === mostRecentTaskId)
      ? mostRecentTaskId
      : focusItems[0]?.task_id ?? choresTask.id;

    return {
      choresTask,
      otherSelected: false,
      otherTitle: "",
      selectedTaskIds: defaultTaskId ? [defaultTaskId] : [],
    };
  };

  const openAttributionDialog = async ({
    ledgerEvent,
    workBlock,
  }: {
    ledgerEvent: LedgerEvent;
    workBlock: WorkBlock;
  }) => {
    try {
      const selectionState = await prepareAttributionSelectionState();
      setAttributionDialogState({
        ledgerEvent,
        workBlock,
        ...selectionState,
      });
      setPersistenceState({
        kind: "saved",
        message: "Latest work block saved. Attribute it to keep task history useful.",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not prepare work attribution.",
      });
    }
  };

  const openManualWorkDialog = async () => {
    if (!supabase || !workspaceUserId) {
      setPersistenceState({
        kind: "error",
        message: "Workspace is not connected yet. Wait for the connection to finish before adding work.",
      });
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Preparing manual work entry...",
    });

    try {
      const selectionState = await prepareAttributionSelectionState();
      setManualAttributionState(selectionState);
      setIsManualDialogOpen(true);
      setPersistenceState({
        kind: "ready",
        message: "Workspace connected",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not prepare manual work attribution.",
      });
    }
  };

  const handleTimerComplete = async ({
    completedAt,
    mode,
  }: {
    completedAt: string;
    mode: TimerSession["mode"];
  }) => {
    if (mode !== "work") {
      return;
    }

    if (!supabase || !workspaceUserId) {
      setPersistenceState({
        kind: "error",
        message: "Workspace is not connected yet. Wait for the connection to finish before saving work.",
      });
      return;
    }

    const completionKey = `${mode}:${completedAt}`;

    if (handledCompletionKeysRef.current.has(completionKey)) {
      return;
    }

    handledCompletionKeysRef.current.add(completionKey);
    setPersistenceState({
      kind: "saving",
      message: "Saving completed work session...",
    });

    try {
      const artifacts = await persistCompletedWorkSession(supabase, {
        completedAt,
        mode,
        userId: workspaceUserId,
      });

      if (!artifacts) {
        setPersistenceState({
          kind: "ready",
          message: "Break sessions do not create work records.",
        });
        return;
      }

      setLocalLedgerState((current) => ({
        ledgerEvents: current.ledgerEvents.some((event) => event.id === artifacts.ledgerEvent.id)
          ? current.ledgerEvents
          : [artifacts.ledgerEvent, ...current.ledgerEvents],
        timerSessions: current.timerSessions.some((session) => session.id === artifacts.timerSession.id)
          ? current.timerSessions
          : [artifacts.timerSession, ...current.timerSessions],
        workBlocks: current.workBlocks.some((workBlock) => workBlock.id === artifacts.workBlock.id)
          ? current.workBlocks
          : [artifacts.workBlock, ...current.workBlocks],
      }));
      await openAttributionDialog({
        ledgerEvent: artifacts.ledgerEvent,
        workBlock: artifacts.workBlock,
      });
    } catch (error) {
      handledCompletionKeysRef.current.delete(completionKey);
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the completed work session.",
      });
    }
  };

  const handleManualWorkAdd = async () => {
    const durationMinutes = Number.parseInt(manualWorkMinutes, 10);

    if (!supabase || !workspaceUserId || !manualAttributionState) {
      setPersistenceState({
        kind: "error",
        message: "Workspace is not connected yet. Wait for the connection to finish before adding work.",
      });
      return;
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setPersistenceState({
        kind: "error",
        message: "Manual work block minutes must be greater than zero.",
      });
      return;
    }

    const validationMessage = getAttributionValidationMessage(manualAttributionState);

    if (validationMessage) {
      setPersistenceState({
        kind: "error",
        message: validationMessage,
      });
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Saving manual work block and attribution...",
    });

    try {
      const artifacts = await persistManualWorkBlock(supabase, {
        completedAt: new Date().toISOString(),
        durationMinutes,
        note: manualWorkNote,
        userId: workspaceUserId,
      });

      const selections = await buildAttributionSelections({
        actorLabel: "Manual work",
        humanSummary: "Captured from manual work dialog.",
        reason: "Created from manual work attribution",
        selectionState: manualAttributionState,
      });

      const attributionResult = await persistWorkBlockAttributions(supabase, {
        durationMinutes,
        ledgerEvent: artifacts.ledgerEvent,
        selections,
        userId: workspaceUserId,
        workBlockId: artifacts.workBlock.id,
      });

      setLocalLedgerState((current) => ({
        ledgerEvents: [attributionResult.ledgerEvent, ...current.ledgerEvents],
        timerSessions: [artifacts.timerSession, ...current.timerSessions],
        workBlocks: [artifacts.workBlock, ...current.workBlocks],
      }));
      await reloadDailyFocusItems(workspaceUserId);
      setManualWorkNote("");
      setManualWorkMinutes("50");
      setManualAttributionState(null);
      setIsManualDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: "Manual work block saved and attributed",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the manual work block.",
      });
    }
  };

  const handleRewardSpend = async () => {
    const redeemHours = Number.parseInt(rewardHours, 10);
    const redeemMinutePortion = Number.parseInt(rewardMinutes, 10);
    const redeemMinutes = (Number.isFinite(redeemHours) ? redeemHours : 0) * 60 +
      (Number.isFinite(redeemMinutePortion) ? redeemMinutePortion : 0);
    const derivedCostWorkBlocks = Math.max(
      1,
      Math.ceil(redeemMinutes / WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK),
    );

    if (!supabase || !workspaceUserId) {
      setPersistenceState({
        kind: "error",
        message: "Workspace is not connected yet. Wait for the connection to finish before spending rewards.",
      });
      return;
    }

    if (!Number.isFinite(redeemMinutes) || redeemMinutes <= 0) {
      setPersistenceState({
        kind: "error",
        message: "Reward minutes must be greater than zero.",
      });
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Saving reward spend...",
    });

    try {
      const { ledgerEvent } = await persistRewardSpend(supabase, {
        costWorkBlocks: derivedCostWorkBlocks,
        notes: rewardNote,
        redeemedAt: getRewardReportDate(rewardDayOffset).toISOString(),
        rewardMinutes: redeemMinutes,
        rewardName: `${formatDurationLabel(redeemHours, redeemMinutePortion)} reward block`,
        userId: workspaceUserId,
      });

      setLocalLedgerState((current) => ({
        ...current,
        ledgerEvents: [ledgerEvent, ...current.ledgerEvents],
      }));
      setRewardHours("0");
      setRewardMinutes("0");
      setRewardNote("");
      setRewardDayOffset(0);
      setIsRewardDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: "Reward spend saved",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the reward spend.",
      });
    }
  };

  const handleCompleteDailyFocusTask = async (item: DailyFocusItemWithTask) => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Completing today task...",
    });

    try {
      await completeTask(supabase, item.task, { label: "Daily focus", type: "human" }, workspaceUserId);
      await removeTaskFromDailyFocus(supabase, item.id);
      await reloadDailyFocusItems(workspaceUserId);
      setPersistenceState({
        kind: "saved",
        message: "Today task completed",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not complete the today task.",
      });
    }
  };

  const handleArchiveDailyFocusTask = async (item: DailyFocusItemWithTask) => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Archiving today task...",
    });

    try {
      await archiveTask(supabase, item.task, { label: "Daily focus", type: "human" }, workspaceUserId);
      await removeTaskFromDailyFocus(supabase, item.id);
      await reloadDailyFocusItems(workspaceUserId);
      setPersistenceState({
        kind: "saved",
        message: "Today task archived",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not archive the today task.",
      });
    }
  };

  const handleDeferDailyFocusTask = async (itemId: string) => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Updating today list...",
    });

    try {
      await removeTaskFromDailyFocus(supabase, itemId);
      await reloadDailyFocusItems(workspaceUserId);
      setPersistenceState({
        kind: "saved",
        message: "Today list updated",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update the today list.",
      });
    }
  };

  const toggleAttributionTask = (taskId: string) => {
    setAttributionDialogState((current) => {
      if (!current) {
        return current;
      }

      const selectedTaskIds = current.selectedTaskIds.includes(taskId)
        ? current.selectedTaskIds.filter((selectedTaskId) => selectedTaskId !== taskId)
        : [...current.selectedTaskIds, taskId];

      return {
        ...current,
        selectedTaskIds,
      };
    });
  };

  const toggleManualAttributionTask = (taskId: string) => {
    setManualAttributionState((current) => {
      if (!current) {
        return current;
      }

      const selectedTaskIds = current.selectedTaskIds.includes(taskId)
        ? current.selectedTaskIds.filter((selectedTaskId) => selectedTaskId !== taskId)
        : [...current.selectedTaskIds, taskId];

      return {
        ...current,
        selectedTaskIds,
      };
    });
  };

  const getAttributionValidationMessage = (selectionState: AttributionSelectionState) => {
    const trimmedOtherTitle = selectionState.otherTitle.trim();

    if (selectionState.selectedTaskIds.length === 0 && !selectionState.otherSelected) {
      return "Choose at least one task, chores/housekeeping, or other before saving attribution.";
    }

    if (selectionState.otherSelected && !trimmedOtherTitle) {
      return "Give the “other” work a short task title before saving attribution.";
    }

    return null;
  };

  const buildAttributionSelections = async ({
    actorLabel,
    humanSummary,
    reason,
    selectionState,
  }: {
    actorLabel: string;
    humanSummary: string;
    reason: string;
    selectionState: AttributionSelectionState;
  }) => {
    if (!supabase || !workspaceUserId) {
      throw new Error("Workspace is not connected yet. Wait for the connection to finish before attributing work.");
    }

    const selectedTasks = dailyFocusItems
      .map((item) => item.task)
      .filter((task, index, tasks) =>
        selectionState.selectedTaskIds.includes(task.id) &&
        tasks.findIndex((candidate) => candidate.id === task.id) === index,
      );

    const choresSelected = selectionState.selectedTaskIds.includes(selectionState.choresTask.id);
    const selections = selectedTasks.map((task) => ({
      label: task.title,
      taskId: task.id,
    }));

    if (
      choresSelected &&
      !selections.some((selection) => selection.taskId === selectionState.choresTask.id)
    ) {
      selections.push({
        label: selectionState.choresTask.title,
        taskId: selectionState.choresTask.id,
      });
    }

    if (selectionState.otherSelected) {
      const createdTask = await createTask(supabase, {
        actor: {
          label: actorLabel,
          type: "human",
        },
        humanSummary,
        priority: "medium",
        reason,
        source: "attribution_capture",
        title: selectionState.otherTitle.trim(),
        userId: workspaceUserId,
      });

      selections.push({
        label: createdTask.title,
        taskId: createdTask.id,
      });
    }

    return selections;
  };

  const handleSaveWorkAttribution = async () => {
    if (!supabase || !workspaceUserId || !attributionDialogState) {
      return;
    }

    const validationMessage = getAttributionValidationMessage(attributionDialogState);

    if (validationMessage) {
      setPersistenceState({
        kind: "error",
        message: validationMessage,
      });
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Saving work attribution...",
    });

    try {
      const selections = await buildAttributionSelections({
        actorLabel: "Work attribution",
        humanSummary: "Captured from post-work-block attribution.",
        reason: "Created from work attribution dialog",
        selectionState: attributionDialogState,
      });

      const result = await persistWorkBlockAttributions(supabase, {
        durationMinutes: attributionDialogState.workBlock.duration_minutes,
        ledgerEvent: attributionDialogState.ledgerEvent,
        selections,
        userId: workspaceUserId,
        workBlockId: attributionDialogState.workBlock.id,
      });

      setLocalLedgerState((current) => ({
        ...current,
        ledgerEvents: current.ledgerEvents.map((event) =>
          event.id === result.ledgerEvent.id ? result.ledgerEvent : event,
        ),
      }));
      await reloadDailyFocusItems(workspaceUserId);
      setAttributionDialogState(null);
      setPersistenceState({
        kind: "saved",
        message: "Work block attributed",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the work attribution.",
      });
    }
  };

  return (
    <main className="min-h-screen transition-colors duration-500" style={{ background: pageToneClass }}>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 sm:py-14">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-slate-500">{getTodayLabel()}</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Productivity OS
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              One quiet workspace for focus, recovery, and a visible work loop.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Badge className="normal-case tracking-normal" tone="neutral">
              {persistenceState.message}
            </Badge>
            <details className="group relative">
              <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-600">
                Settings
              </summary>
              <div className="absolute right-0 top-6 z-20 min-w-40 rounded-2xl border border-slate-200/90 bg-[var(--surface)]/95 p-2 shadow-[0_16px_32px_rgba(15,23,42,0.12)]">
                <Link
                  className="block rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-950"
                  href="/settings/tasks"
                >
                  Task vault
                </Link>
              </div>
            </details>
          </div>
        </header>

        {persistenceState.kind === "error" ? (
          <p className="text-sm text-rose-700">{persistenceState.message}</p>
        ) : null}

        <PomodoroTimer
          onComplete={handleTimerComplete}
          onStateChange={setTimerVisualState}
        />

        <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-900">Today&apos;s focus</p>
              <p className="text-sm text-slate-500">
                A small ordered list of the work that matters today.
              </p>
            </div>
            <Link
              className="text-sm text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
              href="/settings/tasks"
            >
              Edit list
            </Link>
          </div>

          {dailyFocusNotice ? (
            <p className="mt-4 text-sm text-rose-700">{dailyFocusNotice}</p>
          ) : dailyFocusItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No tasks are on today&apos;s list yet. Add a few from the task vault when you&apos;re ready.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {visibleDailyFocusItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{index + 1}</span>
                      <p className="text-sm font-semibold text-slate-950">{item.task.title}</p>
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {item.task.priority}
                      {item.task.area ? ` · ${item.task.area}` : ""}
                    </p>
                    {item.task.human_summary ? (
                      <p className="text-sm leading-6 text-slate-600">{item.task.human_summary}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <button
                      className="text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
                      onClick={() => void handleCompleteDailyFocusTask(item)}
                      type="button"
                    >
                      Done
                    </button>
                    <button
                      className="text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
                      onClick={() => void handleArchiveDailyFocusTask(item)}
                      type="button"
                    >
                      Archive
                    </button>
                    <button
                      className="text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
                      onClick={() => void handleDeferDailyFocusTask(item.id)}
                      type="button"
                    >
                      Later
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_22rem] lg:items-start">
          <section className="lg:col-span-2 rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
            <div className="grid gap-8 md:grid-cols-2 md:gap-0">
              <OverviewModule
                action={
                  <Button onClick={() => void openManualWorkDialog()} size="inline" variant="text">
                    Add manually
                  </Button>
                }
                body={
                  <BlockMeter
                    color="work"
                    count={todaysWorkBlocks.length}
                    label=""
                    valueLabel=""
                    zeroLabel="No completed blocks yet"
                  />
                }
                className="md:pr-8"
                footer={
                  <p className="text-sm font-medium text-slate-500">
                    {todaysWorkBlocks.length} block{todaysWorkBlocks.length === 1 ? "" : "s"}
                  </p>
                }
                ruleStyle={{ backgroundColor: timerPalette.work.progress }}
                title="Today&apos;s work"
              />

              <OverviewModule
                action={
                  <Button onClick={() => setIsRewardDialogOpen(true)} size="inline" variant="text">
                    Spend reward
                  </Button>
                }
                badge={
                  isWeekendBonusActive ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                      {WEEKEND_REWARD_MULTIPLIER_LABEL}
                    </span>
                  ) : undefined
                }
                body={
                  <BlockMeter
                    color={currentRewardMinutes < 0 ? "reward_negative" : "reward"}
                    count={Math.ceil(currentRewardBalance)}
                    label=""
                    partialCount={currentRewardBalance}
                    valueLabel=""
                    zeroLabel="No reward time yet"
                  />
                }
                className="md:border-l md:border-slate-300/80 md:pl-8"
                footer={
                  <p className="text-sm font-medium text-slate-500">
                    {currentRewardMinutes < 0
                      ? `${formatRewardMinutes(currentRewardMinutes)} behind`
                      : `${formatRewardMinutes(currentRewardMinutes)} available`}
                  </p>
                }
                ruleStyle={{ backgroundColor: rewardPalette.progress }}
                title="Reward balance"
              />
            </div>
          </section>

          <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
            <OverviewModule
              body={
                <BlockMeter
                  color="work"
                  count={weeklyWorkBlocks.length}
                  label=""
                  valueLabel=""
                  zeroLabel="No work blocks this week"
                />
              }
              footer={
                <div className="grid gap-4 border-t border-slate-200/80 pt-4">
                  <div className="space-y-1">
                    <p className="text-sm text-slate-500">Reward earned</p>
                    <p className="text-sm font-medium text-slate-900">{formatRewardMinutes(weeklyRewardMinutesEarned)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-slate-500">Work balance</p>
                    <p className="text-sm font-medium text-slate-900">
                      {currentWorkBalance} work block{Math.abs(currentWorkBalance) === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              }
              title="Weekly overview"
            />
          </section>

          <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] lg:col-start-3">
            <OverviewModule
              body={
                <LedgerEventList
                  emptyMessage="Finish a work timer to create your first saved ledger event."
                  events={recentLedgerEvents}
                />
              }
              title="Recent activity"
            />
          </section>
        </section>
      </div>

      <Dialog
        onClose={() => {
          setIsManualDialogOpen(false);
          setManualAttributionState(null);
          setManualWorkMinutes("50");
          setManualWorkNote("");
        }}
        open={isManualDialogOpen}
        title="Add missed work"
      >
        {manualAttributionState ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionField
                label="Minutes"
                inputMode="numeric"
                min="1"
                onChange={(event) => setManualWorkMinutes(event.target.value)}
                type="number"
                value={manualWorkMinutes}
              />
              <ActionField
                label="Note"
                onChange={(event) => setManualWorkNote(event.target.value)}
                placeholder="Optional note"
                value={manualWorkNote}
              />
            </div>

            <AttributionFields
              choresTask={manualAttributionState.choresTask}
              dailyFocusItems={dailyFocusItems}
              durationMinutes={Number.parseInt(manualWorkMinutes, 10) || 0}
              emptyStateMessage="No today-list tasks are available, so chores or other are the current attribution options."
              onOtherSelectedChange={(checked) =>
                setManualAttributionState((current) =>
                  current ? { ...current, otherSelected: checked } : current
                )}
              onOtherTitleChange={(value) =>
                setManualAttributionState((current) =>
                  current ? { ...current, otherTitle: value } : current
                )}
              onToggleTask={toggleManualAttributionTask}
              otherSelected={manualAttributionState.otherSelected}
              otherTitle={manualAttributionState.otherTitle}
              selectedTaskIds={manualAttributionState.selectedTaskIds}
            />

            <Button className="w-full" onClick={handleManualWorkAdd} variant="secondary">
              Save work block
            </Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={() => {
          setIsRewardDialogOpen(false);
          setRewardHours("0");
          setRewardMinutes("0");
          setRewardDayOffset(0);
          setRewardNote("");
        }}
        open={isRewardDialogOpen}
        title="Spend reward"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm text-slate-600">Reward time</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionField
                label="Hours"
                inputMode="numeric"
                min="0"
                onChange={(event) => setRewardHours(event.target.value)}
                step="1"
                type="number"
                value={rewardHours}
              />
              <ActionField
                label="Minutes"
                inputMode="numeric"
                max="55"
                min="0"
                onChange={(event) => setRewardMinutes(event.target.value)}
                step="5"
                type="number"
                value={rewardMinutes}
              />
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm text-slate-600">Day of reward block</span>
            <div className="flex items-center justify-between rounded-2xl border border-slate-300/80 bg-white/80 px-4 py-3">
              <Button
                className="text-slate-500"
                onClick={() => setRewardDayOffset((current) => current - 1)}
                size="inline"
                variant="text"
              >
                ←
              </Button>
              <span className="text-sm font-medium text-slate-900">
                {formatRewardReportDate(rewardDayOffset)}
              </span>
              {rewardDayOffset < 0 ? (
                <Button
                  className="text-slate-500"
                  onClick={() => setRewardDayOffset((current) => Math.min(current + 1, 0))}
                  size="inline"
                  variant="text"
                >
                  →
                </Button>
              ) : (
                <span className="w-4" />
              )}
            </div>
          </div>
          <ActionField
            label="Note"
            onChange={(event) => setRewardNote(event.target.value)}
            placeholder="Optional note"
            value={rewardNote}
          />
          <Button className="w-full" onClick={handleRewardSpend} variant="secondary">
            Spend reward
          </Button>
        </div>
      </Dialog>

      <Dialog
        onClose={() =>
          setPersistenceState({
            kind: "error",
            message: "Attribute the completed work block before dismissing this dialog.",
          })}
        open={Boolean(attributionDialogState)}
        title="Attribute work block"
      >
        {attributionDialogState ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              Split this completed work block across the tasks it supported.
            </p>
            <AttributionFields
              choresTask={attributionDialogState.choresTask}
              dailyFocusItems={dailyFocusItems}
              durationMinutes={attributionDialogState.workBlock.duration_minutes}
              emptyStateMessage="No today-list tasks are available, so chores or other are the current attribution options."
              onOtherSelectedChange={(checked) =>
                setAttributionDialogState((current) =>
                  current ? { ...current, otherSelected: checked } : current
                )}
              onOtherTitleChange={(value) =>
                setAttributionDialogState((current) =>
                  current ? { ...current, otherTitle: value } : current
                )}
              onToggleTask={toggleAttributionTask}
              otherSelected={attributionDialogState.otherSelected}
              otherTitle={attributionDialogState.otherTitle}
              selectedTaskIds={attributionDialogState.selectedTaskIds}
            />

            <div className="flex justify-end">
              <Button onClick={handleSaveWorkAttribution} variant="secondary">
                Save attribution
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}
