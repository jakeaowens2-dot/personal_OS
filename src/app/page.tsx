"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { EmailAuthPanel, type EmailAuthPanelState } from "@/components/auth/EmailAuthPanel";
import {
  HealthyBehaviorCheckin,
  type HealthyBehaviorOutcomes,
} from "@/components/behaviors/HealthyBehaviorCheckin";
import { LedgerEventList } from "@/components/ledger/LedgerEventList";
import { MiniBlocks } from "@/components/overview/MiniBlocks";
import { OverviewModule } from "@/components/overview/OverviewModule";
import { WeeklyOverview } from "@/components/overview/WeeklyOverview";
import { PomodoroTimer, type SessionEndInfo, type TimerStatus } from "@/components/timer/PomodoroTimer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DayOffsetSelector } from "@/components/ui/DayOffsetSelector";
import { Dialog } from "@/components/ui/Dialog";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { TaskPriorityLabel } from "@/components/ui/TaskPriorityLabel";
import { dedupeLedgerEvents, getLedgerEventRecordedAt } from "@/lib/ledger";
import {
  getDayOffsetFromTimestamp,
  getDateForDayOffset,
  getLocalMiddayTimestampForDayOffset,
  getTimestampForDayOffset,
} from "@/lib/dates";
import {
  computeScreenTimePenalty,
  fetchBehaviorEvents,
  getPositiveBehaviorRewardMinutes,
  getBehaviorTypeLabel,
  hardDeleteBehaviorEvent,
  INDULGENCE_PENALTY_MINUTES,
  isHealthyBehaviorType,
  isHealthyBehaviorSuccess,
  persistBehaviorEvent,
  updateBehaviorEvent,
} from "@/lib/behaviors";
import { getModeDurationMinutes } from "@/lib/timer";
import {
  behaviorEventsToSettlementEvents,
  buildWeeklyEconomyDays,
  computeSettlement,
  isWeekendDate,
  ledgerEventsToSettlementEvents,
  REWARD_BLOCK_MINUTES,
  restMinutesForWorkMinutes,
  WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK,
  WEEKEND_REWARD_MULTIPLIER_LABEL,
  WORK_BLOCK_WORK_MINUTES,
} from "@/lib/economy";
import type { ActivityItem } from "@/lib/history";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  addTaskToDailyFocus,
  createTask,
  ensureHousekeepingTask,
  fetchDailyFocusItems,
  fetchMostRecentAttributedTaskId,
  fetchTasks,
  fetchTasksByIds,
  TASK_PRIORITY_ORDER,
  updateTask,
} from "@/lib/tasks";
import { exercisePalette, penaltyPalette, rewardPalette, timerPalette } from "@/lib/timerPalette";
import {
  AUTH_REQUIRED_MESSAGE,
  createManualWorkArtifactIds,
  ensureWorkspaceUser,
  fetchAttributionSelectionsForWorkBlock,
  fetchWorkspaceData,
  getWorkDefaultsFromLedgerEvent,
  getRewardSpendDefaultsFromLedgerEvent,
  hardDeleteLedgerEvent,
  hardResetWorkspace,
  isEditableLedgerEvent,
  persistCompletedWorkSession,
  persistManualWorkBlock,
  persistRewardSpend,
  persistWorkBlockAttributions,
  updateWorkEntry,
  updateRewardSpendEntry,
  updateWorkEventDate,
  type ManualWorkArtifactIds,
} from "@/lib/workspace";
import { archiveTask, completeDailyFocusItem, completeTask, dropDailyFocusItem, removeTaskFromDailyFocus } from "@/lib/tasks";
import type {
  BehaviorEvent,
  BehaviorType,
  HealthyBehaviorType,
  DailyFocusItemWithTask,
  LedgerEvent,
  Task,
  TaskPriority,
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
  createdTasksThisTurn: Task[];
  selectedTaskIds: string[];
};

type AttributionDialogState = AttributionSelectionState & {
  dayOffset: number;
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
  dayOffset: number;
  screenTimeMinutes: string;
  exerciseMinutes: string;
  note: string;
  healthyOutcomes: HealthyBehaviorOutcomes;
};

const EMPTY_HEALTHY_OUTCOMES: HealthyBehaviorOutcomes = {
  gallon_water: null,
  waking_routine: null,
};

const INITIAL_BEHAVIOR_DIALOG_STATE: BehaviorDialogState = {
  behaviorType: "indulgence",
  dayOffset: 0,
  screenTimeMinutes: "",
  exerciseMinutes: "",
  note: "",
  healthyOutcomes: EMPTY_HEALTHY_OUTCOMES,
};

type BehaviorTab = "indulgence" | "screen_time" | "exercise" | "healthy_behaviors";

const BEHAVIOR_TABS: { label: string; value: BehaviorTab }[] = [
  { label: "Indulgent behavior", value: "indulgence" },
  { label: "Screen time", value: "screen_time" },
  { label: "Exercise", value: "exercise" },
  { label: "Healthy behaviors", value: "healthy_behaviors" },
];

type PendingSessionEnd = {
  completedAt: string;
  overageSeconds: number;
};

type BehaviorDialogMode = { kind: "create" } | { kind: "edit"; event: BehaviorEvent };

type ManualWorkSubmission = {
  artifactIds: ManualWorkArtifactIds;
  attributionIdsByTaskId: Record<string, string>;
  completedAt: string;
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

function getHealthyOutcomesForDay(events: BehaviorEvent[], dayOffset: number): HealthyBehaviorOutcomes {
  const outcomes = { ...EMPTY_HEALTHY_OUTCOMES };

  for (const event of events) {
    if (isHealthyBehaviorType(event.behavior_type) && getDayOffsetFromTimestamp(event.occurred_at) === dayOffset) {
      outcomes[event.behavior_type] = isHealthyBehaviorSuccess(event);
    }
  }

  return outcomes;
}

function formatCheckinDate(dayOffset: number) {
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(
    getDateForDayOffset(dayOffset),
  );
}

function getWeekStart(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - distanceFromMonday);
  return start;
}

