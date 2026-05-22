"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { LedgerEventList } from "@/components/ledger/LedgerEventList";
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
import { rewardPalette, timerPalette } from "@/lib/timerPalette";
import {
  ensureWorkspaceUser,
  fetchWorkspaceData,
  persistCompletedWorkSession,
  persistManualWorkBlock,
  persistRewardSpend,
} from "@/lib/workspace";
import type { LedgerEvent, TimerMode, TimerSession, WorkBlock } from "@/lib/types";

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
      <div className="flex min-h-4 flex-wrap gap-2">
        {count === 0 ? (
          <div className="text-xs text-slate-400">{zeroLabel}</div>
        ) : (
          visibleSquares.map((_, index) => {
            const fillRatio = partialCount == null
              ? 1
              : Math.max(0, Math.min(1, partialCount - index));

            return (
              <span
                key={`${label}-${index}`}
                className="relative h-3.5 w-3.5 overflow-hidden rounded-[4px] bg-slate-200/80"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-[4px]"
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

type OverviewSectionProps = {
  actionLabel?: string;
  children: ReactNode;
  headerAdornment?: ReactNode;
  onAction?: () => void;
  title: string;
};

function OverviewSection({ actionLabel, children, headerAdornment, onAction, title }: OverviewSectionProps) {
  return (
    <section className="space-y-5">
      <div aria-hidden="true" className="h-px w-14 bg-slate-300/80" />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {headerAdornment}
        </div>
        {actionLabel && onAction ? (
          <Button onClick={onAction} size="sm" variant="ghost">
            {actionLabel}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
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
  const [manualWorkMinutes, setManualWorkMinutes] = useState("50");
  const [manualWorkNote, setManualWorkNote] = useState("");
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isRewardDialogOpen, setIsRewardDialogOpen] = useState(false);
  const [rewardMinutes, setRewardMinutes] = useState("30");
  const [rewardName, setRewardName] = useState("Walk");
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
      setPersistenceState({
        kind: "saved",
        message: "Latest work block saved",
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

    if (!supabase || !workspaceUserId) {
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

    setPersistenceState({
      kind: "saving",
      message: "Saving manual work block...",
    });

    try {
      const artifacts = await persistManualWorkBlock(supabase, {
        completedAt: new Date().toISOString(),
        durationMinutes,
        note: manualWorkNote,
        userId: workspaceUserId,
      });

      setLocalLedgerState((current) => ({
        ledgerEvents: [artifacts.ledgerEvent, ...current.ledgerEvents],
        timerSessions: [artifacts.timerSession, ...current.timerSessions],
        workBlocks: [artifacts.workBlock, ...current.workBlocks],
      }));
      setManualWorkNote("");
      setIsManualDialogOpen(false);
      setPersistenceState({
        kind: "saved",
        message: "Manual work block saved",
      });
    } catch (error) {
      setPersistenceState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the manual work block.",
      });
    }
  };

  const handleRewardSpend = async () => {
    const redeemMinutes = Number.parseInt(rewardMinutes, 10);
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

    if (!rewardName.trim()) {
      setPersistenceState({
        kind: "error",
        message: "Reward name is required.",
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
        redeemedAt: new Date().toISOString(),
        rewardMinutes: redeemMinutes,
        rewardName,
        userId: workspaceUserId,
      });

      setLocalLedgerState((current) => ({
        ...current,
        ledgerEvents: [ledgerEvent, ...current.ledgerEvents],
      }));
      setRewardNote("");
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
          <Badge className="normal-case tracking-normal" tone="neutral">
            {persistenceState.message}
          </Badge>
        </header>

        {persistenceState.kind === "error" ? (
          <p className="text-sm text-rose-700">{persistenceState.message}</p>
        ) : null}

        <PomodoroTimer
          onComplete={handleTimerComplete}
          onStateChange={setTimerVisualState}
        />

        <section className="grid gap-10 pt-2 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section className="grid gap-8 md:grid-cols-2 md:gap-10">
            <section className="space-y-5">
              <div aria-hidden="true" className="h-px w-14 bg-slate-300/80" />
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-base font-semibold text-slate-950">Today&apos;s work</h2>
                <div className="flex flex-col items-end gap-1">
                  <p className="text-sm font-semibold text-slate-950">
                    {todaysWorkBlocks.length} block{todaysWorkBlocks.length === 1 ? "" : "s"}
                  </p>
                  <Button onClick={() => setIsManualDialogOpen(true)} size="sm" variant="ghost">
                    Add manually
                  </Button>
                </div>
              </div>
              <BlockMeter
                color="work"
                count={todaysWorkBlocks.length}
                label=""
                valueLabel=""
                zeroLabel="No completed blocks yet"
              />
            </section>

            <section className="space-y-5">
              <div aria-hidden="true" className="h-px w-14 bg-slate-300/80" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-slate-950">Reward balance</h2>
                  {isWeekendBonusActive ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                      {WEEKEND_REWARD_MULTIPLIER_LABEL}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <p className="text-sm font-semibold text-slate-950">
                    {currentRewardMinutes < 0
                      ? `${formatRewardMinutes(currentRewardMinutes)} behind`
                      : `${formatRewardMinutes(currentRewardMinutes)} available`}
                  </p>
                  <Button onClick={() => setIsRewardDialogOpen(true)} size="sm" variant="ghost">
                    Spend reward
                  </Button>
                </div>
              </div>
              <BlockMeter
                color={currentRewardMinutes < 0 ? "reward_negative" : "reward"}
                count={Math.ceil(currentRewardBalance)}
                label=""
                partialCount={currentRewardBalance}
                valueLabel=""
                zeroLabel="No reward time yet"
              />
            </section>
          </section>

          <aside className="space-y-10">
            <OverviewSection title="Weekly overview">
              <div className="space-y-5">
                <BlockMeter
                  color="work"
                  count={weeklyWorkBlocks.length}
                  label=""
                  valueLabel={`${weeklyWorkBlocks.length} work blocks`}
                  zeroLabel="No work blocks this week"
                />
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
              </div>
            </OverviewSection>

            <OverviewSection title="Recent activity">
              <LedgerEventList
                emptyMessage="Finish a work timer to create your first saved ledger event."
                events={recentLedgerEvents}
              />
            </OverviewSection>
          </aside>
        </section>
      </div>

      <Dialog
        onClose={() => setIsManualDialogOpen(false)}
        open={isManualDialogOpen}
        title="Add missed work"
      >
        <div className="space-y-4">
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
          <Button className="w-full" onClick={handleManualWorkAdd} variant="secondary">
            Add work block
          </Button>
        </div>
      </Dialog>

      <Dialog
        onClose={() => setIsRewardDialogOpen(false)}
        open={isRewardDialogOpen}
        title="Spend reward"
      >
        <div className="space-y-4">
          <ActionField
            label="Reward name"
            onChange={(event) => setRewardName(event.target.value)}
            placeholder="Walk, coffee, reading"
            value={rewardName}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionField
              label="Reward minutes"
              inputMode="numeric"
              min="1"
              onChange={(event) => setRewardMinutes(event.target.value)}
              type="number"
              value={rewardMinutes}
            />
            <label className="space-y-2">
              <span className="text-sm text-slate-600">Equivalent cost</span>
              <div className="flex h-11 items-center rounded-2xl border border-slate-300/80 bg-white/80 px-4 text-sm text-slate-500">
                {Math.max(
                  1,
                  Math.ceil((Number.parseInt(rewardMinutes, 10) || 0) / WEEKDAY_REWARD_MINUTES_PER_WORK_BLOCK),
                )}{" "}
                work blocks
              </div>
            </label>
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
    </main>
  );
}
