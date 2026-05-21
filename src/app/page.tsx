"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { PomodoroTimer, type TimerStatus } from "@/components/timer/PomodoroTimer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

function getVisibleSquares(count: number, maxVisible = 12) {
  return Array.from({ length: Math.min(count, maxVisible) });
}

function getEventSquares(count: number, maxVisible = 4) {
  return Array.from({ length: Math.min(Math.abs(count), maxVisible) });
}

function getLedgerEventTitle(event: LedgerEvent) {
  if (event.event_type === "reward_spent") {
    const rewardName =
      typeof event.metadata?.reward_name === "string" ? event.metadata.reward_name : "Reward used";

    return rewardName;
  }

  if (event.source === "manual_entry") {
    return "Manual work block added";
  }

  return "Work block earned";
}

function getLedgerEventDetail(event: LedgerEvent) {
  if (event.event_type === "reward_spent") {
    const cost = Math.abs(event.delta_work_blocks);
    return `${formatTimestamp(event.created_at)} · spent ${cost} work block${cost === 1 ? "" : "s"}`;
  }

  return `${formatTimestamp(event.created_at)} via ${event.source}`;
}

function SubtleDivider() {
  return <div aria-hidden="true" className="h-px w-16 bg-slate-300/70" />;
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
  color: "reward" | "work";
  count: number;
  label: string;
  valueLabel: string;
};

