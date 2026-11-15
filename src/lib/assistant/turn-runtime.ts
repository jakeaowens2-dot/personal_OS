import type { PlanningTurnInput } from "./state";

type ActiveRun = {
  kind: PlanningTurnInput["kind"];
  controller: AbortController;
  settled: Promise<void>;
};

// Survive Next dev module reloads. This is cancellation coordination, not storage;
// database leases still fence all durable writes, including after a restart.
const runtime = globalThis as typeof globalThis & {
  personalOsAssistantRuns?: Map<string, ActiveRun>;
};
const runs = runtime.personalOsAssistantRuns ??= new Map<string, ActiveRun>();

export async function withAssistantRun<T>(
  userId: string,
  kind: PlanningTurnInput["kind"],
  signal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  while (runs.has(userId)) {
    const previous = runs.get(userId)!;
    if (previous.kind !== "catch_up" || kind === "catch_up")
      throw new Error("Another reply is still running. Wait before retrying.");
    previous.controller.abort();
    // Never overlap two native Hermes loops sharing one conversation profile.
    await previous.settled;
    signal.throwIfAborted();
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) controller.abort();
  let settle!: () => void;
  const active: ActiveRun = {
    kind,
    controller,
    settled: new Promise<void>((resolve) => { settle = resolve; }),
  };
  runs.set(userId, active);
  try {
    controller.signal.throwIfAborted();
    return await execute(controller.signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (runs.get(userId) === active) runs.delete(userId);
    settle();
  }
}
