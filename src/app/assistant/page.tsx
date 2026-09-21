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
  type PlanningTurnInput,
} from "@/lib/assistant/state";
import {
  MemoryPanel,
  ProposalList,
  ReviewPanel,
} from "@/components/assistant/WorkingState";

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
  const [observedAt, setObservedAt] = useState(0);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [source, setSource] = useState<{ title: string; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState<PlanningTurnInput | null>(null);
  const [legacy, setLegacy] = useState(false);
  const inFlight = useRef(false);
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
  const pendingOwner = useRef<string | null>(null);
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
        pendingOwner.current = null;
      }
      throw new Error(result.error || "Could not load assistant state.");
    }
    if (pendingOwner.current !== result.state.userId) {
      pendingOwner.current = result.state.userId;
      try {
        const saved = sessionStorage.getItem(
          `${PENDING_KEY}:${result.state.userId}`,
        );
        setPending(saved ? JSON.parse(saved) : null);
      } catch {
        setPending(null);
      }
    }
    try {
      setLegacy(Boolean(localStorage.getItem(LEGACY_KEY)));
    } catch {}
    setObservedAt(Date.now());
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
      abort.current?.abort();
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
    const pendingKey = `${PENDING_KEY}:${state.userId}`;
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
    const controller = new AbortController();
    abort.current = controller;
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
      setObservedAt(Date.now());
      setState(result.state);
      setDate(result.state.date);
      if (result.connection) setConnection(result.connection);
      setPending(null);
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {}
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "Reply stopped. Any accepted message and saved memory remain in your history."
          : cause instanceof Error
            ? cause.message
            : "Could not finish the reply.",
      );
      try {
        await refresh(localDate());
      } catch {
        /* Keep the original failure visible. */
      }
    } finally {
      inFlight.current = false;
      abort.current = null;
      setBusy(false);
      composer.current?.focus();
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
    catchingUp.current.add(key);
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
    if (!draft.trim() || !connection || !current || inFlight.current || pending)
      return;
    const text = draft.trim();
    const sourceMessageId = draftSource;
    const reviewDate = draftReviewDate;
    setDraft("");
    setDraftSource(null);
    setDraftReviewDate(null);
    await run({
      id: crypto.randomUUID(),
      kind: reviewDate ? "closeout" : "message",
      ...(reviewDate ? { reviewDate } : {}),
      text,
      ...(sourceMessageId ? { sourceMessageId } : {}),
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
  const pendingVisible =
    pending && !messages.some((m) => m.turn_id === pending.id);
  const prior = state?.dates
    .filter((d) => d < date)
    .sort()
    .at(-1);
  const next = state?.dates.filter((d) => d > date).sort()[0];
  const latest = state?.turns.find((t) => t.local_date === date);
  const recoverable = state?.turns.find(
    (t) =>
      t.status === "failed" ||
      (t.status === "running" &&
        observedAt - Date.parse(t.updated_at) > 300_000),
  );

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
            <p>Dates use America/Chicago. Keep this local server running.</p>
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
        className={`${styles.workspace} ${!messages.length ? styles.emptyWorkspace : ""}`}
      >
        <div className={styles.conversationArea}>
          {!!displayedReviews.length && (
            <ReviewPanel
              reviews={displayedReviews}
              onPresented={recordPresentation}
              onSource={(id) => void showSource(id)}
              onCorrect={correct}
            />
          )}
          {!!closingReviews.length && (
            <ReviewPanel
              reviews={closingReviews}
              onPresented={recordPresentation}
              onSource={(id) => void showSource(id)}
              onCorrect={correct}
            />
          )}
          {!messages.length && !pending && (
            <div className={styles.welcome}>
              <span className={styles.welcomeMark} aria-hidden="true">
                ✳
              </span>
              <h2>{current ? "What’s on your mind?" : "A quiet day."}</h2>
              <p>
                {current
                  ? "Make a little room to think."
                  : "No exchanges recorded for this date."}
              </p>
            </div>
          )}
          <div aria-label="Conversation" className={styles.conversation}>
            {messages.map((message) => (
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
                          r.tool.startsWith("save_"),
                      )
                      .map(
                        (r) =>
                          `${String(r.result_json.home)} r${String(r.result_json.revision)}`,
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
              <MessageText text={pending.text} />
            </article>
          )}
          {busy && (
            <p role="status" className={styles.thinking}>
              <span aria-hidden="true">✳</span> Thinking and updating working
              state…
            </p>
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
          {!busy && connection && (pending || recoverable) && (
            <div className={styles.recovery}>
              <span>A previous exchange needs attention.</span>
              <button
                type="button"
                onClick={() =>
                  void run(
                    pending || {
                      id: recoverable!.id,
                      ...recoverable!.input_json,
                    },
                  )
                }
              >
                Retry saved exchange
              </button>
              {pending && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem(
                        `${PENDING_KEY}:${state?.userId}`,
                      );
                    } catch {}
                    setPending(null);
                  }}
                >
                  Leave saved and continue
                </button>
              )}
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
                    ? "Continuing an earlier exchange"
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
                    disabled={!draft.trim() || !connection || Boolean(pending)}
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