function BlockMeter({ color, count, label, valueLabel }: BlockMeterProps) {
  const palette =
    color === "work"
      ? timerPalette.work.progress
      : rewardPalette.progress;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-slate-500">{label}</span>
        <p className="text-sm font-medium text-slate-800">{valueLabel}</p>
      </div>
      <div className="flex min-h-4 flex-wrap gap-2">
        {count === 0 ? (
          <div className="text-xs text-slate-400">No blocks yet</div>
        ) : (
          getVisibleSquares(count).map((_, index) => (
            <span
              key={`${label}-${index}`}
              className="h-3.5 w-3.5 rounded-[4px]"
              style={{ backgroundColor: palette }}
            />
          ))
        )}
        {count > 12 ? <span className="text-xs text-slate-500">+{count - 12}</span> : null}
      </div>
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
  const [manualWorkMinutes, setManualWorkMinutes] = useState("50");
  const [manualWorkNote, setManualWorkNote] = useState("");
  const [rewardCost, setRewardCost] = useState("1");
  const [rewardMinutes, setRewardMinutes] = useState("30");
  const [rewardName, setRewardName] = useState("Walk");
  const [rewardNote, setRewardNote] = useState("");
  const handledCompletionKeysRef = useRef(new Set<string>());

  const todaysWorkBlocks = useMemo(
    () => localLedgerState.workBlocks.filter((workBlock) => isToday(workBlock.earned_at)),
    [localLedgerState.workBlocks],
  );

  const currentWorkBalance = useMemo(
    () =>
      localLedgerState.ledgerEvents.reduce(
        (total, event) => total + event.delta_work_blocks,
        0,
      ),
    [localLedgerState.ledgerEvents],
  );

  const weeklyWorkBlocks = useMemo(
    () => localLedgerState.workBlocks.length,
    [localLedgerState.workBlocks],
  );

  const recentLedgerEvents = useMemo(
    () => localLedgerState.ledgerEvents.slice(0, 3),
    [localLedgerState.ledgerEvents],
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
    const costWorkBlocks = Number.parseInt(rewardCost, 10);
    const redeemMinutes = Number.parseInt(rewardMinutes, 10);

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

    if (!Number.isFinite(costWorkBlocks) || costWorkBlocks <= 0) {
      setPersistenceState({
        kind: "error",
        message: "Reward cost must be at least one work block.",
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

    if (costWorkBlocks > currentWorkBalance) {
      setPersistenceState({
        kind: "error",
        message: "Not enough available work blocks to spend that reward.",
      });
      return;
    }

    setPersistenceState({
      kind: "saving",
      message: "Saving reward spend...",
    });

    try {
      const { ledgerEvent } = await persistRewardSpend(supabase, {
        costWorkBlocks,
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

        <section className="pt-2">
          <SubtleDivider />
          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            <BlockMeter
              color="work"
              count={todaysWorkBlocks.length}
              label="Today"
              valueLabel={`${todaysWorkBlocks.length} work blocks`}
            />
            <BlockMeter
              color="reward"
              count={currentWorkBalance}
              label="Reward balance"
              valueLabel={`${currentWorkBalance} available`}
            />
            <BlockMeter
              color="work"
              count={weeklyWorkBlocks}
              label="This week"
              valueLabel={`${weeklyWorkBlocks} work blocks`}
            />
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section className="space-y-4 pt-2">
            <SubtleDivider />
            <div className="space-y-1 pt-4">
              <h2 className="text-lg font-semibold text-slate-950">Recent activity</h2>
              <p className="text-sm text-slate-600">
                Saved work and reward events appear here as they happen.
              </p>
            </div>

            <div className="space-y-3">
              {recentLedgerEvents.length === 0 ? (
                <div className="px-1 py-4 text-sm text-slate-600">
                  Finish a work timer to create your first saved ledger event.
                </div>
              ) : (
                recentLedgerEvents.map((event) => (
                  <article
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300/60 px-1 py-4 first:border-t-0"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{getLedgerEventTitle(event)}</p>
                      <p className="mt-1 text-sm text-slate-600">{getLedgerEventDetail(event)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getEventSquares(event.delta_work_blocks, 4).map((_, index) => (
                        <span
                          key={`${event.id}-${index}`}
                          className="h-3 w-3 rounded-[4px]"
                          style={{
                            backgroundColor:
                              event.event_type === "reward_spent"
                                ? rewardPalette.progress
                                : timerPalette.work.progress,
                          }}
                        />
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="space-y-4 pt-2">
            <SubtleDivider />
            <div className="space-y-1 pt-4">
              <h2 className="text-lg font-semibold text-slate-950">Today&apos;s blocks</h2>
              <p className="text-sm text-slate-600">A small saved record of what you&apos;ve earned.</p>
            </div>

            <div className="space-y-3">
              {todaysWorkBlocks.length === 0 ? (
                <div className="px-1 py-4 text-sm text-slate-600">
                  No work blocks earned yet today.
                </div>
              ) : (
                todaysWorkBlocks.map((workBlock) => (
                  <article
                    key={workBlock.id}
                    className="border-t border-slate-300/60 px-1 py-4 first:border-t-0"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-slate-900">
                          {workBlock.duration_minutes}-minute work block
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          Earned {formatTimestamp(workBlock.earned_at)}
                        </p>
                      </div>
                      <span
                        className="h-4 w-4 rounded-[5px]"
                        style={{ backgroundColor: timerPalette.work.progress }}
                      />
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="space-y-4 border-t border-slate-300/60 pt-5">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-950">Add missed work</h3>
                <p className="text-sm text-slate-600">Use this if you forgot to run the timer.</p>
              </div>
              <div className="space-y-3">
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
            </div>

            <div className="space-y-4 border-t border-slate-300/60 pt-5">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-950">Spend reward</h3>
                <p className="text-sm text-slate-600">Log a reward so the available balance stays honest.</p>
              </div>
              <div className="space-y-3">
                <ActionField
                  label="Reward name"
                  onChange={(event) => setRewardName(event.target.value)}
                  placeholder="Walk, coffee, reading"
                  value={rewardName}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ActionField
                    label="Cost in work blocks"
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setRewardCost(event.target.value)}
                    type="number"
                    value={rewardCost}
                  />
                  <ActionField
                    label="Reward minutes"
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setRewardMinutes(event.target.value)}
                    type="number"
                    value={rewardMinutes}
                  />
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
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
