"use client";

import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import styles from "./assistant.module.css";
import { MAX_MESSAGE_LENGTH } from "@/lib/assistant/contracts";
import {
  localDate,
  type AssistantState,
  type PlanningTurn,
  type PlanningTurnInput,
} from "@/lib/assistant/state";
import {
  MemoryPanel,
  ProposalList,
  ReviewPanel,
} from "@/components/assistant/WorkingState";
import { MorningOpening } from "@/components/assistant/MorningOpening";

const PENDING_KEY = "personal-os.assistant.pending-turn.v2";
const LEGACY_KEY = "personal-os.assistant.conversation.v1";
type Connection = { auth: "chatgpt"; model: string; runtime: "hermes" };
function MessageText({ text }: { text: string }) {
  return (
    <div className={styles.messageText}>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, index) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={index}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </div>
  );
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AssistantPage() {
  const [state, setState] = useState<AssistantState | null>(null);
  const [date, setDate] = useState("");
  const [draft, setDraft] = useState("");
  const [draftReviewDate, setDraftReviewDate] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const [source, setSource] = useState<{ title: string; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState<PlanningTurnInput | null>(null);
  const [steeringTurnId, setSteeringTurnId] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const inFlight = useRef(false);
  const backgroundInFlight = useRef(false);
  const applyingRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const today = state?.today || localDate();
  const current = !date || date === today;
  const displayedReviews =
    state?.reviews.filter(
      (r) => r.local_date === (current ? state.lastActiveDate : date),
    ) ?? [];
  const closingReviews =
    state?.reviews.filter((r) => r.local_date === date && date === today) ?? [];
  const presentationSent = useRef(new Set<string>());
  const catchingUp = useRef(new Set<string>());

  const refresh = useCallback(async (selectedDate?: string, check = false) => {
    const query = new URLSearchParams({
      date: selectedDate || localDate(),
      ...(check ? { check: "1" } : {}),
    });
    const response = await fetch(`/api/assistant?${query}`);
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setState(null);
        setConnection(null);
        setPending(null);
      }
      throw new Error(result.error || "Could not load assistant state.");
    }
    try {
      const pendingKey = `${PENDING_KEY}:${result.state.userId}`;
      const saved = sessionStorage.getItem(pendingKey);
      const savedInput = saved
        ? (JSON.parse(saved) as PlanningTurnInput)
        : null;
      const savedTurn = savedInput
        ? result.state.turns.find(
            (turn: PlanningTurn) => turn.id === savedInput.id,
          )
        : null;
      const hasSteeringSuccessor = savedInput
        ? result.state.turns.some(
            (turn: PlanningTurn) =>
              turn.input_json.steeringForTurnId === savedInput.id,
          )
        : false;
      if (
        savedInput?.kind === "catch_up" ||
        savedTurn?.status === "completed" ||
        hasSteeringSuccessor
      ) {
        sessionStorage.removeItem(pendingKey);
        setPending(null);
      } else {
        setPending(savedInput);
      }
    } catch {
      setPending(null);
    }
    try {
      setLegacy(Boolean(localStorage.getItem(LEGACY_KEY)));
    } catch {}
    setState(result.state);
    setDate(result.state.date);
    if (result.connection) setConnection(result.connection);
    if (result.runtimeError) {
      setConnection(null);
      setError(result.runtimeError);
    }
    return result.state as AssistantState;
  }, []);
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize from authenticated server state and this user's tab-scoped retry key after hydration.
    void refresh(undefined, true)
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (state?.messages.length || busy)
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.messages.length, busy]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!inFlight.current && localDate() !== today)
        void refresh(localDate()).catch((cause) => setError(cause.message));
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh, today]);
  const recordPresentation = useCallback(
    (reviewId: string) => {
      const key = `${reviewId}:${today}`;
      if (presentationSent.current.has(key)) return;
      presentationSent.current.add(key);
      void fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "present", id: reviewId }),
      })
        .then((response) => {
          if (!response.ok)
            throw new Error(
              "The handoff is visible, but its presentation receipt could not be saved.",
            );
        })
        .catch((cause) => {
          presentationSent.current.delete(key);
          setError(cause.message);
        });
    },
    [today],
  );

  async function run(input: PlanningTurnInput) {
    if (inFlight.current || !state) return;
    const background = input.kind === "catch_up";
    if (background && backgroundInFlight.current) return;
    const pendingKey = `${PENDING_KEY}:${state.userId}`;
    if (background) {
      backgroundInFlight.current = true;
    } else {
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setPending(input);
      setDate(localDate());
      try {
        sessionStorage.setItem(pendingKey, JSON.stringify(input));
      } catch {
        setError(
          "This browser cannot keep a retry key. The server will still preserve accepted messages.",
        );
      }
    }
    const controller = new AbortController();
    if (!background) abort.current = controller;
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action: "turn", input }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not finish the reply.");
      // A preempted carryover request must not overwrite a newer foreground
      // reply or clear its retry key. The foreground response reloads state.
      if (background) {
        if (!inFlight.current) await refresh(localDate());
        return;
      }
      setState(result.state);
      setDate(result.state.date);
      if (result.connection) setConnection(result.connection);
      setPending(null);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {}
    } catch (cause) {
      if (input.kind !== "catch_up")
        setError(
          controller.signal.aborted
            ? "Reply stopped at the last durable checkpoint. Resume the saved exchange when you’re ready; accepted messages and completed writes remain preserved."
            : cause instanceof Error
              ? cause.message
              : "Could not finish the reply.",
        );
      try {
        if (!background || !inFlight.current) await refresh(localDate());
      } catch {
        /* Keep the original failure visible. */
      }
    } finally {
      if (background) {
        backgroundInFlight.current = false;
      } else {
        inFlight.current = false;
        abort.current = null;
        setBusy(false);
        composer.current?.focus();
      }
    }
  }
  // Prepare a missed closeout on opening, once per last-active document revision.
  // Failure remains visible and retryable; no background scheduler is needed.
  useEffect(() => {
    if (
      !state ||
      !connection ||
      busy ||
      pending ||
      !current ||
      !state.lastActiveDate
    )
      return;
    const document = state.documents.find(
      (d) => d.kind === "daily" && d.document_key === state.lastActiveDate,
    );
    if (
      state.reviews.some(
        (r) =>
          r.local_date === state.lastActiveDate &&
          r.revision === (document?.revision ?? 0),
      )
    )
      return;
    const key = `${state.lastActiveDate}:${state.today}`;
    if (catchingUp.current.has(key)) return;
    if (
      state.turns.some(
        (turn) =>
          turn.local_date === state.today &&
          turn.input_json.kind === "catch_up" &&
          turn.input_json.reviewDate === state.lastActiveDate,
      )
    )
      return;
    catchingUp.current.add(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the one bounded background review only after persisted state proves it is needed.
    void run({
      id: crypto.randomUUID(),
      kind: "catch_up",
      text: `Prepare the missed handoff from ${state.lastActiveDate}. Reassess all carry-forward items for today, ${state.today}, and show exclusions and uncertainties.`,
      reviewDate: state.lastActiveDate,
    });
    // run is intentionally invoked only on a new state/revision, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, connection, busy, pending, current]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || !connection || !current || inFlight.current || pending || activeForegroundTurn)
      return;
    const text = draft.trim();
    const sourceMessageId = draftSource;
    const reviewDate = draftReviewDate;
    const steeringForTurnId = steeringTurnId;
    setDraft("");
    setDraftSource(null);
    setDraftReviewDate(null);
    setSteeringTurnId(null);
    await run({
      id: crypto.randomUUID(),
      kind: reviewDate ? "closeout" : "message",
      ...(reviewDate ? { reviewDate } : {}),
      text,
      ...(sourceMessageId ? { sourceMessageId } : {}),
      ...(steeringForTurnId ? { steeringForTurnId } : {}),
    });
  }
  async function navigate(next: string) {
    if (inFlight.current) return;
    setError(null);
    try {
      await refresh(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load that date.",
      );
    }
  }
  function correct(text: string, reviewDate?: string) {
    setDraftReviewDate(reviewDate ?? null);
    setDraftSource(null);
    setDate(today);
    setDraft(text);
    void refresh(today).catch((cause) => setError(cause.message));
    composer.current?.focus();
  }
  async function resolve(id: string, apply: boolean) {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id, apply }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setState(result.state);
      setDate(result.state.date);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not resolve proposal.",
      );
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function showSource(id: string) {
    try {
      const response = await fetch(`/api/assistant?source=${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSource({
        title: `${result.source.role} · ${result.source.local_date}`,
        text: result.source.text,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Source unavailable.");
    }
  }
  const messages = state?.messages ?? [];
  const backgroundTurnIds = new Set(
    state?.turns
      .filter((turn) => turn.input_json.kind === "catch_up")
      .map((turn) => turn.id) ?? [],
  );
  const visibleMessages = messages.filter(
    (message) => !backgroundTurnIds.has(message.turn_id),
  );
  const initialization = state?.initialization ?? {
    phase: "idle" as const,
    availableTimeAnswered: false,
    brainDumpAnswered: false,
    companyMoveAnswered: false,
    completedAt: null,
  };
  const foregroundPending = pending?.kind === "catch_up" ? null : pending;
  const pendingVisible =
    foregroundPending &&
    !messages.some((m) => m.turn_id === foregroundPending.id);
  const prior = state?.dates
    .filter((d) => d < date)
    .sort()
    .at(-1);
  const next = state?.dates.filter((d) => d > date).sort()[0];
  const latest = state?.turns.find((t) => t.local_date === date);
  // The server reconciles expired leases; timestamps alone do not establish
  // ownership, and an old failure must not shadow a newer completed exchange.
  const needsRecovery = (turn: PlanningTurn) => turn.status === "failed";
  const hasSteeringSuccessor = (turnId: string) =>
    state?.turns.some(
      (successor) => successor.input_json.steeringForTurnId === turnId,
    );
  const latestForeground = state?.turns.find(
    (t) =>
      t.local_date === date &&
      t.input_json.kind !== "catch_up" &&
      !hasSteeringSuccessor(t.id),
  );
  const recoverable = latestForeground && needsRecovery(latestForeground)
    ? latestForeground
    : null;
  const pendingTurn = foregroundPending
    ? state?.turns.find((turn) => turn.id === foregroundPending.id)
    : null;
  const activeForegroundTurn = state?.turns.find(
    (turn) =>
      turn.local_date === date &&
      turn.input_json.kind !== "catch_up" &&
      !hasSteeringSuccessor(turn.id) &&
      turn.status === "running" &&
      !needsRecovery(turn),
  );
  const activeTurn = state?.turns.find((turn) => turn.status === "running");
  const pendingNeedsRecovery =
    foregroundPending && (!pendingTurn || needsRecovery(pendingTurn));
  const recoveryInput = pendingNeedsRecovery
    ? foregroundPending
    : recoverable
      ? { id: recoverable.id, ...recoverable.input_json }
      : null;
  const backgroundTurn = state?.turns.find(
    (t) =>
      current &&
      t.local_date === today &&
      t.input_json.kind === "catch_up" &&
      t.input_json.reviewDate === state.lastActiveDate,
  );
  const backgroundNeedsRecovery =
    backgroundTurn && needsRecovery(backgroundTurn);

  useEffect(() => {
    if (!current || !activeTurn) return;
    const timer = setInterval(() => {
      void refresh(localDate()).catch((cause) => setError(cause.message));
    }, 2_000);
    return () => clearInterval(timer);
  }, [activeTurn, current, refresh]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (!inFlight.current && document.visibilityState === "visible")
        void refresh().catch((cause) => setError(cause.message));
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [refresh]);

  return (
    <main className={styles.page}>
      <WorkspaceHeader />
      <header className={styles.header}>
        <h1 className="sr-only">Personal Assistant</h1>
        <details className={styles.details}>
          <summary className={styles.detailsToggle}>
            <span
              className={styles.connectionDot}
              data-connected={Boolean(connection)}
              aria-hidden="true"
            />
            Details
          </summary>
          <div className={styles.detailsPanel}>
            <p className={styles.detailsHeading}>
              {checking
                ? "Connecting…"
                : connection
                  ? "Hermes · ChatGPT login"
                  : "Assistant disconnected"}
            </p>
            {connection && <p>{connection.model}</p>}
            <p>
              Messages and core memory are saved to Personal OS. Task changes
              wait for your review.
            </p>
            <p>Days roll over at 4 a.m. Pacific. Keep this local server running.</p>
            <div className={styles.detailsActions}>
              <button
                type="button"
                disabled={busy || checking}
                onClick={() => {
                  setChecking(true);
                  void refresh(date, true)
                    .catch((cause) => setError(cause.message))
                    .finally(() => setChecking(false));
                }}
              >
                Reconnect
              </button>
              {state && (
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `personal-os-${date}.json`,
                      JSON.stringify({ schemaVersion: 1, ...state }, null, 2),
                    )
                  }
                >
                  Export day + memory
                </button>
              )}
              {legacy && (
                <button
                  type="button"
                  onClick={() =>
                    download(
                      "earlier-browser-chat.json",
                      localStorage.getItem(LEGACY_KEY) || "[]",
                    )
                  }
                >
                  Export earlier browser chat
                </button>
              )}
            </div>
          </div>
        </details>
      </header>
      <nav className={styles.dayBar} aria-label="Daily conversation history">
        <div>
          <button
            type="button"
            disabled={!prior || busy}
            onClick={() => prior && void navigate(prior)}
            aria-label="Previous active day"
          >
            ←
          </button>
          <input
            type="date"
            aria-label="Conversation date"
            value={date || today}
            max={today}
            disabled={busy}
            onChange={(e) => void navigate(e.target.value)}
          />
          <button
            type="button"
            disabled={!next || busy}
            onClick={() => next && void navigate(next)}
            aria-label="Next active day"
          >
            →
          </button>
          {!current && (
            <button type="button" onClick={() => void navigate(today)}>
              Today
            </button>
          )}
        </div>
        <div>
            <button
              type="button"
              disabled={!state}
              aria-expanded={memoryOpen}
            onClick={() => setMemoryOpen(!memoryOpen)}
          >
            Memory
          </button>
          <button
            type="button"
            disabled={!connection || busy || !current || Boolean(pending)}
            onClick={() =>
              void run({
                id: crypto.randomUUID(),
                kind: "closeout",
                text: "Close out today. Review what should carry forward, what should not and why, and anything uncertain. Preserve every relevant item.",
                reviewDate: today,
              })
            }
          >
            Close out day
          </button>
        </div>
      </nav>
      {memoryOpen && state && (
        <MemoryPanel
          state={state}
          onSource={(id) => void showSource(id)}
          onCorrect={correct}
        />
      )}
      {source && (
        <section className={styles.sourcePanel} aria-label="Source message">
          <div className={styles.sectionHeading}>
            <h2>{source.title}</h2>
            <button type="button" onClick={() => setSource(null)}>
              Close
            </button>
          </div>
          <MessageText text={source.text} />
        </section>
      )}
      <div
        className={`${styles.workspace} ${!visibleMessages.length ? styles.emptyWorkspace : ""}`}
      >
        <div className={styles.conversationArea}>
          {(!!displayedReviews.length || backgroundTurn) && (
            <details
              className={styles.carryoverDisclosure}
              open={carryoverOpen}
              onToggle={(event) =>
                setCarryoverOpen(event.currentTarget.open)
              }
            >
              <summary>
                Carryover from {displayedReviews[0]?.local_date ?? state?.lastActiveDate}
                {displayedReviews.length
                  ? " · review available"
                  : backgroundNeedsRecovery
                    ? " · review needs attention"
                    : backgroundTurn?.status === "running"
                      ? " · preparing review"
                      : " · review incomplete"}
              </summary>
              {carryoverOpen && !!displayedReviews.length && (
                <ReviewPanel
                  reviews={displayedReviews}
                  onPresented={recordPresentation}
                  onSource={(id) => void showSource(id)}
                  onCorrect={correct}
                />
              )}
              {carryoverOpen && !displayedReviews.length && backgroundTurn && (
                <div className={styles.carryoverRecovery}>
                  <p>
                    The background carryover review did not finish. This does
                    not block today’s conversation or morning opening.
                  </p>
                  {backgroundNeedsRecovery && (
                    <button
                      type="button"
                      disabled={busy || !connection}
                      onClick={() =>
                        void run({
                          id:
                            backgroundTurn.status === "completed"
                              ? crypto.randomUUID()
                              : backgroundTurn.id,
                          ...backgroundTurn.input_json,
                        })
                      }
                    >
                      Retry carryover review
                    </button>
                  )}
                </div>
              )}
            </details>
          )}
          {!!closingReviews.length && (
            <ReviewPanel
              reviews={closingReviews}
              onPresented={recordPresentation}
              onSource={(id) => void showSource(id)}
              onCorrect={correct}
            />
          )}
          {!visibleMessages.length && !pending && !current && (
              <div className={styles.welcome}>
                <span className={styles.welcomeMark} aria-hidden="true">✳</span>
                <h2>A quiet day.</h2>
                <p>No exchanges recorded for this date.</p>
              </div>
          )}
          <div aria-label="Conversation" className={styles.conversation}>
            {visibleMessages.map((message) => (
              <article
                key={message.id}
                aria-label={
                  message.role === "user"
                    ? "You"
                    : message.role === "system"
                      ? "Daily opening"
                      : "Assistant"
                }
                className={
                  message.role === "user"
                    ? styles.userMessage
                    : styles.assistantMessage
                }
              >
                <MessageText text={message.text} />
                {message.source_message_id && (
                  <button
                    type="button"
                    className={styles.textAction}
                    onClick={() => void showSource(message.source_message_id!)}
                  >
                    Continued from an earlier exchange
                  </button>
                )}
                {!current && message.role !== "system" && (
                  <button
                    type="button"
                    className={styles.textAction}
                    disabled={busy}
                    onClick={() => {
                      setDate(today);
                      setDraftSource(message.id);
                      setDraftReviewDate(null);
                      setDraft(
                        `Continuing our ${message.local_date} exchange: ${message.text.slice(0, 1500)}\n\n`,
                      );
                      void refresh(today).catch((cause) =>
                        setError(cause.message),
                      );
                    }}
                  >
                    Continue today
                  </button>
                )}
                {message.role === "assistant" && (
                  <p className={styles.receiptLine}>
                    {state?.receipts
                      .filter(
                        (r) =>
                          r.turn_id === message.turn_id &&
                          (r.tool.startsWith("save_") ||
                            r.tool === "set_today_focus"),
                      )
                      .map((r) =>
                        r.tool === "set_today_focus"
                          ? `Today’s focus · ${Array.isArray(r.result_json.entries) ? r.result_json.entries.length : Array.isArray(r.result_json.task_ids) ? r.result_json.task_ids.length : 0} priorities`
                          : `${String(r.result_json.home)} r${String(r.result_json.revision)}`,
                      )
                      .join(" · ")}
                  </p>
                )}
                {message.role === "assistant" && state && <ProposalList
                  proposals={state.proposals.filter((p) => p.status !== "pending" && p.resolved_message_id === message.id)}
                  onResolve={(id, apply) => void resolve(id, apply)}
                  busy={applying}
                />}
              </article>
            ))}
          </div>
          {pendingVisible && (
            <article className={styles.userMessage}>
              <MessageText text={foregroundPending.text} />
            </article>
          )}
          {busy && (
            <p role="status" className={styles.thinking}>
              <span aria-hidden="true">✳</span> Thinking and updating working
              state…
            </p>
          )}
          {!busy && activeForegroundTurn && (
            <p role="status" className={styles.thinking}>
              <span aria-hidden="true">✳</span> Hermes is still working. You can
              use the rest of Personal OS; the response will appear here when
              it finishes.
            </p>
          )}
          {current && state && !foregroundPending && (
            <MorningOpening
              state={initialization}
              disabled={!connection || busy || Boolean(activeForegroundTurn)}
              onBegin={() =>
                void run({
                  id: crypto.randomUUID(),
                  kind: "message",
                  text:
                    initialization.phase === "paused"
                      ? "Let’s continue the morning opening."
                      : "Let’s begin the morning opening.",
                  morningAction:
                    initialization.phase === "paused" ? "continue" : "begin",
                })
              }
              onPause={() =>
                void run({
                  id: crypto.randomUUID(),
                  kind: "message",
                  text: "Pause the morning opening for now.",
                  morningAction: "pause",
                })
              }
            />
          )}
          {state && (
            <ProposalList
              proposals={state.proposals.filter(
                (p) => p.status === "pending",
              )}
              onResolve={(id, apply) => void resolve(id, apply)}
              busy={applying}
            />
          )}
          {latest?.status === "completed" &&
            latest.memory_status === "pending" && (
              <p className={styles.warning}>
                The reply is saved, but memory maintenance was not confirmed.
                Ask the assistant to review and save this exchange.
              </p>
            )}
          <div ref={end} />
        </div>
        <footer className={styles.footer}>
          {error && (
            <div role="alert" className={styles.warning}>
              <p>{error}</p>
              {!state && <Link href="/">Open Home to sign in</Link>}
            </div>
          )}
          {!busy &&
            connection &&
            !steeringTurnId &&
            recoveryInput && (
              <div className={styles.recovery}>
                <span>{pendingNeedsRecovery && !pendingTurn
                  ? "Your message was not submitted. You can retry it."
                  : "A previous exchange needs attention."}</span>
                <button
                  type="button"
                  onClick={() => void run(recoveryInput)}
                >
                  {pendingNeedsRecovery && !pendingTurn ? "Retry message" : "Resume saved exchange"}
                </button>
                {!(pendingNeedsRecovery && !pendingTurn) && <button
                  type="button"
                  onClick={() => {
                    const saved = recoveryInput;
                    if (!saved) return;
                    const sourceMessage = messages.find(
                      (message) =>
                        message.turn_id === saved.id && message.role === "user",
                    );
                    try {
                      sessionStorage.removeItem(
                        `${PENDING_KEY}:${state?.userId}`,
                      );
                    } catch {}
                    setPending(null);
                    setSteeringTurnId(saved.id);
                    setDraftSource(sourceMessage?.id ?? null);
                    setDraft("");
                    composer.current?.focus();
                  }}
                >
                  Steer instead
                </button>}
              </div>
            )}
          {steeringTurnId && (
            <div className={styles.recovery}>
              <span>
                Write the new direction below. The assistant will restart only
                the saved coarse agent step.
              </span>
              <button
                type="button"
                onClick={() => {
                  setSteeringTurnId(null);
                  setDraftSource(null);
                  setDraft("");
                }}
              >
                Cancel steering
              </button>
            </div>
          )}
          {state?.warnings.map((warning) => (
            <p key={warning} className={styles.warning}>
              {warning}
            </p>
          ))}
          {current ? (
            <form
              onSubmit={(event) => void send(event)}
              className={styles.composer}
            >
              <label htmlFor="assistant-message" className="sr-only">
                Message your assistant
              </label>
              <textarea
                id="assistant-message"
                ref={composer}
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={2}
                disabled={!state}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What are you thinking about?"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className={styles.input}
              />
              <div className={styles.composerBar}>
                <span className={styles.composerHint}>
                  {draftSource
                    ? steeringTurnId
                      ? "Steering the saved exchange"
                      : "Continuing an earlier exchange"
                    : checking
                      ? "Connecting…"
                      : !connection
                        ? "Not connected"
                        : busy
                          ? "Saving as we go"
                          : ""}
                </span>
                {busy ? (
                  <button
                    className={styles.sendButton}
                    type="button"
                    onClick={() => abort.current?.abort()}
                    aria-label="Stop reply"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    className={styles.sendButton}
                    type="submit"
                    disabled={!draft.trim() || !connection || Boolean(pending) || Boolean(activeForegroundTurn)}
                    aria-label="Send message"
                  >
                    ↑
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className={styles.muted}>
              History is read-only. Continue an exchange today to pick it up.
            </p>
          )}
        </footer>
      </div>
    </main>
  );
}
