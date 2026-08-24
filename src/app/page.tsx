"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { EmailAuthPanel, type EmailAuthPanelState } from "@/components/auth/EmailAuthPanel";
import { LedgerEventList, type ActivityItem } from "@/components/ledger/LedgerEventList";
import { MiniBlocks } from "@/components/overview/MiniBlocks";
import { OverviewModule } from "@/components/overview/OverviewModule";
import { WeeklyOverview } from "@/components/overview/WeeklyOverview";
import { PomodoroTimer, type SessionEndInfo, type TimerStatus } from "@/components/timer/PomodoroTimer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { dedupeLedgerEvents } from "@/lib/ledger";
import {
  computeScreenTimePenalty,
  fetchBehaviorEvents,
  getBehaviorExerciseMinutes,
  getBehaviorTypeLabel,
  hardDeleteBehaviorEvent,
  INDULGENCE_PENALTY_MINUTES,
  persistBehaviorEvent,
  updateBehaviorEvent,
} from "@/lib/behaviors";
import { getModeDurationMinutes } from "@/lib/timer";
import {
  behaviorEventsToSettlementEvents,
  computeSettlement,
  getWorkDurationMinutes,
  isWeekendDate,
  ledgerEventsToSettlementEvents,
  REWARD_BLOCK_MINUTES,
  restMinutesForWorkMinutes,
  rewardMinutesForWorkMinutes,
  WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK,
  WEEKEND_REWARD_MULTIPLIER_LABEL,
  WORK_BLOCK_WORK_MINUTES,
} from "@/lib/economy";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createTask,
  ensureHousekeepingTask,
  fetchDailyFocusItems,
  fetchMostRecentAttributedTaskId,
  fetchTasksByIds,
} from "@/lib/tasks";
import { exercisePalette, penaltyPalette, rewardPalette, timerPalette } from "@/lib/timerPalette";
import {
  AUTH_REQUIRED_MESSAGE,
  ensureWorkspaceUser,
  fetchAttributionSelectionsForWorkBlock,
  fetchWorkspaceData,
  getManualWorkDefaultsFromLedgerEvent,
  getRewardSpendDefaultsFromLedgerEvent,
  hardDeleteLedgerEvent,
  hardResetWorkspace,
  isEditableLedgerEvent,
  persistCompletedWorkSession,
  persistManualWorkBlock,
  persistRewardSpend,
  persistWorkBlockAttributions,
  updateManualWorkEntry,
  updateRewardSpendEntry,
} from "@/lib/workspace";
import { archiveTask, completeTask, removeTaskFromDailyFocus } from "@/lib/tasks";
import type {
  BehaviorEvent,
  BehaviorType,
  DailyFocusItemWithTask,
  LedgerEvent,
  Task,
  TimerMode,
  TimerSession,
  WorkBlock,
} from "@/lib/types";

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
  | { kind: "auth_required"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

type AttributionSelectionState = {
  availableTasks: Task[];
  choresTask: Task;
  otherSelected: boolean;
  otherTitle: string;
  selectedTaskIds: string[];
};

type AttributionDialogState = AttributionSelectionState & {
  ledgerEvent: LedgerEvent;
  workBlock: WorkBlock;
};

type ManualWorkDialogMode =
  | { kind: "create" }
  | { kind: "edit"; ledgerEvent: LedgerEvent };

type RewardDialogMode =
  | { kind: "create" }
  | { kind: "edit"; ledgerEvent: LedgerEvent };

type BehaviorDialogState = {
  behaviorType: BehaviorType;
  screenTimeMinutes: string;
  screenTimeDate: string;
  exerciseMinutes: string;
  note: string;
};

const INITIAL_BEHAVIOR_DIALOG_STATE: BehaviorDialogState = {
  behaviorType: "indulgence",
  screenTimeMinutes: "",
  screenTimeDate: "",
  exerciseMinutes: "",
  note: "",
};

type PendingSessionEnd = {
  completedAt: string;
  overageSeconds: number;
};

type BehaviorDialogMode = { kind: "create" } | { kind: "edit"; event: BehaviorEvent };

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
  // Round up for display only; the underlying settlement keeps fractional minutes.
  const absoluteMinutes = Math.ceil(Math.abs(totalMinutes));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const prefix = totalMinutes < 0 ? "-" : "";

  return `${prefix}${hours}:${minutes.toString().padStart(2, "0")}`;
}

