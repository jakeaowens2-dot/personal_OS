"use client";

import type { DailyInitializationState } from "@/lib/assistant/state";
import styles from "./MorningOpening.module.css";

const steps = ["Time", "Brain dump", "Company move"];

function answered(state: DailyInitializationState) {
  return [
    state.availableTimeAnswered,
    state.brainDumpAnswered,
    state.companyMoveAnswered,
  ];
}

export function MorningOpening({
  state,
  disabled,
  onBegin,
  onPause,
}: {
  state: DailyInitializationState;
  disabled?: boolean;
  onBegin: () => void;
  onPause: () => void;
}) {
  const progress = answered(state);
  const waiting = state.phase.startsWith("awaiting_");

  if (state.phase === "complete") {
    return (
      <details className={styles.complete}>
        <summary>Morning opening complete</summary>
        <p>
          The three answers were synthesized with current planning context. The
          conversation and tool receipts remain the audit record.
        </p>
      </details>
    );
  }

  if (waiting || state.phase === "synthesizing") {
    return (
      <section
        className={styles.progressPanel}
        aria-label="Morning opening progress"
      >
        <div>
          <p className={styles.eyebrow}>Morning opening</p>
          <p className={styles.status}>
            {state.phase === "synthesizing"
              ? "Shaping the day from your answers…"
              : `Question ${progress.filter(Boolean).length + 1} of 3`}
          </p>
        </div>
        <ol>
          {steps.map((step, index) => (
            <li key={step} data-complete={progress[index]}>
              {step}
            </li>
          ))}
        </ol>
        {waiting && (
          <button type="button" disabled={disabled} onClick={onPause}>
            Pause opening
          </button>
        )}
      </section>
    );
  }

  const paused = state.phase === "paused";
  const deferred = state.phase === "deferred";
  return (
    <section className={paused || deferred ? styles.resume : styles.invitation}>
      <p className={styles.eyebrow}>Morning opening</p>
      <h2>
        {paused
          ? "Your place is saved."
          : deferred
            ? "Ready when you are."
            : "Let’s find the shape of today."}
      </h2>
      <p>
        {paused
          ? "Continue with the question where we stopped."
          : "I’ll ask three questions, one at a time, then shape a realistic day and a loose outlook for the week."}
      </p>
      <button type="button" disabled={disabled} onClick={onBegin}>
        {paused ? "Continue opening" : "Let’s begin"}
      </button>
    </section>
  );
}

