"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { createPaperReading, fetchPaperReadings, type PaperReadingInput } from "@/lib/knowledge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AUTH_REQUIRED_MESSAGE, ensureWorkspaceUser } from "@/lib/workspace";
import type { PaperReadingEntry } from "@/lib/types";
import styles from "./growth.module.css";
import { wakingDateKey } from "@/lib/activity-day";

function localDate() {
  return wakingDateKey();
}

const emptyInput = (): PaperReadingInput => ({
  title: "",
  citation: "",
  sourceUrl: "",
  completedOn: localDate(),
  notes: "",
});

export default function GrowthPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PaperReadingEntry[]>([]);
  const [input, setInput] = useState<PaperReadingInput>(emptyInput);
  const [status, setStatus] = useState("Opening your reading record…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    if (!supabase) throw new Error("This workspace is missing its Supabase connection.");
    const user = await ensureWorkspaceUser(supabase);
    const readings = await fetchPaperReadings(supabase, user.id);
    setUserId(user.id);
    setEntries(readings);
    setStatus(readings.length ? `${readings.length} paper${readings.length === 1 ? "" : "s"} recorded` : "Ready for the first paper");
    setError(null);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Open the authenticated, RLS-scoped reading record after hydration.
    void connect().catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Could not open Knowledge & Growth.");
      setStatus("");
    });
    return () => { active = false; };
  }, [connect]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !userId || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Saving this reading…");
    try {
      const saved = await createPaperReading(supabase, userId, input);
      setEntries((current) => [saved, ...current]);
      setInput(emptyInput());
      setStatus("Paper recorded");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this paper.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const signedOut = error === AUTH_REQUIRED_MESSAGE;
  return (
    <main className={styles.page}>
      <WorkspaceHeader status={status || undefined} />
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Knowledge &amp; Growth</p>
          <h1>Bring back what you learned.</h1>
        </div>
        <p className={styles.purpose}>For now, this profile does one job: preserve a paper and the thinking you want to carry forward.</p>
      </section>

      {error && (
        <div className={styles.notice} role="alert">
          <p>{error}</p>
          {signedOut && <Link href="/">Sign in on Work tracking</Link>}
          {!signedOut && <button type="button" onClick={() => void connect()}>Try again</button>}
        </div>
      )}

      <div className={styles.workspace}>
        <form className={styles.form} onSubmit={(event) => void save(event)}>
          <div className={styles.sectionHeading}>
            <h2>Log a completed paper</h2>
            <span>Required fields marked *</span>
          </div>
          <label>
            <span>Paper title *</span>
            <input
              value={input.title}
              maxLength={500}
              disabled={!userId || busy}
              onChange={(event) => setInput({ ...input, title: event.target.value })}
              placeholder="The paper you finished"
            />
          </label>
          <div className={styles.row}>
            <label>
              <span>Authors or citation</span>
              <input
                value={input.citation}
                maxLength={1000}
                disabled={!userId || busy}
                onChange={(event) => setInput({ ...input, citation: event.target.value })}
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Date read</span>
              <input
                type="date"
                value={input.completedOn}
                max={localDate()}
                disabled={!userId || busy}
                onChange={(event) => setInput({ ...input, completedOn: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>Link or DOI</span>
            <input
              type="url"
              value={input.sourceUrl}
              maxLength={2000}
              disabled={!userId || busy}
              onChange={(event) => setInput({ ...input, sourceUrl: event.target.value })}
              placeholder="https://…"
            />
          </label>
          <label>
            <span>Your notes *</span>
            <textarea
              value={input.notes}
              maxLength={20000}
              rows={9}
              disabled={!userId || busy}
              onChange={(event) => setInput({ ...input, notes: event.target.value })}
              placeholder="Claims, methods, implications, questions, or connections worth retaining…"
            />
          </label>
          <button className={styles.save} type="submit" disabled={!userId || busy || !input.title.trim() || !input.notes.trim()}>
            {busy ? "Saving…" : "Record paper"}
          </button>
        </form>

        <section className={styles.log} aria-labelledby="reading-log-title">
          <div className={styles.sectionHeading}>
            <h2 id="reading-log-title">Reading record</h2>
            <span>{entries.length} total</span>
          </div>
          {!entries.length && !error ? (
            <p className={styles.empty}>Nothing logged yet. Finish a paper, then bring back the notes that changed or sharpened your thinking.</p>
          ) : (
            <div className={styles.entries}>
              {entries.map((entry) => (
                <article key={entry.id} className={styles.entry}>
                  <div className={styles.entryMeta}>
                    <time dateTime={entry.completed_on}>{new Date(`${entry.completed_on}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
                    {entry.citation && <span>{entry.citation}</span>}
                  </div>
                  <h3>{entry.source_url ? <a href={entry.source_url} target="_blank" rel="noreferrer">{entry.title}</a> : entry.title}</h3>
                  <p>{entry.notes}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