function toDateInputValue(isoTimestamp: string) {
  const date = new Date(isoTimestamp);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 10);
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
  availableTasks: Task[];
  choresTask: Task;
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
  availableTasks,
  choresTask,
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
        {availableTasks.length > 0 ? (
          availableTasks.map((task) => {
            const checked = selectedTaskIds.includes(task.id);

            return (
              <label
                key={task.id}
                className="flex items-start gap-3 rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3"
              >
                <input
                  checked={checked}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  onChange={() => onToggleTask(task.id)}
                  type="checkbox"
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-950">{task.title}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {task.priority}
                    {task.area ? ` · ${task.area}` : ""}
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

export default function HomePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [localLedgerState, setLocalLedgerState] = useState(INITIAL_STATE);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>({
    kind: "connecting",
    message: "Connecting workspace...",
  });
  const [authPanelState, setAuthPanelState] = useState<EmailAuthPanelState>({
    kind: "idle",
    message: null,
  });
  const [timerVisualState, setTimerVisualState] = useState<{
    mode: TimerMode;
    status: TimerStatus;
  }>({
    mode: "work",
    status: "idle",
  });
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [workspaceUserEmail, setWorkspaceUserEmail] = useState<string | null>(null);
  const [signInEmail, setSignInEmail] = useState("");
  const [dailyFocusItems, setDailyFocusItems] = useState<DailyFocusItemWithTask[]>([]);
  const [dailyFocusNotice, setDailyFocusNotice] = useState<string | null>(null);
  const [attributionDialogState, setAttributionDialogState] = useState<AttributionDialogState | null>(null);
  const [manualAttributionState, setManualAttributionState] = useState<AttributionSelectionState | null>(null);
  const [manualWorkDialogMode, setManualWorkDialogMode] = useState<ManualWorkDialogMode>({ kind: "create" });
  const [manualWorkMinutes, setManualWorkMinutes] = useState("50");
  const [manualWorkNote, setManualWorkNote] = useState("");
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isRewardDialogOpen, setIsRewardDialogOpen] = useState(false);
  const [rewardDialogMode, setRewardDialogMode] = useState<RewardDialogMode>({ kind: "create" });
  const [rewardHours, setRewardHours] = useState("0");
  const [rewardMinutes, setRewardMinutes] = useState("0");
  const [rewardDayOffset, setRewardDayOffset] = useState(0);
  const [rewardNote, setRewardNote] = useState("");
  const [ledgerDeleteDialogState, setLedgerDeleteDialogState] = useState<LedgerEvent | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [behaviorEvents, setBehaviorEvents] = useState<BehaviorEvent[]>([]);
  const [isBehaviorDialogOpen, setIsBehaviorDialogOpen] = useState(false);
  const [behaviorDialogState, setBehaviorDialogState] = useState<BehaviorDialogState>(INITIAL_BEHAVIOR_DIALOG_STATE);
  const [behaviorDialogMode, setBehaviorDialogMode] = useState<BehaviorDialogMode>({ kind: "create" });
  const [behaviorDeleteTarget, setBehaviorDeleteTarget] = useState<BehaviorEvent | null>(null);
  const [breakRequest, setBreakRequest] = useState<{ token: number; minutes: number } | null>(null);
  const [pendingSessionEnd, setPendingSessionEnd] = useState<PendingSessionEnd | null>(null);
  const handledCompletionKeysRef = useRef(new Set<string>());

  const dedupedWorkBlocks = useMemo(
    () => dedupeWorkBlocks(localLedgerState.workBlocks),
    [localLedgerState.workBlocks],
  );

  const dedupedLedgerEvents = useMemo(
    () => dedupeLedgerEvents(localLedgerState.ledgerEvents),
    [localLedgerState.ledgerEvents],
  );

  const todaysWorkMinutes = useMemo(
    () =>
      dedupedWorkBlocks
        .filter((workBlock) => isToday(workBlock.earned_at))
        .reduce((total, workBlock) => total + workBlock.duration_minutes, 0),
    [dedupedWorkBlocks],
  );

  const exerciseMinutes = useMemo(
    () => getBehaviorExerciseMinutes(behaviorEvents),
    [behaviorEvents],
  );

  const settlement = useMemo(() => {
    const events = [
      ...ledgerEventsToSettlementEvents(dedupedLedgerEvents),
      ...behaviorEventsToSettlementEvents(behaviorEvents),
    ];

    return computeSettlement(events);
  }, [dedupedLedgerEvents, behaviorEvents]);

  const rewardDisplay = useMemo(() => {
    const exerciseVisibleMinutes = Math.min(exerciseMinutes, settlement.positiveMinutes);

    return {
      exerciseVisibleMinutes,
      positiveWorkMinutes: settlement.positiveMinutes - exerciseVisibleMinutes,
    };
  }, [exerciseMinutes, settlement.positiveMinutes]);

  const isWeekendBonusActive = useMemo(
    () => isWeekendDate(new Date().toISOString()),
    [],
  );

  const weeklyWorkBlocks = useMemo(
    () => dedupedWorkBlocks.filter((workBlock) => isThisWeek(workBlock.earned_at)),
    [dedupedWorkBlocks],
  );

  const weeklyRewardWorkMinutes = useMemo(
    () =>
      dedupedLedgerEvents
        .filter((event) => event.event_type === "work_earned" && isThisWeek(event.created_at))
        .reduce(
          (total, event) =>
            total +
            rewardMinutesForWorkMinutes(
              getWorkDurationMinutes(event),
              isWeekendDate(event.created_at),
            ),
          0,
        ),
    [dedupedLedgerEvents],
  );

  const weeklyWorkMinutes = useMemo(
    () => weeklyWorkBlocks.reduce((total, workBlock) => total + workBlock.duration_minutes, 0),
    [weeklyWorkBlocks],
  );

  const weeklyExerciseMinutes = useMemo(
    () =>
      behaviorEvents
        .filter((event) => event.behavior_type === "exercise" && isThisWeek(event.occurred_at))
        .reduce((total, event) => total + (event.duration_minutes ?? 0), 0),
    [behaviorEvents],
  );

  const weeklyPenaltyMinutes = useMemo(
    () =>
      behaviorEvents
        .filter((event) => event.behavior_type !== "exercise" && isThisWeek(event.occurred_at))
        .reduce((total, event) => total + (event.penalty_minutes ?? 0), 0),
    [behaviorEvents],
  );

  const recentActivityItems = useMemo(
    () => {
      const ledgerItems = dedupedLedgerEvents.map((event) => ({ kind: "ledger" as const, event }));
      const behaviorItems = behaviorEvents.map((event) => ({ kind: "behavior" as const, event }));
      const timestampOf = (item: ActivityItem) =>
        item.kind === "ledger" ? item.event.created_at : item.event.occurred_at;

      return [...ledgerItems, ...behaviorItems]
        .sort((left, right) => timestampOf(right).localeCompare(timestampOf(left)))
        .slice(0, 8);
    },
    [dedupedLedgerEvents, behaviorEvents],
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
        setWorkspaceUserEmail(user.email ?? null);
        setAuthPanelState({
          kind: "idle",
          message: null,
        });

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
        try {
          const behaviorEventRows = await fetchBehaviorEvents(supabase, user.id);

          if (!cancelled) {
            setBehaviorEvents(behaviorEventRows);
          }
        } catch {
          if (!cancelled) {
            setBehaviorEvents([]);
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

        const message = error instanceof Error ? error.message : "Could not connect the workspace.";
        const needsAuth = message === AUTH_REQUIRED_MESSAGE;

        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setLocalLedgerState(INITIAL_STATE);
        setDailyFocusItems([]);

        setPersistenceState({
          kind: needsAuth ? "auth_required" : "error",
          message,
        });
      }
    }

    void connectWorkspace();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;

      if (!user) {
        handledCompletionKeysRef.current.clear();
        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setLocalLedgerState(INITIAL_STATE);
        setDailyFocusItems([]);
        setDailyFocusNotice(null);
        setBehaviorEvents([]);
        setPersistenceState({
          kind: "auth_required",
          message: AUTH_REQUIRED_MESSAGE,
        });
        return;
      }

      setWorkspaceUserId(user.id);
      setWorkspaceUserEmail(user.email ?? null);
      setAuthPanelState({
        kind: "idle",
        message: null,
      });
      setPersistenceState({
        kind: "connecting",
        message: "Loading workspace...",
      });

      void fetchWorkspaceData(supabase, user.id)
        .then(async (workspaceData) => {
          setLocalLedgerState(workspaceData);

          try {
            const focusItems = await fetchDailyFocusItems(supabase, user.id);
            setDailyFocusItems(focusItems);
            setDailyFocusNotice(null);
          } catch (error) {
            setDailyFocusItems([]);
            setDailyFocusNotice(error instanceof Error ? error.message : "Could not load daily focus items.");
          }

          try {
            const behaviorEventRows = await fetchBehaviorEvents(supabase, user.id);
            setBehaviorEvents(behaviorEventRows);
          } catch {
            setBehaviorEvents([]);
          }

          setPersistenceState({
            kind: "ready",
            message: "Workspace connected",
          });
        })
        .catch((error) => {
          setPersistenceState({
            kind: "error",
            message: error instanceof Error ? error.message : "Could not load the workspace.",
          });
        });
    });

    return () => {
      subscription.unsubscribe();
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

  const reloadWorkspaceData = async (userId: string) => {
    if (!supabase) {
      return;
    }

    const workspaceData = await fetchWorkspaceData(supabase, userId);
    setLocalLedgerState(workspaceData);
  };

  const reloadBehaviorEvents = async (userId: string) => {
    if (!supabase) {
      return;
    }

    try {
      const events = await fetchBehaviorEvents(supabase, userId);
      setBehaviorEvents(events);
    } catch {
      setBehaviorEvents([]);
    }
  };

  const getRewardDayOffsetFromTimestamp = (isoTimestamp: string) => {
    const target = new Date(isoTimestamp);
    target.setHours(12, 0, 0, 0);
    const today = getRewardReportDate(0);
    const millisPerDay = 24 * 60 * 60 * 1000;
    return Math.round((target.getTime() - today.getTime()) / millisPerDay);
  };

  const prepareAttributionSelectionState = async ({
    preselectedTaskIds,
  }: {
    preselectedTaskIds?: string[];
  } = {}): Promise<AttributionSelectionState> => {
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

    const focusTasks = focusItems.map((item) => item.task);
    const normalizedPreselectedTaskIds = preselectedTaskIds?.filter((taskId) => taskId !== choresTask.id) ?? [];
    const missingTaskIds = normalizedPreselectedTaskIds.filter(
      (taskId) => !focusTasks.some((task) => task.id === taskId),
    );
    const additionalTasks = missingTaskIds.length > 0
      ? await fetchTasksByIds(supabase, workspaceUserId, missingTaskIds)
      : [];
    const availableTasks = [...focusTasks, ...additionalTasks].filter(
      (task, index, tasks) => tasks.findIndex((candidate) => candidate.id === task.id) === index,
    );
    const defaultTaskId = preselectedTaskIds && preselectedTaskIds.length > 0
      ? null
      : focusItems.some((item) => item.task_id === mostRecentTaskId)
        ? mostRecentTaskId
        : focusItems[0]?.task_id ?? choresTask.id;
    const selectedTaskIds = preselectedTaskIds && preselectedTaskIds.length > 0
      ? Array.from(new Set(preselectedTaskIds))
      : defaultTaskId
        ? [defaultTaskId]
        : [];

    return {
      availableTasks,
      choresTask,
      otherSelected: false,
      otherTitle: "",
      selectedTaskIds,
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
      setManualWorkDialogMode({ kind: "create" });
      setManualWorkMinutes("50");
      setManualWorkNote("");
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

  const handleEndSession = (session: SessionEndInfo) => {
    setPendingSessionEnd({
      completedAt: session.completedAt,
      overageSeconds: session.overageSeconds,
    });
  };

  const handleConfirmSessionLog = async (uninterrupted: boolean) => {
    if (!supabase || !workspaceUserId || !pendingSessionEnd) {
      return;
    }

    const plannedMinutes = getModeDurationMinutes("work");
    const totalMinutes = uninterrupted
      ? Math.max(
          plannedMinutes,
          Math.round((plannedMinutes * 60 + pendingSessionEnd.overageSeconds) / 60),
        )
      : plannedMinutes;

    setPersistenceState({
      kind: "saving",
      message: "Saving completed work session...",
    });

    try {
      const artifacts = await persistCompletedWorkSession(supabase, {
        completedAt: pendingSessionEnd.completedAt,
        durationMinutes: totalMinutes,
        mode: "work",
        userId: workspaceUserId,
      });

      if (!artifacts) {
        setPendingSessionEnd(null);
        setPersistenceState({ kind: "ready", message: "Workspace connected" });
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

      setPendingSessionEnd(null);
      if (uninterrupted) {
        setBreakRequest({ token: Date.now(), minutes: restMinutesForWorkMinutes(totalMinutes) });
      }
      await openAttributionDialog({
        ledgerEvent: artifacts.ledgerEvent,
        workBlock: artifacts.workBlock,
      });
    } catch (error) {
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
      const selections = await buildAttributionSelections({
        actorLabel: manualWorkDialogMode.kind === "edit" ? "Manual work edit" : "Manual work",
        humanSummary:
          manualWorkDialogMode.kind === "edit"
            ? "Updated from manual work edit dialog."
            : "Captured from manual work dialog.",
        reason:
          manualWorkDialogMode.kind === "edit"
            ? "Created while editing a manual work attribution"
            : "Created from manual work attribution",
        selectionState: manualAttributionState,
      });

      if (manualWorkDialogMode.kind === "edit") {
        await updateManualWorkEntry(supabase, {
          actorLabel: "Manual work edit",
          durationMinutes,
          ledgerEvent: manualWorkDialogMode.ledgerEvent,
          note: manualWorkNote,
          selections,
          userId: workspaceUserId,
        });
        await reloadWorkspaceData(workspaceUserId);
      } else {
        const artifacts = await persistManualWorkBlock(supabase, {
          completedAt: new Date().toISOString(),
          durationMinutes,
          note: manualWorkNote,
          userId: workspaceUserId,
        });

        await persistWorkBlockAttributions(supabase, {
          durationMinutes,
          ledgerEvent: artifacts.ledgerEvent,
          note: manualWorkNote,
          selections,
          userId: workspaceUserId,
          workBlockId: artifacts.workBlock.id,
        });

        await reloadWorkspaceData(workspaceUserId);
      }

      await reloadDailyFocusItems(workspaceUserId);
      setManualWorkNote("");
      setManualWorkMinutes("50");
      setManualAttributionState(null);
      setManualWorkDialogMode({ kind: "create" });
      setIsManualDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: manualWorkDialogMode.kind === "edit"
          ? "Manual work block updated"
          : "Manual work block saved and attributed",
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
      const rewardName = `${formatDurationLabel(redeemHours, redeemMinutePortion)} reward block`;
      const redeemedAt = getRewardReportDate(rewardDayOffset).toISOString();

      if (rewardDialogMode.kind === "edit") {
        await updateRewardSpendEntry(supabase, {
          costWorkBlocks: derivedCostWorkBlocks,
          ledgerEvent: rewardDialogMode.ledgerEvent,
          notes: rewardNote,
          redeemedAt,
          rewardMinutes: redeemMinutes,
          rewardName,
          userId: workspaceUserId,
        });
        await reloadWorkspaceData(workspaceUserId);
      } else {
        await persistRewardSpend(supabase, {
          costWorkBlocks: derivedCostWorkBlocks,
          notes: rewardNote,
          redeemedAt,
          rewardMinutes: redeemMinutes,
          rewardName,
          userId: workspaceUserId,
        });
        await reloadWorkspaceData(workspaceUserId);
      }

      setRewardHours("0");
      setRewardMinutes("0");
      setRewardNote("");
      setRewardDayOffset(0);
      setRewardDialogMode({ kind: "create" });
      setIsRewardDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: rewardDialogMode.kind === "edit" ? "Reward spend updated" : "Reward spend saved",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the reward spend.",
      });
    }
  };

  const handleSaveBehaviorEvent = async () => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    let durationMinutes: number | null = null;
    let occurredAt: string | undefined;

    if (behaviorDialogState.behaviorType === "screen_time") {
      const screenMinutes = Number.parseInt(behaviorDialogState.screenTimeMinutes, 10);

      if (!Number.isFinite(screenMinutes) || screenMinutes <= 0) {
        setPersistenceState({
          kind: "error",
          message: "Enter your total screen time for the day in minutes.",
        });
        return;
      }

      durationMinutes = screenMinutes;

      if (behaviorDialogState.screenTimeDate) {
        occurredAt = new Date(`${behaviorDialogState.screenTimeDate}T12:00:00`).toISOString();
      }
    } else if (behaviorDialogState.behaviorType === "exercise") {
      const workoutMinutes = Number.parseInt(behaviorDialogState.exerciseMinutes, 10);

      if (!Number.isFinite(workoutMinutes) || workoutMinutes <= 0) {
        setPersistenceState({
          kind: "error",
          message: "Enter your workout length in minutes.",
        });
        return;
      }

      durationMinutes = workoutMinutes;
    }

    setPersistenceState({
      kind: "saving",
      message: "Saving behavior entry...",
    });

    try {
      if (behaviorDialogMode.kind === "edit") {
        await updateBehaviorEvent(supabase, {
          eventId: behaviorDialogMode.event.id,
          behaviorType: behaviorDialogState.behaviorType,
          durationMinutes,
          note: behaviorDialogState.note,
          occurredAt,
          userId: workspaceUserId,
        });
      } else {
        await persistBehaviorEvent(supabase, {
          behaviorType: behaviorDialogState.behaviorType,
          durationMinutes,
          note: behaviorDialogState.note,
          occurredAt,
          userId: workspaceUserId,
        });
      }

      await reloadBehaviorEvents(workspaceUserId);
      setIsBehaviorDialogOpen(false);
      setBehaviorDialogState(INITIAL_BEHAVIOR_DIALOG_STATE);
      setBehaviorDialogMode({ kind: "create" });
      setPersistenceState({
        kind: "saved",
        message: behaviorDialogMode.kind === "edit" ? "Behavior entry updated" : "Behavior entry saved",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the behavior entry.",
      });
    }
  };

  const handleRequestEditBehavior = (event: BehaviorEvent) => {
    setBehaviorDialogMode({ kind: "edit", event });
    setBehaviorDialogState({
      behaviorType: event.behavior_type,
      screenTimeMinutes:
        event.behavior_type === "screen_time" ? String(event.duration_minutes ?? "") : "",
      screenTimeDate: event.behavior_type === "screen_time" ? toDateInputValue(event.occurred_at) : "",
      exerciseMinutes: event.behavior_type === "exercise" ? String(event.duration_minutes ?? "") : "",
      note: event.note ?? "",
    });
    setIsBehaviorDialogOpen(true);
  };

  const handleRequestDeleteBehavior = (event: BehaviorEvent) => {
    setBehaviorDeleteTarget(event);
  };

  const handleConfirmDeleteBehavior = async () => {
    if (!supabase || !workspaceUserId || !behaviorDeleteTarget) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Deleting behavior entry...",
    });

    try {
      await hardDeleteBehaviorEvent(supabase, {
        eventId: behaviorDeleteTarget.id,
        userId: workspaceUserId,
      });
      await reloadBehaviorEvents(workspaceUserId);
      setBehaviorDeleteTarget(null);
      setPersistenceState({
        kind: "saved",
        message: "Behavior entry deleted",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not delete the behavior entry.",
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

    const selectedTasks = selectionState.availableTasks
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

  const handleMagicLinkSignIn = async () => {
    if (!supabase) {
      setAuthPanelState({
        kind: "error",
        message: "Supabase env vars are missing for this deployment.",
      });
      return;
    }

    const trimmedEmail = signInEmail.trim();

    if (!trimmedEmail) {
      setAuthPanelState({
        kind: "error",
        message: "Enter your email address to receive a sign-in link.",
      });
      return;
    }

    setAuthPanelState({
      kind: "sending",
      message: "Sending sign-in link...",
    });

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthPanelState({
        kind: "error",
        message: error.message || "Could not send the sign-in link.",
      });
      return;
    }

    setAuthPanelState({
      kind: "sent",
      message: `Check ${trimmedEmail} for your sign-in link.`,
    });
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }

    setPersistenceState({
      kind: "connecting",
      message: "Signing out...",
    });

    const { error } = await supabase.auth.signOut();

    if (error) {
      setPersistenceState({
        kind: "error",
        message: error.message || "Could not sign out.",
      });
    }
  };

  const handleRequestLedgerEdit = async (event: LedgerEvent) => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    try {
      if (event.event_type === "work_earned" && event.source === "manual_entry") {
        const defaults = getManualWorkDefaultsFromLedgerEvent(event);

        if (!defaults.workBlockId || !defaults.durationMinutes) {
          throw new Error("This manual work event is missing its linked work block details.");
        }

        const selections = await fetchAttributionSelectionsForWorkBlock(supabase, {
          userId: workspaceUserId,
          workBlockId: defaults.workBlockId,
        });
        const selectionState = await prepareAttributionSelectionState({
          preselectedTaskIds: selections.map((selection) => selection.taskId),
        });

        setManualWorkDialogMode({
          kind: "edit",
          ledgerEvent: event,
        });
        setManualAttributionState({
          ...selectionState,
          selectedTaskIds: selections.map((selection) => selection.taskId),
        });
        setManualWorkMinutes(String(defaults.durationMinutes));
        setManualWorkNote(defaults.note ?? "");
        setIsManualDialogOpen(true);
        setPersistenceState({
          kind: "ready",
          message: "Editing manual work block",
        });
        return;
      }

      if (event.event_type === "reward_spent" && event.source === "manual_reward_redemption") {
        const defaults = getRewardSpendDefaultsFromLedgerEvent(event);
        const rewardMinutesValue = defaults.rewardMinutes ?? 0;
        const rewardHoursValue = Math.floor(rewardMinutesValue / 60);
        const rewardMinuteValue = rewardMinutesValue % 60;

        setRewardDialogMode({
          kind: "edit",
          ledgerEvent: event,
        });
        setRewardHours(String(rewardHoursValue));
        setRewardMinutes(String(rewardMinuteValue));
        setRewardDayOffset(getRewardDayOffsetFromTimestamp(event.created_at));
        setRewardNote(defaults.notes);
        setIsRewardDialogOpen(true);
        setPersistenceState({
          kind: "ready",
          message: "Editing reward spend",
        });
      }
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not prepare the ledger edit.",
      });
    }
  };

  const handleRequestLedgerDelete = (event: LedgerEvent) => {
    setLedgerDeleteDialogState(event);
  };

  const handleConfirmLedgerDelete = async () => {
    if (!supabase || !workspaceUserId || !ledgerDeleteDialogState) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Deleting ledger event...",
    });

    try {
      await hardDeleteLedgerEvent(supabase, {
        ledgerEvent: ledgerDeleteDialogState,
        userId: workspaceUserId,
      });
      await reloadWorkspaceData(workspaceUserId);
      await reloadDailyFocusItems(workspaceUserId);
      setLedgerDeleteDialogState(null);
      setPersistenceState({
        kind: "saved",
        message: "Ledger event deleted",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not delete the ledger event.",
      });
    }
  };

  const handleConfirmReset = async () => {
    if (!supabase || !workspaceUserId) {
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Resetting workspace...",
    });

    try {
      await hardResetWorkspace(supabase, { userId: workspaceUserId });
      await reloadWorkspaceData(workspaceUserId);
      await reloadDailyFocusItems(workspaceUserId);
      await reloadBehaviorEvents(workspaceUserId);
      setIsResetDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: "Workspace reset",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not reset the workspace.",
      });
    }
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
            {workspaceUserEmail ? (
              <p className="text-sm text-slate-500">
                Logged in as: <span className="font-medium text-slate-900">{workspaceUserEmail}</span>
              </p>
            ) : null}
            <Badge className="normal-case tracking-normal" tone="neutral">
              {persistenceState.message}
            </Badge>
            <PopoverMenu
              buttonClassName="text-xs uppercase tracking-[0.18em] text-slate-400 hover:text-slate-600"
              label="Settings"
              menuClassName="min-w-40 rounded-2xl bg-[var(--surface)]/95 shadow-[0_16px_32px_rgba(15,23,42,0.12)]"
            >
              <Link
                className="block rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-950"
                href="/settings/tasks"
              >
                Task vault
              </Link>
              {workspaceUserId ? (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-950"
                  onClick={() => setIsResetDialogOpen(true)}
                  type="button"
                >
                  Reset workspace
                </button>
              ) : null}
              {workspaceUserId ? (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-950"
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  Sign out
                </button>
              ) : null}
            </PopoverMenu>
          </div>
        </header>

        {persistenceState.kind === "error" ? (
          <p className="text-sm text-rose-700">{persistenceState.message}</p>
        ) : null}

        {!workspaceUserId ? (
          <EmailAuthPanel
            email={signInEmail}
            onEmailChange={setSignInEmail}
            onSubmit={() => void handleMagicLinkSignIn()}
            state={authPanelState}
          />
        ) : (
          <>
            <PomodoroTimer
              breakRequest={breakRequest}
              onComplete={handleTimerComplete}
              onEndSession={handleEndSession}
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
                  todaysWorkMinutes > 0 ? (
                    <MiniBlocks
                      color={timerPalette.work.progress}
                      minutes={todaysWorkMinutes}
                      minutesPerBlock={WORK_BLOCK_WORK_MINUTES}
                    />
                  ) : (
                    <div className="text-xs text-slate-400">No completed blocks yet</div>
                  )
                }
                className="md:pr-8"
                footer={
                  <p className="text-sm font-medium text-slate-500">
                    {formatRewardMinutes(todaysWorkMinutes)}
                  </p>
                }
                ruleStyle={{ backgroundColor: timerPalette.work.progress }}
                title="Today&apos;s work"
              />

              <OverviewModule
                action={
                  <div className="flex flex-col items-start gap-1">
                    <Button onClick={() => setIsRewardDialogOpen(true)} size="inline" variant="text">
                      Spend reward
                    </Button>
                    <Button onClick={() => setIsBehaviorDialogOpen(true)} size="inline" variant="text">
                      Behavior tracking
                    </Button>
                  </div>
                }
                badge={
                  isWeekendBonusActive ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                      {WEEKEND_REWARD_MULTIPLIER_LABEL}
                    </span>
                  ) : undefined
                }
                body={
                  settlement.positiveMinutes > 0 ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <MiniBlocks
                        color={rewardPalette.progress}
                        minutes={rewardDisplay.positiveWorkMinutes}
                        minutesPerBlock={REWARD_BLOCK_MINUTES}
                      />
                      <MiniBlocks
                        color={exercisePalette.progress}
                        minutes={rewardDisplay.exerciseVisibleMinutes}
                        minutesPerBlock={REWARD_BLOCK_MINUTES}
                      />
                    </div>
                  ) : settlement.penaltyRemainingMinutes > 0 || settlement.debtMinutes > 0 ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {settlement.penaltyRemainingMinutes > 0 ? (
                        <MiniBlocks
                          color={penaltyPalette.progress}
                          minutes={settlement.penaltyRemainingMinutes}
                          minutesPerBlock={REWARD_BLOCK_MINUTES}
                        />
                      ) : null}
                      {settlement.debtMinutes > 0 ? (
                        <MiniBlocks
                          color={rewardPalette.progress}
                          fillMinutes={settlement.overdrawFillMinutes}
                          minutes={settlement.overdrawFrameMinutes}
                          minutesPerBlock={REWARD_BLOCK_MINUTES}
                          variant="outline"
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">No reward time yet</div>
                  )
                }
                className="md:border-l md:border-slate-300/80 md:pl-8"
                footer={
                  <p className="text-sm font-medium text-slate-500">
                    {settlement.netMinutes < 0
                      ? `${formatRewardMinutes(settlement.netMinutes)} behind`
                      : `${formatRewardMinutes(settlement.netMinutes)} available`}
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
                <WeeklyOverview
                  exerciseMinutes={weeklyExerciseMinutes}
                  penaltyMinutes={weeklyPenaltyMinutes}
                  rewardWorkMinutes={weeklyRewardWorkMinutes}
                  workMinutes={weeklyWorkMinutes}
                />
              }
              title="Weekly overview"
            />
          </section>

          <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] lg:col-start-3">
            <OverviewModule
              body={
                <LedgerEventList
                  emptyMessage="Finish a work timer to create your first saved ledger event."
                  items={recentActivityItems}
                  onRequestDelete={handleRequestLedgerDelete}
                  onRequestEdit={handleRequestLedgerEdit}
                  onRequestDeleteBehavior={handleRequestDeleteBehavior}
                  onRequestEditBehavior={handleRequestEditBehavior}
                  showEditAction={isEditableLedgerEvent}
                />
              }
              title="Recent activity"
            />
              </section>
            </section>
          </>
        )}
      </div>

      <Dialog
        onClose={() => {
          setIsManualDialogOpen(false);
          setManualAttributionState(null);
          setManualWorkDialogMode({ kind: "create" });
          setManualWorkMinutes("50");
          setManualWorkNote("");
        }}
        open={isManualDialogOpen}
        title={manualWorkDialogMode.kind === "edit" ? "Edit work block" : "Add missed work"}
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
              availableTasks={manualAttributionState.availableTasks}
              choresTask={manualAttributionState.choresTask}
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
              {manualWorkDialogMode.kind === "edit" ? "Save changes" : "Save work block"}
            </Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={() => {
          setIsRewardDialogOpen(false);
          setRewardDialogMode({ kind: "create" });
          setRewardHours("0");
          setRewardMinutes("0");
          setRewardDayOffset(0);
          setRewardNote("");
        }}
        open={isRewardDialogOpen}
        title={rewardDialogMode.kind === "edit" ? "Edit reward spend" : "Spend reward"}
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
            {rewardDialogMode.kind === "edit" ? "Save changes" : "Spend reward"}
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
              availableTasks={attributionDialogState.availableTasks}
              choresTask={attributionDialogState.choresTask}
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

      <Dialog
        onClose={() => setLedgerDeleteDialogState(null)}
        open={Boolean(ledgerDeleteDialogState)}
        title="Delete ledger event?"
      >
        {ledgerDeleteDialogState ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              Are you sure? This will permanently remove this event and its linked records from your ledger.
            </p>
            <div className="rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
              <p className="text-sm font-medium text-slate-950">
                {ledgerDeleteDialogState.event_type === "reward_spent" ? "Reward spend" : "Work event"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {formatTimestamp(ledgerDeleteDialogState.created_at)} via {ledgerDeleteDialogState.source.replaceAll("_", " ")}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setLedgerDeleteDialogState(null)} variant="text">
                Cancel
              </Button>
              <Button onClick={handleConfirmLedgerDelete} variant="secondary">
                Delete event
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={() => setIsResetDialogOpen(false)}
        open={isResetDialogOpen}
        title="Reset workspace"
      >
        <div className="space-y-5">
          <p className="text-sm leading-6 text-slate-600">
            This will permanently zero out today&apos;s work, the entire reward balance, the weekly overview, and clear
            the recent activity ledger. This cannot be undone.
          </p>
          <div className="rounded-[0.8rem] border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm font-medium text-rose-700">Hard reset — this action is irreversible.</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setIsResetDialogOpen(false)} variant="text">
              Cancel
            </Button>
            <Button onClick={handleConfirmReset} variant="secondary">
              Reset workspace
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        onClose={() => {
          setIsBehaviorDialogOpen(false);
          setBehaviorDialogState(INITIAL_BEHAVIOR_DIALOG_STATE);
          setBehaviorDialogMode({ kind: "create" });
        }}
        open={isBehaviorDialogOpen}
        title={behaviorDialogMode.kind === "edit" ? "Edit behavior entry" : "Behavior tracking"}
      >
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {(["indulgence", "screen_time", "exercise"] as BehaviorType[]).map((type) => {
              const selected = behaviorDialogState.behaviorType === type;

              return (
                <Button
                  key={type}
                  aria-pressed={selected}
                  onClick={() =>
                    setBehaviorDialogState((current) => ({ ...current, behaviorType: type }))
                  }
                  variant={selected ? "primary" : "secondary"}
                >
                  {getBehaviorTypeLabel(type)}
                </Button>
              );
            })}
          </div>

          {behaviorDialogState.behaviorType === "indulgence" ? (
            <div className="rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
              <p className="text-sm text-slate-600">
                Records a flat{" "}
                <span className="font-medium text-slate-900">{INDULGENCE_PENALTY_MINUTES} minute</span> reward
                deficit.
              </p>
            </div>
          ) : null}

          {behaviorDialogState.behaviorType === "screen_time" ? (
            <div className="space-y-3">
              <ActionField
                label="Day"
                onChange={(event) =>
                  setBehaviorDialogState((current) => ({ ...current, screenTimeDate: event.target.value }))
                }
                type="date"
                value={behaviorDialogState.screenTimeDate}
              />
              <ActionField
                label="Total screen time (minutes)"
                inputMode="numeric"
                min="0"
                onChange={(event) =>
                  setBehaviorDialogState((current) => ({ ...current, screenTimeMinutes: event.target.value }))
                }
                type="number"
                value={behaviorDialogState.screenTimeMinutes}
              />
              {behaviorDialogState.screenTimeMinutes ? (
                <p className="text-sm text-slate-500">
                  Penalty:{" "}
                  {computeScreenTimePenalty(Number.parseInt(behaviorDialogState.screenTimeMinutes, 10) || 0)}{" "}
                  minutes
                </p>
              ) : null}
            </div>
          ) : null}

          {behaviorDialogState.behaviorType === "exercise" ? (
            <ActionField
              label="Workout length (minutes)"
              inputMode="numeric"
              min="1"
              onChange={(event) =>
                setBehaviorDialogState((current) => ({ ...current, exerciseMinutes: event.target.value }))
              }
              type="number"
              value={behaviorDialogState.exerciseMinutes}
            />
          ) : null}

          <ActionField
            label="Note"
            onChange={(event) =>
              setBehaviorDialogState((current) => ({ ...current, note: event.target.value }))
            }
            placeholder="Optional note"
            value={behaviorDialogState.note}
          />

          <Button className="w-full" onClick={handleSaveBehaviorEvent} variant="secondary">
            {behaviorDialogMode.kind === "edit" ? "Save changes" : "Save behavior entry"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        onClose={() => setPendingSessionEnd(null)}
        open={Boolean(pendingSessionEnd)}
        title="Log this session"
      >
        {pendingSessionEnd ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              Did this session represent uninterrupted work?
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button onClick={() => handleConfirmSessionLog(false)} variant="text">
                No — log a single work block
              </Button>
              <Button onClick={() => handleConfirmSessionLog(true)} variant="secondary">
                Yes — log the full session
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={() => setBehaviorDeleteTarget(null)}
        open={Boolean(behaviorDeleteTarget)}
        title="Delete behavior entry?"
      >
        {behaviorDeleteTarget ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              Are you sure? This will permanently remove this behavior entry.
            </p>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setBehaviorDeleteTarget(null)} variant="text">
                Cancel
              </Button>
              <Button onClick={handleConfirmDeleteBehavior} variant="secondary">
                Delete entry
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}
