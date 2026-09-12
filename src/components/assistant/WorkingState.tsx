"use client";
import { useEffect, useState } from "react";
import type {
  AssistantState,
  DailyReview,
  MemoryDocument,
  MemoryEntry,
  TaskProposal,
} from "@/lib/assistant/state";
import styles from "@/app/assistant/assistant.module.css";

function Sources({
  ids,
  onSource,
}: {
  ids: string[];
  onSource: (id: string) => void;
}) {
  return (
    <span className={styles.sourceLinks}>
      {ids.map((id, index) => (
        <button type="button" key={id} onClick={() => onSource(id)}>
          Source {index + 1}
        </button>
      ))}
    </span>
  );
}
export function MemoryPanel({
  state,
  onSource,
  onCorrect,
}: {
  state: AssistantState;
  onSource: (id: string) => void;
  onCorrect: (text: string, reviewDate?: string) => void;
}) {
  const homes: [string, MemoryDocument | undefined][] = [
    ["Preferences", state.documents.find((d) => d.kind === "preferences")],
    [
      state.date === state.today ? "Today’s notes" : `Notes · ${state.date}`,
      state.documents.find(
        (d) => d.kind === "daily" && d.document_key === state.date,
      ),
    ],
    [
      "Ongoing priorities",
      state.documents.find((d) => d.kind === "priorities"),
    ],
  ];
  const [history, setHistory] = useState<{
    title: string;
    text: string;
  } | null>(null);
  async function revisions(document: MemoryDocument, title: string) {
    try {
      const response = await fetch(`/api/assistant?revisions=${document.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setHistory({
        title: `${title} — revisions`,
        text: JSON.stringify(data, null, 2),
      });
    } catch (error) {
      setHistory({
        title: "Revision history unavailable",
        text: error instanceof Error ? error.message : "Try again.",
      });
    }
  }
  return (
    <section className={styles.workingState} aria-label="Assistant memory">
      {homes.map(([title, document]) => (
        <section key={title} className={styles.memoryHome}>
          <div className={styles.sectionHeading}>
            <h2>{title}</h2>
            {document && (
              <button
                type="button"
                onClick={() => void revisions(document, title)}
              >
                Revision {document.revision}
              </button>
            )}
          </div>
          {!document?.content_json.entries.length && (
            <p className={styles.muted}>Nothing recorded yet.</p>
          )}
          {document?.content_json.entries.map((entry) => (
            <div key={entry.id} className={styles.memoryEntry}>
              {entry.title && <strong>{entry.title}</strong>}
              <p>{entry.text}</p>
              {entry.rationale && (
                <p className={styles.muted}>{entry.rationale}</p>
              )}
              <div className={styles.entryMeta}>
                {entry.origin === "inferred" && (
                  <span>Tentative · needs your endorsement</span>
                )}
                {entry.state && entry.state !== "active" && (
                  <span>{entry.state}</span>
                )}
                {entry.scope && <span>{entry.scope}</span>}
                {entry.last_confirmed_at && (
                  <span>
                    Confirmed{" "}
                    {new Date(entry.last_confirmed_at).toLocaleDateString()}
                  </span>
                )}
                {entry.updated_at && (
                  <time>{new Date(entry.updated_at).toLocaleDateString()}</time>
                )}
              </div>
              <Sources ids={entry.source_ids} onSource={onSource} />
              <button
                className={styles.textAction}
                type="button"
                onClick={() =>
                  onCorrect(
                    `Please correct the ${title.toLowerCase()} entry “${entry.title || entry.text}” (entry ${entry.id}, home ${document.kind}/${document.document_key}). My correction: `,
                    document.kind === "daily"
                      ? document.document_key
                      : undefined,
                  )
                }
              >
                Correct
              </button>
            </div>
          ))}
        </section>
      ))}
      {history && (
        <div
          className={styles.sourcePanel}
          role="region"
          aria-label={history.title}
        >
          <div className={styles.sectionHeading}>
            <h3>{history.title}</h3>
            <button type="button" onClick={() => setHistory(null)}>
              Close
            </button>
          </div>
          <pre>{history.text}</pre>
        </div>
      )}
    </section>
  );
}

const GROUPS: [MemoryEntry["disposition"], string][] = [
  ["relevant_next_day", "Carry forward"],
  ["not_relevant_next_day", "Not carrying forward — and why"],
  ["uncertain", "Uncertain / needs your input"],
];
export function ReviewPanel({
  reviews,
  onPresented,
  onSource,
  onCorrect,
}: {
  reviews: DailyReview[];
  onPresented: (id: string) => void;
  onSource: (id: string) => void;
  onCorrect: (text: string, reviewDate?: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const review = reviews.find((r) => r.id === selected) || reviews[0];
  const reviewId = review?.id;
  useEffect(() => {
    if (reviewId) onPresented(reviewId);
  }, [reviewId, onPresented]);
  if (!review) return null;
  return (
    <section className={styles.reviewPanel} aria-label="Daily handoff">
      <div className={styles.sectionHeading}>
        <h2>Handoff from {review.local_date}</h2>
        {reviews.length > 1 && (
          <select
            aria-label="Review revision"
            value={review.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {reviews.map((r) => (
              <option key={r.id} value={r.id}>
                Revision {r.revision}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className={styles.muted}>
        {review.origin === "catch_up"
          ? "Catch-up review prepared"
          : "Closeout prepared"}{" "}
        {new Date(review.created_at).toLocaleString()} · revision{" "}
        {review.revision}
      </p>
      {GROUPS.map(([disposition, title]) => (
        <div key={disposition} className={styles.reviewGroup}>
          <h3>{title}</h3>
          {!review.entries_json.some((e) => e.disposition === disposition) && (
            <p className={styles.muted}>None recorded.</p>
          )}
          {review.entries_json
            .filter((e) => e.disposition === disposition)
            .map((entry) => (
              <div key={entry.id} className={styles.memoryEntry}>
                <p>{entry.text}</p>
                <p className={styles.muted}>{entry.rationale}</p>
                <Sources ids={entry.source_ids} onSource={onSource} />
                <button
                  type="button"
                  className={styles.textAction}
                  onClick={() =>
                    onCorrect(
                      `Please revise the ${review.local_date} handoff item “${entry.text}” (entry ${entry.id}). It is currently ${entry.disposition}. My correction: `,
                      review.local_date,
                    )
                  }
                >
                  Correct
                </button>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}

export function ProposalList({
  proposals,
  onResolve,
  busy,
}: {
  proposals: TaskProposal[];
  onResolve: (id: string, apply: boolean) => void;
  busy: boolean;
}) {
  if (!proposals.length) return null;
  return (
    <section className={styles.proposals} aria-label="Task changes to review">
      <h2>Task changes to review</h2>
      {proposals.map((p) => (
        <article key={p.id} className={styles.proposal}>
          <strong>
            {p.before_json?.title || p.patch_json.title || "Task update"}
          </strong>
          <dl>
            {Object.entries(p.patch_json).map(([key, value]) => (
              <div key={key}>
                <dt>
                  {key === "human_summary"
                    ? "Progress note"
                    : key.replaceAll("_", " ")}
                </dt>
                <dd>
                  {p.before_json &&
                    p.before_json[key as keyof typeof p.before_json] && (
                      <>
                        <span className={styles.beforeValue}>
                          {p.before_json[key as keyof typeof p.before_json]}
                        </span>
                        <span aria-label="to"> → </span>
                      </>
                    )}
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className={styles.muted}>{p.reason}</p>
          {p.status === "pending" ? (
            <div className={styles.proposalActions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(p.id, true)}
              >
                Apply {p.task_id ? "change" : "new task"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(p.id, false)}
              >
                Reject
              </button>
            </div>
          ) : (
            <p className={styles.muted}>
              {p.status === "applied" ? "Applied to task vault" : "Rejected"}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
