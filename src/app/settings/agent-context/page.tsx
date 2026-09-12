"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmailAuthPanel, type EmailAuthPanelState } from "@/components/auth/EmailAuthPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buildPlanningContextPacket, type PlanningContextPacketV1 } from "@/lib/planning";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AUTH_REQUIRED_MESSAGE, ensureWorkspaceUser } from "@/lib/workspace";

type PageState =
  | { kind: "connecting"; message: string }
  | { kind: "auth_required"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "error"; message: string };

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Section({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="border-t border-slate-200/80 pt-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-slate-500">{children}</p>;
}

export default function AgentContextPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [context, setContext] = useState<PlanningContextPacketV1 | null>(null);
  const [pageState, setPageState] = useState<PageState>({
    kind: "connecting",
    message: "Connecting planning context...",
  });
  const [authPanelState, setAuthPanelState] = useState<EmailAuthPanelState>({
    kind: "idle",
    message: null,
  });
  const [signInEmail, setSignInEmail] = useState("");
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [workspaceUserEmail, setWorkspaceUserEmail] = useState<string | null>(null);

  const loadContextForUser = useCallback(
    async (userId: string) => {
      if (!supabase) {
        return;
      }

      setPageState({ kind: "connecting", message: "Building planning context..." });

      try {
        const nextContext = await buildPlanningContextPacket(supabase, userId);
        setContext(nextContext);
        setPageState({ kind: "ready", message: "Planning context ready" });
      } catch (error) {
        setContext(null);
        setPageState({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not build the planning context.",
        });
      }
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;

    async function connectPlanningContext() {
      if (!supabase) {
        setPageState({
          kind: "error",
          message: "Supabase env vars are missing for this deployment. Add the public Supabase URL and publishable key.",
        });
        return;
      }

      try {
        const user = await ensureWorkspaceUser(supabase);

        if (cancelled) {
          return;
        }

        setWorkspaceUserId(user.id);
        setWorkspaceUserEmail(user.email ?? null);
        setAuthPanelState({ kind: "idle", message: null });
        await loadContextForUser(user.id);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Could not load planning context.";
        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setContext(null);
        setPageState({
          kind: message === AUTH_REQUIRED_MESSAGE ? "auth_required" : "error",
          message,
        });
      }
    }

    void connectPlanningContext();

    return () => {
      cancelled = true;
    };
  }, [loadContextForUser, supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;

      if (!user) {
        setWorkspaceUserId(null);
        setWorkspaceUserEmail(null);
        setContext(null);
        setPageState({ kind: "auth_required", message: AUTH_REQUIRED_MESSAGE });
        return;
      }

      setWorkspaceUserId(user.id);
      setWorkspaceUserEmail(user.email ?? null);
      setAuthPanelState({ kind: "idle", message: null });
      void loadContextForUser(user.id);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadContextForUser, supabase]);

  async function handleMagicLinkSignIn() {
    if (!supabase) {
      setAuthPanelState({ kind: "error", message: "Supabase env vars are missing for this deployment." });
      return;
    }

    const email = signInEmail.trim();

    if (!email) {
      setAuthPanelState({ kind: "error", message: "Enter your email address to receive a sign-in link." });
      return;
    }

    setAuthPanelState({ kind: "sending", message: "Sending sign-in link..." });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    setAuthPanelState(
      error
        ? { kind: "error", message: error.message || "Could not send the sign-in link." }
        : { kind: "sent", message: `Check ${email} for your sign-in link.` },
    );
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setPageState({ kind: "connecting", message: "Signing out..." });
    const { error } = await supabase.auth.signOut();

    if (error) {
      setPageState({ kind: "error", message: error.message || "Could not sign out." });
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff8ef_0%,#f6f0e7_38%,#f2ebdf_100%)] px-6 py-10 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge tone={pageState.kind === "error" ? "neutral" : "accent"}>{pageState.message}</Badge>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Planning settings</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Context preview</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Read-only context used by the future daily planner. It is assembled from your task, focus, and work history.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            {workspaceUserEmail ? <p className="text-sm text-slate-500">Logged in as {workspaceUserEmail}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!workspaceUserId || pageState.kind === "connecting"}
                onClick={() => workspaceUserId && void loadContextForUser(workspaceUserId)}
                size="sm"
              >
                Refresh
              </Button>
              <Link className="text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline" href="/settings/tasks">
                Task vault
              </Link>
              <Link className="text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline" href="/">
                Back home
              </Link>
              {workspaceUserId ? (
                <button
                  className="text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {pageState.kind === "error" ? <p className="text-sm text-rose-700">{pageState.message}</p> : null}

        {!workspaceUserId ? (
          <EmailAuthPanel
            email={signInEmail}
            onEmailChange={setSignInEmail}
            onSubmit={() => void handleMagicLinkSignIn()}
            state={authPanelState}
            title="Sign in to inspect planning context"
          />
        ) : context ? (
          <div className="space-y-8">
            <section className="grid gap-5 border-b border-slate-200/80 pb-7 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Planning date</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{context.date}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Schema</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">v{context.schemaVersion}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Generated</p>
                <p className="mt-2 text-sm font-medium text-slate-800">{formatTimestamp(context.generatedAt)}</p>
              </div>
            </section>

            <Section title="Today’s focus">
              {context.todayFocus.length === 0 ? (
                <EmptyState>No focus items have been added for today.</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-200/80 border-y border-slate-200/80">
                  {context.todayFocus.map((item) => (
                    <li className="flex items-start justify-between gap-4 py-3" key={item.id}>
                      <div>
                        <p className="text-sm font-medium text-slate-950">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.priority} priority · {item.focusStatus}
                          {item.carriedForward ? " · carried forward" : ""}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">#{item.position}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Yesterday’s focus">
              {context.yesterdayFocus.length === 0 ? (
                <EmptyState>No focus list was recorded yesterday.</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-200/80 border-y border-slate-200/80">
                  {context.yesterdayFocus.map((item) => (
                    <li className="flex items-start justify-between gap-4 py-3" key={item.id}>
                      <div>
                        <p className="text-sm font-medium text-slate-950">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.priority} priority · {item.focusStatus}
                          {item.statusReason ? ` · ${item.statusReason}` : ""}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">#{item.position}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Unresolved carryover">
              {context.carryover.length === 0 ? (
                <EmptyState>No active carried-forward tasks were found.</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-200/80 border-y border-slate-200/80">
                  {context.carryover.map((item) => (
                    <li className="flex items-start justify-between gap-4 py-3" key={item.focusItemId}>
                      <div>
                        <p className="text-sm font-medium text-slate-950">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.priority} priority</p>
                      </div>
                      <span className="text-sm text-slate-600">
                        {item.daysCarried === 1 ? "1 day" : `${item.daysCarried ?? 0} days`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Deadline pressure">
              {context.deadlinePressure.length === 0 ? (
                <EmptyState>No open task is due within the next 14 days.</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-200/80 border-y border-slate-200/80">
                  {context.deadlinePressure.map((item) => (
                    <li className="flex items-start justify-between gap-4 py-3" key={item.taskId}>
                      <div>
                        <p className="text-sm font-medium text-slate-950">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.priority} priority{item.area ? ` · ${item.area}` : ""}</p>
                      </div>
                      <span className="text-right text-sm text-slate-600">
                        {item.daysUntilDue < 0 ? `${Math.abs(item.daysUntilDue)} days overdue` : item.daysUntilDue === 0 ? "Due today" : `${item.daysUntilDue} days`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent work and completions">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium text-slate-900">Recent attributions</h3>
                  {context.recentAttributions.length === 0 ? (
                    <p className="mt-2 text-sm leading-6 text-slate-500">No attributed work blocks yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {context.recentAttributions.slice(0, 6).map((item) => (
                        <li className="text-sm" key={item.attributionId}>
                          <p className="font-medium text-slate-900">{item.title}</p>
                          <p className="text-slate-500">{item.attributedMinutes} minutes · {formatTimestamp(item.earnedAt)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-900">Recently completed</h3>
                  {context.recentlyCompleted.length === 0 ? (
                    <p className="mt-2 text-sm leading-6 text-slate-500">No completed tasks in the current history window.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {context.recentlyCompleted.slice(0, 6).map((item) => (
                        <li className="text-sm" key={item.taskId}>
                          <p className="font-medium text-slate-900">{item.title}</p>
                          <p className="text-slate-500">{formatTimestamp(item.completedAt)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Section>

            <Section title="Backlog pressure">
              <p className="text-2xl font-semibold tracking-tight text-slate-950">{context.backlogPressure.totalOpen} open tasks</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
                {Object.entries(context.backlogPressure.byPriority).length === 0 ? (
                  <span>No active backlog pressure.</span>
                ) : (
                  Object.entries(context.backlogPressure.byPriority).map(([priority, count]) => (
                    <span key={priority}>{priority}: {count}</span>
                  ))
                )}
              </div>
            </Section>

            <Section title="Next planning signals" description="Reserved inputs make the packet honest about what has not been built yet.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="border border-slate-200/80 px-4 py-3">
                  <p className="text-sm font-medium text-slate-900">Repeated deferrals</p>
                  <p className="mt-1 text-sm text-slate-500">{context.repeatedDeferrals.status === "not_computed" ? "Phase 7.5 pending" : "Ready"}</p>
                </div>
                <div className="border border-slate-200/80 px-4 py-3">
                  <p className="text-sm font-medium text-slate-900">Candidate daily plan</p>
                  <p className="mt-1 text-sm text-slate-500">{context.candidateDailyPlan.status === "not_computed" ? "Phase 7.4 pending" : "Ready"}</p>
                </div>
              </div>
            </Section>

            <Section title="Context warnings">
              {context.contextWarnings.length === 0 ? (
                <EmptyState>All available planning sections loaded successfully.</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {context.contextWarnings.map((warning) => (
                    <li className="border-l-2 border-amber-500 pl-3 text-sm text-slate-700" key={warning.code}>
                      {warning.message}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <details className="border-t border-slate-200/80 pt-5">
              <summary className="cursor-pointer text-sm font-medium text-slate-800 underline-offset-4 hover:underline">Raw packet JSON</summary>
              <pre className="mt-4 overflow-x-auto bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                {JSON.stringify(context, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <EmptyState>Loading the planning context…</EmptyState>
        )}
      </div>
    </main>
  );
}