function shiftWeeks(date: Date, weeks: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + weeks * 7);
  return shifted;
}

function formatWeekRangeLabel(weekStart: Date) {
  const lastDay = new Date(shiftWeeks(weekStart, 1).getTime() - 1);
  const currentYear = new Date().getFullYear();

  const start = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(weekStart.getFullYear() === currentYear ? {} : { year: "numeric" }),
  }).format(weekStart);

  const end = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(lastDay.getFullYear() === currentYear ? {} : { year: "numeric" }),
  }).format(lastDay);

  return `${start} – ${end}`;
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

function textareaClassName() {
  return "min-h-28 w-full rounded-[0.8rem] border border-slate-300/80 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400";
}

type AttributionFieldsProps = {
  availableTasks: Task[];
  choresTask: Task;
  durationMinutes: number;
  emptyStateMessage: string;
  onCreateTask: (title: string) => Promise<void>;
  onLoadLibrary: () => Promise<Task[]>;
  onSelectLibraryTask: (task: Task) => void;
  onToggleTask: (taskId: string) => void;
  selectedTaskIds: string[];
};

function AttributionFields({
  availableTasks,
  choresTask,
  durationMinutes,
  emptyStateMessage,
  onCreateTask,
  onLoadLibrary,
  onSelectLibraryTask,
  onToggleTask,
  selectedTaskIds,
}: AttributionFieldsProps) {
  const [showNewTaskCard, setShowNewTaskCard] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTasks, setLibraryTasks] = useState<Task[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const openLibrary = async () => {
    setShowLibrary(true);
    setLoadingLibrary(true);
    setLibraryError(null);

    try {
      setLibraryTasks(await onLoadLibrary());
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Could not load the task library.");
    } finally {
      setLoadingLibrary(false);
    }
  };

  const submitNewTask = async () => {
    const title = newTaskTitle.trim();

    if (!title || creatingTask) {
      return;
    }

    setCreatingTask(true);

    try {
      await onCreateTask(title);
      setNewTaskTitle("");
      setShowNewTaskCard(false);
    } catch {
      // The parent surfaces the error via persistence state; keep the card open so
      // the user can retry without losing their draft.
    } finally {
      setCreatingTask(false);
    }
  };

  const selectLibraryTask = (task: Task) => {
    onSelectLibraryTask(task);
    setShowLibrary(false);
    setLibraryQuery("");
    setShowNewTaskCard(false);
    setNewTaskTitle("");
  };

  const filteredLibraryTasks = libraryTasks.filter((task) => {
    if (task.id === choresTask.id) {
      return false;
    }

    const query = libraryQuery.trim().toLowerCase();
    return query.length === 0 || task.title.toLowerCase().includes(query);
  });

  return (
    <>
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
                    <TaskPriorityLabel area={task.area} priority={task.priority} />
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

        {showNewTaskCard ? (
          <div className="relative space-y-3 rounded-[0.8rem] border border-slate-200/80 bg-white/70 px-4 py-3">
            <button
              aria-label="Close new task"
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              onClick={() => {
                setShowNewTaskCard(false);
                setNewTaskTitle("");
              }}
              type="button"
            >
              ×
            </button>
            <span className="text-sm text-slate-600">Task name</span>
            <input
              autoFocus
              className={inputClassName()}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitNewTask();
                }
              }}
              placeholder="Name the new task"
              value={newTaskTitle}
            />
            <div className="flex items-center justify-between gap-2">
              <Button onClick={openLibrary} variant="text">
                Search from task library
              </Button>
              <Button disabled={!newTaskTitle.trim() || creatingTask} onClick={submitNewTask} variant="secondary">
                {creatingTask ? "Adding…" : "Add task"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="border-t border-slate-200/80 pt-4 text-center">
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-100"
            onClick={() => {
              setShowNewTaskCard(true);
              setShowLibrary(false);
            }}
            type="button"
          >
            <span aria-hidden="true" className="text-xl leading-none text-emerald-600">
              +
            </span>
            Add a task
          </button>
        </div>

        <p className="text-sm text-slate-500">
          Selected tasks will split {durationMinutes} minutes evenly.
        </p>
      </div>

      <Dialog onClose={() => setShowLibrary(false)} open={showLibrary} title="Select from task library">
        <div className="space-y-3">
          <input
            autoFocus
            className={inputClassName()}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="Search your tasks"
            value={libraryQuery}
          />
          <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
            {loadingLibrary ? (
              <p className="px-1 py-2 text-sm text-slate-500">Loading task library…</p>
            ) : libraryError ? (
              <p className="px-1 py-2 text-sm text-rose-700">{libraryError}</p>
            ) : filteredLibraryTasks.length > 0 ? (
              filteredLibraryTasks.map((task) => (
                <button
                  key={task.id}
                  className="flex w-full items-center justify-between gap-3 rounded-[0.6rem] px-2 py-2 text-left transition hover:bg-slate-100"
                  onClick={() => selectLibraryTask(task)}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-950">{task.title}</p>
                    <TaskPriorityLabel area={task.area} priority={task.priority} />
                  </div>
                  <span className="shrink-0 text-sm text-[var(--accent)]">Select</span>
                </button>
              ))
            ) : (
              <p className="px-1 py-2 text-sm text-slate-500">No matching tasks.</p>
            )}
          </div>
        </div>
      </Dialog>
    </>
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
  const [manualWorkDayOffset, setManualWorkDayOffset] = useState(0);
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isManualWorkSaving, setIsManualWorkSaving] = useState(false);
  const [isAttributionSaving, setIsAttributionSaving] = useState(false);
  const manualWorkSaveInFlightRef = useRef(false);
  const attributionSaveInFlightRef = useRef(false);
  const behaviorSaveInFlightRef = useRef(false);
  const manualWorkSubmissionRef = useRef<ManualWorkSubmission | null>(null);
  const attributionIdsByTaskIdRef = useRef<Record<string, string>>({});
  const [isRewardDialogOpen, setIsRewardDialogOpen] = useState(false);
  const [rewardDialogMode, setRewardDialogMode] = useState<RewardDialogMode>({ kind: "create" });
  const [rewardHours, setRewardHours] = useState("0");
  const [rewardMinutes, setRewardMinutes] = useState("0");
  const [rewardDayOffset, setRewardDayOffset] = useState(0);
  const [rewardNote, setRewardNote] = useState("");
  const [ledgerDeleteDialogState, setLedgerDeleteDialogState] = useState<LedgerEvent | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [behaviorEvents, setBehaviorEvents] = useState<BehaviorEvent[]>([]);
  const [hasLoadedBehaviorEvents, setHasLoadedBehaviorEvents] = useState(false);
  const [isBehaviorDialogOpen, setIsBehaviorDialogOpen] = useState(false);
  const [behaviorDialogState, setBehaviorDialogState] = useState<BehaviorDialogState>(INITIAL_BEHAVIOR_DIALOG_STATE);
  const [behaviorDialogMode, setBehaviorDialogMode] = useState<BehaviorDialogMode>({ kind: "create" });
  const [behaviorDialogError, setBehaviorDialogError] = useState<string | null>(null);
  const [isBehaviorSaving, setIsBehaviorSaving] = useState(false);
  const [isHealthyCheckinOpen, setIsHealthyCheckinOpen] = useState(false);
  const [healthyCheckinOutcomes, setHealthyCheckinOutcomes] = useState<HealthyBehaviorOutcomes>(EMPTY_HEALTHY_OUTCOMES);
  const [healthyCheckinError, setHealthyCheckinError] = useState<string | null>(null);
  const [isHealthyCheckinSaving, setIsHealthyCheckinSaving] = useState(false);
  const [localDayKey, setLocalDayKey] = useState(() => new Date().toDateString());
  const [behaviorDeleteTarget, setBehaviorDeleteTarget] = useState<BehaviorEvent | null>(null);
  const [breakRequest, setBreakRequest] = useState<{ token: number; minutes: number } | null>(null);
  const [pendingSessionEnd, setPendingSessionEnd] = useState<PendingSessionEnd | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [metadataQueue, setMetadataQueue] = useState<Task[]>([]);
  const [metadataDraft, setMetadataDraft] = useState<{
    area: string;
    description: string;
    dueAt: string;
    priority: TaskPriority;
    title: string;
  }>({ area: "", description: "", dueAt: "", priority: "medium", title: "" });
  const handledCompletionKeysRef = useRef(new Set<string>());
  const promptedHealthyCheckinDayRef = useRef<string | null>(null);
  const reopenHealthyCheckinAfterWorkRef = useRef(false);

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

  const positiveBehaviorRewardMinutes = useMemo(
    () => getPositiveBehaviorRewardMinutes(behaviorEvents),
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
    const positiveBehaviorVisibleMinutes = Math.min(
      positiveBehaviorRewardMinutes,
      settlement.positiveMinutes,
    );

    return {
      exerciseVisibleMinutes: positiveBehaviorVisibleMinutes,
      positiveWorkMinutes: settlement.positiveMinutes - positiveBehaviorVisibleMinutes,
    };
  }, [positiveBehaviorRewardMinutes, settlement.positiveMinutes]);

  const isWeekendBonusActive = useMemo(
    () => isWeekendDate(new Date().toISOString()),
    [],
  );

  const weeklyWeekStart = useMemo(
    () => shiftWeeks(getWeekStart(new Date()), weekOffset),
    [weekOffset],
  );

  const weekLabel = useMemo(() => {
    if (weekOffset === 0) {
      return "This week";
    }

    if (weekOffset === -1) {
      return "Last week";
    }

    return formatWeekRangeLabel(weeklyWeekStart);
  }, [weekOffset, weeklyWeekStart]);

  const weeklyDays = useMemo(
    () => buildWeeklyEconomyDays({
      behaviorEvents,
      ledgerEvents: dedupedLedgerEvents,
      weekStart: weeklyWeekStart,
      workBlocks: dedupedWorkBlocks,
    }),
    [behaviorEvents, dedupedLedgerEvents, dedupedWorkBlocks, weeklyWeekStart],
  );

  const recentActivityItems = useMemo(
    () => {
      const ledgerItems = dedupedLedgerEvents.map((event) => ({ kind: "ledger" as const, event }));
      const behaviorItems = behaviorEvents.map((event) => ({ kind: "behavior" as const, event }));
      const timestampOf = (item: ActivityItem) =>
        item.kind === "ledger" ? getLedgerEventRecordedAt(item.event) : item.event.created_at;

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
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const timeout = window.setTimeout(() => {
      promptedHealthyCheckinDayRef.current = null;
      setLocalDayKey(new Date().toDateString());
    }, nextMidnight.getTime() - now.getTime() + 250);

    return () => window.clearTimeout(timeout);
  }, [localDayKey]);

  useEffect(() => {
    if (!workspaceUserId || !hasLoadedBehaviorEvents) {
      return;
    }

    const checkinDay = getDateForDayOffset(-1).toDateString();
    const outcomes = getHealthyOutcomesForDay(behaviorEvents, -1);
    const isComplete = Object.values(outcomes).every((outcome) => outcome !== null);

    const timeout = window.setTimeout(() => {
      if (isComplete) {
        setIsHealthyCheckinOpen(false);
        return;
      }

      if (promptedHealthyCheckinDayRef.current !== checkinDay) {
        promptedHealthyCheckinDayRef.current = checkinDay;
        setHealthyCheckinOutcomes(outcomes);
        setHealthyCheckinError(null);
        setIsHealthyCheckinOpen(true);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [behaviorEvents, hasLoadedBehaviorEvents, localDayKey, workspaceUserId]);

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
            setHasLoadedBehaviorEvents(true);
          }
        } catch {
          if (!cancelled) {
            setBehaviorEvents([]);
            setHasLoadedBehaviorEvents(false);
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
        setHasLoadedBehaviorEvents(false);
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
            setHasLoadedBehaviorEvents(true);
          } catch {
            setBehaviorEvents([]);
            setHasLoadedBehaviorEvents(false);
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
      setHasLoadedBehaviorEvents(true);
    } catch {
      setBehaviorEvents([]);
      setHasLoadedBehaviorEvents(false);
    }
  };

  const saveHealthyBehaviorOutcomes = async (
    outcomes: HealthyBehaviorOutcomes,
    dayOffset: number,
  ) => {
    if (!supabase || !workspaceUserId) {
      throw new Error("Workspace is not connected yet.");
    }

    const occurredAt = getLocalMiddayTimestampForDayOffset(dayOffset);
    const behaviorTypes: HealthyBehaviorType[] = ["gallon_water", "waking_routine"];

    try {
      for (const behaviorType of behaviorTypes) {
        const succeeded = outcomes[behaviorType];

        if (succeeded === null) {
          continue;
        }

        const existing = behaviorEvents.find(
          (event) => event.behavior_type === behaviorType &&
            getDayOffsetFromTimestamp(event.occurred_at) === dayOffset,
        );
        const input = {
          behaviorType,
          healthyBehaviorSucceeded: succeeded,
          note: existing?.note ?? undefined,
          occurredAt,
          userId: workspaceUserId,
        };

        if (existing) {
          await updateBehaviorEvent(supabase, { ...input, eventId: existing.id });
        } else {
          await persistBehaviorEvent(supabase, input);
        }
      }
    } catch (error) {
      await reloadBehaviorEvents(workspaceUserId);
      throw error;
    }

    await reloadBehaviorEvents(workspaceUserId);
  };

  const reopenMissingHealthyCheckin = () => {
    if (!hasLoadedBehaviorEvents) {
      return;
    }

    const outcomes = getHealthyOutcomesForDay(behaviorEvents, -1);

    if (Object.values(outcomes).some((outcome) => outcome === null)) {
      promptedHealthyCheckinDayRef.current = getDateForDayOffset(-1).toDateString();
      setHealthyCheckinOutcomes(outcomes);
      setHealthyCheckinError(null);
      setIsHealthyCheckinOpen(true);
    }
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
      createdTasksThisTurn: [],
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
      attributionIdsByTaskIdRef.current = {};
      const selectionState = await prepareAttributionSelectionState();
      setAttributionDialogState({
        dayOffset: getDayOffsetFromTimestamp(ledgerEvent.created_at),
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
      manualWorkSubmissionRef.current = null;
      setManualWorkDialogMode({ kind: "create" });
      setManualWorkMinutes("50");
      setManualWorkNote("");
      setManualWorkDayOffset(0);
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
      reopenHealthyCheckinAfterWorkRef.current = true;
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
      reopenHealthyCheckinAfterWorkRef.current = true;
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
    if (manualWorkSaveInFlightRef.current) {
      return;
    }

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

    manualWorkSaveInFlightRef.current = true;
    setIsManualWorkSaving(true);
    setPersistenceState({
      kind: "saving",
      message: manualWorkDialogMode.kind === "edit"
        ? "Saving work block changes..."
        : "Saving manual work block and attribution...",
    });

    try {
      const selections = buildAttributionSelections(manualAttributionState);

      if (manualWorkDialogMode.kind === "edit") {
        await updateWorkEntry(supabase, {
          actorLabel: manualWorkDialogMode.ledgerEvent.source === "pomodoro_timer"
            ? "Completed work edit"
            : "Manual work edit",
          completedAt: getTimestampForDayOffset(
            manualWorkDayOffset,
            manualWorkDialogMode.ledgerEvent.created_at,
          ),
          durationMinutes,
          ledgerEvent: manualWorkDialogMode.ledgerEvent,
          note: manualWorkNote,
          selections,
          userId: workspaceUserId,
        });
        await reloadWorkspaceData(workspaceUserId);
      } else {
        const submission = manualWorkSubmissionRef.current ?? {
          artifactIds: createManualWorkArtifactIds(),
          attributionIdsByTaskId: {},
          completedAt: getTimestampForDayOffset(manualWorkDayOffset),
        };
        submission.completedAt = getTimestampForDayOffset(
          manualWorkDayOffset,
          submission.completedAt,
        );
        manualWorkSubmissionRef.current = submission;
        const attributionIds = selections.map((selection) => {
          const existingId = submission.attributionIdsByTaskId[selection.taskId];

          if (existingId) {
            return existingId;
          }

          const id = crypto.randomUUID();
          submission.attributionIdsByTaskId[selection.taskId] = id;
          return id;
        });
        const artifacts = await persistManualWorkBlock(supabase, {
          artifactIds: submission.artifactIds,
          completedAt: submission.completedAt,
          durationMinutes,
          note: manualWorkNote,
          userId: workspaceUserId,
        });

        await persistWorkBlockAttributions(supabase, {
          attributionIds,
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
      setManualWorkDayOffset(0);
      const createdTasksThisTurn = manualAttributionState.createdTasksThisTurn;
      setManualAttributionState(null);
      manualWorkSubmissionRef.current = null;
      setManualWorkDialogMode({ kind: "create" });
      setIsManualDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: manualWorkDialogMode.kind === "edit"
          ? "Work block updated"
          : "Manual work block saved and attributed",
      });
      if (createdTasksThisTurn.length > 0) {
        setMetadataQueue(createdTasksThisTurn);
        setMetadataDraft({
          area: "",
          description: "",
          dueAt: "",
          priority: "medium",
          title: createdTasksThisTurn[0].title,
        });
      }
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the work block.",
      });
    } finally {
      manualWorkSaveInFlightRef.current = false;
      setIsManualWorkSaving(false);
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
    if (!supabase || !workspaceUserId || behaviorSaveInFlightRef.current) {
      return;
    }

    let durationMinutes: number | null = null;
    const occurredAt = getLocalMiddayTimestampForDayOffset(behaviorDialogState.dayOffset);
    setBehaviorDialogError(null);

    if (isHealthyBehaviorType(behaviorDialogState.behaviorType)) {
      if (Object.values(behaviorDialogState.healthyOutcomes).some((outcome) => outcome === null)) {
        setBehaviorDialogError("Choose Yes or No for both healthy behaviors.");
        return;
      }

      behaviorSaveInFlightRef.current = true;
      setIsBehaviorSaving(true);

      try {
        await saveHealthyBehaviorOutcomes(
          behaviorDialogState.healthyOutcomes,
          behaviorDialogState.dayOffset,
        );
        setIsBehaviorDialogOpen(false);
        setBehaviorDialogState(INITIAL_BEHAVIOR_DIALOG_STATE);
        setBehaviorDialogMode({ kind: "create" });
        setPersistenceState({ kind: "saved", message: "Healthy behaviors saved" });
      } catch (error) {
        setBehaviorDialogError(error instanceof Error ? error.message : "Could not save healthy behaviors.");
      } finally {
        behaviorSaveInFlightRef.current = false;
        setIsBehaviorSaving(false);
      }

      return;
    }

    if (behaviorDialogState.behaviorType === "screen_time") {
      const screenMinutes = Number.parseInt(behaviorDialogState.screenTimeMinutes, 10);

      if (!Number.isFinite(screenMinutes) || screenMinutes <= 0) {
        setBehaviorDialogError("Enter your total screen time for the day in minutes.");
        setPersistenceState({
          kind: "error",
          message: "Enter your total screen time for the day in minutes.",
        });
        return;
      }

      durationMinutes = screenMinutes;
    } else if (behaviorDialogState.behaviorType === "exercise") {
      const workoutMinutes = Number.parseInt(behaviorDialogState.exerciseMinutes, 10);

      if (!Number.isFinite(workoutMinutes) || workoutMinutes <= 0) {
        setBehaviorDialogError("Enter your workout length in minutes.");
        setPersistenceState({
          kind: "error",
          message: "Enter your workout length in minutes.",
        });
        return;
      }

      durationMinutes = workoutMinutes;
    }

    behaviorSaveInFlightRef.current = true;
    setIsBehaviorSaving(true);
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
      setBehaviorDialogError(null);
      setPersistenceState({
        kind: "saved",
        message: behaviorDialogMode.kind === "edit" ? "Behavior entry updated" : "Behavior entry saved",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the behavior entry.";
      setBehaviorDialogError(message);
      setPersistenceState({
        kind: "error",
        message,
      });
    } finally {
      behaviorSaveInFlightRef.current = false;
      setIsBehaviorSaving(false);
    }
  };

  const handleRequestEditBehavior = (event: BehaviorEvent) => {
    setBehaviorDialogMode({ kind: "edit", event });
    setBehaviorDialogState({
      behaviorType: event.behavior_type,
      dayOffset: getDayOffsetFromTimestamp(event.occurred_at),
      screenTimeMinutes:
        event.behavior_type === "screen_time" ? String(event.duration_minutes ?? "") : "",
      exerciseMinutes: event.behavior_type === "exercise" ? String(event.duration_minutes ?? "") : "",
      note: event.note ?? "",
      healthyOutcomes: isHealthyBehaviorType(event.behavior_type)
        ? getHealthyOutcomesForDay(behaviorEvents, getDayOffsetFromTimestamp(event.occurred_at))
        : EMPTY_HEALTHY_OUTCOMES,
    });
    setBehaviorDialogError(null);
    setIsBehaviorDialogOpen(true);
  };

  const handleRequestDeleteBehavior = (event: BehaviorEvent) => {
    setBehaviorDeleteTarget(event);
  };

  const handleSaveHealthyCheckin = async () => {
    if (Object.values(healthyCheckinOutcomes).some((outcome) => outcome === null)) {
      setHealthyCheckinError("Choose Yes or No for both healthy behaviors.");
      return;
    }

    setIsHealthyCheckinSaving(true);
    setHealthyCheckinError(null);

    try {
      await saveHealthyBehaviorOutcomes(healthyCheckinOutcomes, -1);
      setIsHealthyCheckinOpen(false);
      setPersistenceState({ kind: "saved", message: "Yesterday's healthy behaviors saved" });
    } catch (error) {
      setHealthyCheckinError(error instanceof Error ? error.message : "Could not save healthy behaviors.");
    } finally {
      setIsHealthyCheckinSaving(false);
    }
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
      await completeDailyFocusItem(supabase, item.id);
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
      await dropDailyFocusItem(supabase, item.id);
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
    if (selectionState.selectedTaskIds.length === 0) {
      return "Choose at least one task or chores/housekeeping before saving attribution.";
    }

    return null;
  };

  const buildAttributionSelections = (selectionState: AttributionSelectionState) => {
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

    return selections;
  };

  const persistNewAttributionTask = async (
    title: string,
    context: { actorLabel: string; humanSummary: string; reason: string },
  ) => {
    if (!supabase || !workspaceUserId) {
      throw new Error("Workspace is not connected yet. Wait for the connection to finish before adding a task.");
    }

    const created = await createTask(supabase, {
      actor: { label: context.actorLabel, type: "human" },
      humanSummary: context.humanSummary,
      priority: "medium",
      reason: context.reason,
      source: "attribution_capture",
      title: title.trim(),
      userId: workspaceUserId,
    });

    await addTaskToDailyFocus(supabase, workspaceUserId, created.id);

    return created;
  };

  const loadTaskLibrary = async () => {
    if (!supabase || !workspaceUserId) {
      throw new Error("Workspace is not connected yet.");
    }

    return fetchTasks(supabase, workspaceUserId, { includeArchived: false });
  };

  const applyCreatedTaskToAttribution = (created: Task) => {
    setAttributionDialogState((current) => {
      if (!current) {
        return current;
      }

      const alreadyPresent = current.availableTasks.some((task) => task.id === created.id);

      return {
        ...current,
        availableTasks: alreadyPresent ? current.availableTasks : [...current.availableTasks, created],
        createdTasksThisTurn: current.createdTasksThisTurn.some((task) => task.id === created.id)
          ? current.createdTasksThisTurn
          : [...current.createdTasksThisTurn, created],
        selectedTaskIds: current.selectedTaskIds.includes(created.id)
          ? current.selectedTaskIds
          : [...current.selectedTaskIds, created.id],
      };
    });
  };

  const applyCreatedTaskToManual = (created: Task) => {
    setManualAttributionState((current) => {
      if (!current) {
        return current;
      }

      const alreadyPresent = current.availableTasks.some((task) => task.id === created.id);

      return {
        ...current,
        availableTasks: alreadyPresent ? current.availableTasks : [...current.availableTasks, created],
        createdTasksThisTurn: current.createdTasksThisTurn.some((task) => task.id === created.id)
          ? current.createdTasksThisTurn
          : [...current.createdTasksThisTurn, created],
        selectedTaskIds: current.selectedTaskIds.includes(created.id)
          ? current.selectedTaskIds
          : [...current.selectedTaskIds, created.id],
      };
    });
  };

  const handleAttributionCreateTask = async (title: string) => {
    try {
      const created = await persistNewAttributionTask(title, {
        actorLabel: "Work attribution",
        humanSummary: "Captured as a new focus task during work attribution.",
        reason: "Created from work attribution new-task capture",
      });
      applyCreatedTaskToAttribution(created);
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create the task.",
      });
      throw error;
    }
  };

  const handleManualCreateTask = async (title: string) => {
    try {
      const created = await persistNewAttributionTask(title, {
        actorLabel: "Manual work",
        humanSummary: "Captured as a new focus task during manual work entry.",
        reason: "Created from manual work new-task capture",
      });
      applyCreatedTaskToManual(created);
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create the task.",
      });
      throw error;
    }
  };

  const selectLibraryTaskForAttribution = (task: Task) => {
    setAttributionDialogState((current) => {
      if (!current) {
        return current;
      }

      const alreadyPresent = current.availableTasks.some((candidate) => candidate.id === task.id);

      return {
        ...current,
        availableTasks: alreadyPresent ? current.availableTasks : [...current.availableTasks, task],
        selectedTaskIds: current.selectedTaskIds.includes(task.id)
          ? current.selectedTaskIds
          : [...current.selectedTaskIds, task.id],
      };
    });
  };

  const selectLibraryTaskForManual = (task: Task) => {
    setManualAttributionState((current) => {
      if (!current) {
        return current;
      }

      const alreadyPresent = current.availableTasks.some((candidate) => candidate.id === task.id);

      return {
        ...current,
        availableTasks: alreadyPresent ? current.availableTasks : [...current.availableTasks, task],
        selectedTaskIds: current.selectedTaskIds.includes(task.id)
          ? current.selectedTaskIds
          : [...current.selectedTaskIds, task.id],
      };
    });
  };

  const handleSubmitTaskMetadata = async () => {
    const current = metadataQueue[0];

    if (!supabase || !workspaceUserId || !current) {
      return;
    }

    setPersistenceState({ kind: "saving", message: "Saving task metadata…" });

    try {
      await updateTask(supabase, current, {
        actor: { label: "Work attribution", type: "human" },
        area: metadataDraft.area,
        description: metadataDraft.description,
        dueAt: metadataDraft.dueAt.trim() ? metadataDraft.dueAt : null,
        priority: metadataDraft.priority,
        reason: "Metadata added after task creation",
        taskId: current.id,
        title: metadataDraft.title,
        userId: workspaceUserId,
      });

      await reloadDailyFocusItems(workspaceUserId);
      const remaining = metadataQueue.slice(1);
      setMetadataQueue(remaining);
      setMetadataDraft({
        area: "",
        description: "",
        dueAt: "",
        priority: "medium",
        title: remaining[0]?.title ?? "",
      });
      setPersistenceState({ kind: "saved", message: "Task metadata saved" });
      if (remaining.length === 0 && reopenHealthyCheckinAfterWorkRef.current) {
        reopenHealthyCheckinAfterWorkRef.current = false;
        reopenMissingHealthyCheckin();
      }
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the task metadata.",
      });
    }
  };

  const handleCompleteMetadataLater = () => {
    setMetadataQueue([]);
    setMetadataDraft({ area: "", description: "", dueAt: "", priority: "medium", title: "" });
    if (reopenHealthyCheckinAfterWorkRef.current) {
      reopenHealthyCheckinAfterWorkRef.current = false;
      reopenMissingHealthyCheckin();
    }
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
      if (
        event.event_type === "work_earned" &&
        (event.source === "manual_entry" || event.source === "pomodoro_timer")
      ) {
        const defaults = getWorkDefaultsFromLedgerEvent(event);

        if (!defaults.workBlockId || !defaults.durationMinutes) {
          throw new Error("This work event is missing its linked work block details.");
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
        setManualWorkDayOffset(getDayOffsetFromTimestamp(event.created_at));
        setIsManualDialogOpen(true);
        setPersistenceState({
          kind: "ready",
          message: "Editing work block",
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
        setRewardDayOffset(getDayOffsetFromTimestamp(event.created_at));
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
    if (attributionSaveInFlightRef.current) {
      return;
    }

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

    attributionSaveInFlightRef.current = true;
    setIsAttributionSaving(true);
    setPersistenceState({
      kind: "saving",
      message: "Saving work attribution...",
    });

    try {
      const selections = buildAttributionSelections(attributionDialogState);
      const attributionIds = selections.map((selection) => {
        const existingId = attributionIdsByTaskIdRef.current[selection.taskId];

        if (existingId) {
          return existingId;
        }

        const id = crypto.randomUUID();
        attributionIdsByTaskIdRef.current[selection.taskId] = id;
        return id;
      });

      const datedWork = await updateWorkEventDate(supabase, {
        completedAt: getTimestampForDayOffset(
          attributionDialogState.dayOffset,
          attributionDialogState.ledgerEvent.created_at,
        ),
        ledgerEvent: attributionDialogState.ledgerEvent,
        userId: workspaceUserId,
        workBlock: attributionDialogState.workBlock,
      });
      await persistWorkBlockAttributions(supabase, {
        attributionIds,
        durationMinutes: attributionDialogState.workBlock.duration_minutes,
        ledgerEvent: datedWork.ledgerEvent,
        selections,
        userId: workspaceUserId,
        workBlockId: attributionDialogState.workBlock.id,
      });
      await reloadWorkspaceData(workspaceUserId);
      await reloadDailyFocusItems(workspaceUserId);
      const createdTasksThisTurn = attributionDialogState.createdTasksThisTurn;
      setAttributionDialogState(null);
      setPersistenceState({
        kind: "saved",
        message: "Work block attributed",
      });
      if (createdTasksThisTurn.length > 0) {
        setMetadataQueue(createdTasksThisTurn);
        setMetadataDraft({
          area: "",
          description: "",
          dueAt: "",
          priority: "medium",
          title: createdTasksThisTurn[0].title,
        });
      } else if (reopenHealthyCheckinAfterWorkRef.current) {
        reopenHealthyCheckinAfterWorkRef.current = false;
        reopenMissingHealthyCheckin();
      }
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the work attribution.",
      });
    } finally {
      attributionSaveInFlightRef.current = false;
      setIsAttributionSaving(false);
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
              <Link className="block rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-950" href="/settings/account">
                Account password
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
                    <TaskPriorityLabel area={item.task.area} priority={item.task.priority} />
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
          <div className="space-y-6 lg:col-span-2">
          <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
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
              action={
                <div className="flex items-center gap-1">
                  <button
                    aria-label="Previous week"
                    className="cursor-pointer rounded-[0.6rem] px-2 py-1 text-base leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => setWeekOffset((current) => current - 1)}
                    type="button"
                  >
                    ←
                  </button>
                  <span className="min-w-36 whitespace-nowrap text-center text-sm font-medium text-slate-700">
                    {weekLabel}
                  </span>
                  <button
                    aria-label="Next week"
                    className="cursor-pointer rounded-[0.6rem] px-2 py-1 text-base leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                    disabled={weekOffset === 0}
                    onClick={() => setWeekOffset((current) => Math.min(0, current + 1))}
                    type="button"
                  >
                    →
                  </button>
                </div>
              }
              body={
                <WeeklyOverview days={weeklyDays} />
              }
              title="Weekly overview"
            />
          </section>
          </div>

          <section className="rounded-[0.7rem] border border-slate-300/70 bg-[#f6f4ee]/92 p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)] lg:col-start-3">
            <OverviewModule
              action={
                <Link
                  className="text-sm text-slate-500 transition hover:text-slate-900"
                  href="/history"
                  rel="noreferrer"
                  target="_blank"
                >
                  Full history ↗
                </Link>
              }
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
          manualWorkSubmissionRef.current = null;
          setManualWorkDialogMode({ kind: "create" });
          setManualWorkMinutes("50");
          setManualWorkNote("");
          setManualWorkDayOffset(0);
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

            <DayOffsetSelector
              disabled={isManualWorkSaving}
              label="Day of work block"
              onChange={setManualWorkDayOffset}
              value={manualWorkDayOffset}
            />

            <AttributionFields
              availableTasks={manualAttributionState.availableTasks}
              choresTask={manualAttributionState.choresTask}
              durationMinutes={Number.parseInt(manualWorkMinutes, 10) || 0}
              emptyStateMessage="No focus tasks yet — add a task or select from your task library."
              onCreateTask={handleManualCreateTask}
              onLoadLibrary={loadTaskLibrary}
              onSelectLibraryTask={selectLibraryTaskForManual}
              onToggleTask={toggleManualAttributionTask}
              selectedTaskIds={manualAttributionState.selectedTaskIds}
            />

            <Button
              className="w-full"
              disabled={isManualWorkSaving}
              onClick={handleManualWorkAdd}
              variant="secondary"
            >
              {isManualWorkSaving
                ? "Saving..."
                : manualWorkDialogMode.kind === "edit"
                  ? "Save changes"
                  : "Save work block"}
            </Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={() => setIsHealthyCheckinOpen(false)}
        open={isHealthyCheckinOpen}
        title={`Yesterday (${formatCheckinDate(-1)}), did you accomplish…`}
      >
        <div className="space-y-5">
          <HealthyBehaviorCheckin
            disabled={isHealthyCheckinSaving}
            onChange={(type, value) =>
              setHealthyCheckinOutcomes((current) => ({ ...current, [type]: value }))
            }
            outcomes={healthyCheckinOutcomes}
          />
          <p className="text-xs leading-5 text-slate-500">
            Yes adds 30 reward minutes. No subtracts 30 reward minutes.
          </p>
          {healthyCheckinError ? <p className="text-sm text-rose-700">{healthyCheckinError}</p> : null}
          <Button
            className="w-full"
            disabled={isHealthyCheckinSaving}
            onClick={handleSaveHealthyCheckin}
            variant="secondary"
          >
            {isHealthyCheckinSaving ? "Saving…" : "Save daily check-in"}
          </Button>
        </div>
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
          <DayOffsetSelector
            label="Day of reward block"
            onChange={setRewardDayOffset}
            value={rewardDayOffset}
          />
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
            <DayOffsetSelector
              disabled={isAttributionSaving}
              label="Day of work block"
              onChange={(dayOffset) =>
                setAttributionDialogState((current) => current ? { ...current, dayOffset } : current)
              }
              value={attributionDialogState.dayOffset}
            />
            <AttributionFields
              availableTasks={attributionDialogState.availableTasks}
              choresTask={attributionDialogState.choresTask}
              durationMinutes={attributionDialogState.workBlock.duration_minutes}
              emptyStateMessage="No focus tasks yet — add a task or select from your task library."
              onCreateTask={handleAttributionCreateTask}
              onLoadLibrary={loadTaskLibrary}
              onSelectLibraryTask={selectLibraryTaskForAttribution}
              onToggleTask={toggleAttributionTask}
              selectedTaskIds={attributionDialogState.selectedTaskIds}
            />

            <div className="flex justify-end">
              <Button
                disabled={isAttributionSaving}
                onClick={handleSaveWorkAttribution}
                variant="secondary"
              >
                {isAttributionSaving ? "Saving..." : "Save attribution"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        onClose={handleCompleteMetadataLater}
        open={metadataQueue.length > 0}
        title="Enter metadata for new task"
      >
        {metadataQueue.length > 0 ? (
          <div className="space-y-5">
            <ActionField
              label="Task name"
              onChange={(event) =>
                setMetadataDraft((current) => ({ ...current, title: event.target.value }))
              }
              value={metadataDraft.title}
            />

            <ActionField
              label="Area"
              onChange={(event) =>
                setMetadataDraft((current) => ({ ...current, area: event.target.value }))
              }
              placeholder="Operations, Product, Admin…"
              value={metadataDraft.area}
            />

            <div className="space-y-2">
              <span className="text-sm text-slate-600">Priority</span>
              <div className="grid grid-cols-4 gap-2">
                {TASK_PRIORITY_ORDER.map((priority) => {
                  const selected = metadataDraft.priority === priority;

                  return (
                    <Button
                      key={priority}
                      aria-pressed={selected}
                      className="uppercase tracking-[0.14em]"
                      onClick={() => setMetadataDraft((current) => ({ ...current, priority }))}
                      variant={selected ? "primary" : "secondary"}
                    >
                      {priority}
                    </Button>
                  );
                })}
              </div>
            </div>

            <ActionField
              label="Due date"
              onChange={(event) =>
                setMetadataDraft((current) => ({ ...current, dueAt: event.target.value }))
              }
              type="date"
              value={metadataDraft.dueAt}
            />

            <div className="space-y-2">
              <span className="text-sm text-slate-600">Description</span>
              <textarea
                className={textareaClassName()}
                onChange={(event) =>
                  setMetadataDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Optional notes or context"
                value={metadataDraft.description}
              />
            </div>

            {metadataQueue.length > 1 ? (
              <p className="text-sm text-slate-500">
                {metadataQueue.length - 1} more new task{metadataQueue.length - 1 === 1 ? "" : "s"} after this one
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button onClick={handleCompleteMetadataLater} variant="text">
                Complete later
              </Button>
              <Button onClick={handleSubmitTaskMetadata} variant="secondary">
                Save metadata
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
          setBehaviorDialogError(null);
        }}
        open={isBehaviorDialogOpen}
        title={behaviorDialogMode.kind === "edit" ? "Edit behavior entry" : "Behavior tracking"}
      >
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-4">
            {BEHAVIOR_TABS.map((tab) => {
              const selected = tab.value === "healthy_behaviors"
                ? isHealthyBehaviorType(behaviorDialogState.behaviorType)
                : behaviorDialogState.behaviorType === tab.value;

              return (
                <Button
                  key={tab.value}
                  aria-pressed={selected}
                  onClick={() =>
                    setBehaviorDialogState((current) => {
                      const behaviorType = tab.value === "healthy_behaviors" ? "waking_routine" : tab.value;
                      return {
                        ...current,
                        behaviorType,
                        healthyOutcomes: isHealthyBehaviorType(behaviorType)
                          ? getHealthyOutcomesForDay(behaviorEvents, current.dayOffset)
                          : current.healthyOutcomes,
                      };
                    })
                  }
                  variant={selected ? "primary" : "secondary"}
                >
                  {tab.label}
                </Button>
              );
            })}
          </div>

          <DayOffsetSelector
            disabled={isBehaviorSaving}
            label="Day of behavior"
            onChange={(dayOffset) =>
              setBehaviorDialogState((current) => ({
                ...current,
                dayOffset,
                healthyOutcomes: isHealthyBehaviorType(current.behaviorType)
                  ? getHealthyOutcomesForDay(behaviorEvents, dayOffset)
                  : current.healthyOutcomes,
              }))
            }
            value={behaviorDialogState.dayOffset}
          />

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
                  {computeScreenTimePenalty(
                    Number.parseInt(behaviorDialogState.screenTimeMinutes, 10) || 0,
                    getLocalMiddayTimestampForDayOffset(behaviorDialogState.dayOffset),
                  )}{" "}
                  minutes
                </p>
              ) : null}
            </div>
          ) : null}

          {behaviorDialogState.behaviorType === "exercise" ? (
            <div className="space-y-3">
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
            </div>
          ) : null}

          {isHealthyBehaviorType(behaviorDialogState.behaviorType) ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-800">
                {behaviorDialogState.dayOffset === 0 ? "Today" : "Selected day"} ({formatCheckinDate(behaviorDialogState.dayOffset)}), did you accomplish…
              </p>
              <HealthyBehaviorCheckin
                disabled={isBehaviorSaving}
                onChange={(type, value) =>
                  setBehaviorDialogState((current) => ({
                    ...current,
                    healthyOutcomes: { ...current.healthyOutcomes, [type]: value },
                  }))
                }
                outcomes={behaviorDialogState.healthyOutcomes}
              />
              <p className="text-xs leading-5 text-slate-500">
                Yes adds 30 reward minutes. No subtracts 30 reward minutes.
              </p>
            </div>
          ) : null}

          {!isHealthyBehaviorType(behaviorDialogState.behaviorType) ? (
            <ActionField
              label="Note"
              onChange={(event) =>
                setBehaviorDialogState((current) => ({ ...current, note: event.target.value }))
              }
              placeholder="Optional note"
              value={behaviorDialogState.note}
            />
          ) : null}

          {behaviorDialogError ? (
            <p className="text-sm text-rose-700">{behaviorDialogError}</p>
          ) : null}

          <Button
            className="w-full"
            disabled={isBehaviorSaving}
            onClick={handleSaveBehaviorEvent}
            variant="secondary"
          >
            {isBehaviorSaving
              ? "Saving..."
              : behaviorDialogMode.kind === "edit"
                ? "Save changes"
                : isHealthyBehaviorType(behaviorDialogState.behaviorType)
                  ? "Save daily check-in"
                  : "Save behavior entry"}
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
