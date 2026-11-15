import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { codexEnvironment } from "./codex";
import { PLANNING_TOOLS } from "./tools";
import { PLANNING_INSTRUCTIONS } from "./planning-prompt";
import { uuid } from "./state";

export type HermesResult = {
  answer?: string;
  reviewed?: boolean;
  connection: { auth: "chatgpt"; model: string; runtime: "hermes" };
};
export const HERMES_BUDGETS = {
  run_seconds: 160,
  compression_idle_seconds: 30,
  compression_total_seconds: 60,
};
const HERMES_HOST_TIMEOUT_MS = 180_000;
export function hermesPaths(userId: string) {
  uuid(userId);
  const install =
    process.env.PERSONAL_ASSISTANT_HERMES_INSTALL ||
    join(homedir(), ".hermes/hermes-agent");
  return {
    install,
    python: join(install, "venv/bin/python"),
    profile: join(
      process.env.PERSONAL_ASSISTANT_RUNTIME_HOME ||
        join(homedir(), ".local/state/personal-os-assistant"),
      userId,
    ),
  };
}
export async function runHermes(options: {
  userId: string;
  sessionId?: string;
  turnId?: string;
  prompt?: unknown;
  signal?: AbortSignal;
  tool?: (name: string, args: unknown) => Promise<unknown>;
}): Promise<HermesResult> {
  const paths = hermesPaths(options.userId);
  const model = process.env.PERSONAL_ASSISTANT_MODEL || "gpt-5.6-terra";
  const child = spawn(
    paths.python,
    [
      join(
        /* turbopackIgnore: true */ process.cwd(),
        "scripts/hermes-planning-worker.py",
      ),
    ],
    {
      // The worker immediately enters its dedicated profile. It never needs the
      // project checkout as its working directory or as an implicit file input.
      cwd: tmpdir(),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...codexEnvironment(process.env),
        HERMES_HOME: paths.profile,
        PERSONAL_ASSISTANT_HERMES_INSTALL: paths.install,
        PYTHONDONTWRITEBYTECODE: "1",
        TOKENIZERS_PARALLELISM: "false",
      },
    },
  );
  child.stderr.resume();
  let result: HermesResult | undefined;
  let failure: Error | undefined;
  let toolQueue = Promise.resolve();
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const kill = () => {
    if (stopping) return;
    stopping = true;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
      }, 3000);
    }
  };
  const stop = (message: string) => {
    failure ??= new Error(message);
    kill();
  };
  const onAbort = () =>
    stop("Reply stopped. Saved messages and memory receipts are preserved.");
  const timeout = setTimeout(
    () =>
      stop("Hermes timed out. Saved state is preserved; retry this message."),
    HERMES_HOST_TIMEOUT_MS,
  );
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.length > 500_000) return stop("Oversized Hermes event.");
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return stop("Invalid Hermes protocol event.");
    }
    if (event.type === "tool") {
      if (!PLANNING_TOOLS.some((tool) => tool.name === event.name))
        return stop("Hermes requested a tool outside the planning allowlist.");
      toolQueue = toolQueue
        .then(async () => {
          if (failure || !options.tool)
            throw new Error("Tool calls are unavailable for this request.");
          const value = await options.tool(String(event.name), event.args);
          if (!child.stdin.destroyed)
            child.stdin.write(
              JSON.stringify({ id: event.id, result: value }) + "\n",
            );
        })
        .catch(() =>
          stop(
            "The application tool connection failed. Saved state is preserved.",
          ),
        );
    } else if (event.type === "progress") {
      const keys = ["history_messages", "snapshots_projected", "history_chars_before", "history_chars_after"] as const;
      if (event.stage !== "context_ready" || keys.some((key) =>
        typeof event[key] !== "number" || !Number.isSafeInteger(event[key]) || (event[key] as number) < 0))
        return stop("Hermes returned invalid progress metadata.");
      // Content-free diagnostics only; never log prompts, source text or auth.
      console.info("Hermes replay prepared", Object.fromEntries(keys.map((key) => [key, event[key]])));
    } else if (event.type === "done") {
      if (
        !event.connection ||
        (options.prompt &&
          (typeof event.answer !== "string" ||
            !event.answer.trim() ||
            event.answer.length > 32000))
      )
        return stop("Hermes returned an invalid answer.");
      result = event as unknown as HermesResult;
    } else if (event.type === "error") {
      console.error("Hermes adapter failure", event.error_type, event.location);
      stop(typeof event.error === "string" ? event.error : "Hermes failed.");
    } else stop("Unknown Hermes protocol event.");
  });
  child.stdin.on("error", () => stop("Hermes closed its tool connection."));
  try {
    child.stdin.write(
      JSON.stringify({
        check: !options.prompt,
        model,
        budgets: HERMES_BUDGETS,
        sessionId: options.sessionId,
        turnId: options.turnId,
        tools: PLANNING_TOOLS,
        instructions: PLANNING_INSTRUCTIONS,
        prompt: JSON.stringify(options.prompt),
      }) + "\n",
    );
    await new Promise<void>((resolve, reject) => {
      child.once("error", () =>
        reject(
          new Error(
            "Could not start Hermes. Check the configured installation and its Python environment.",
          ),
        ),
      );
      child.once("close", (code) => {
        if (code !== 0 && !failure)
          failure = new Error("Hermes stopped before completing.");
        resolve();
      });
    });
    await toolQueue;
    if (failure) throw failure;
    if (!result) throw new Error("Hermes exited without a completed result.");
    return result;
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    lines.close();
    options.signal?.removeEventListener("abort", onAbort);
  }
}
