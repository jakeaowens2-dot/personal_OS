import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AssistantConnection, AssistantRequest } from "./contracts";
import { ASSISTANT_INSTRUCTIONS, buildAssistantPrompt } from "./prompt";

type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type AccountResult = { account: { type: string; planType?: string } | null };
type ThreadResult = { thread: { id: string }; model: string };

const DISABLED_FEATURES = ["apps", "plugins", "hooks", "shell_tool", "unified_exec", "multi_agent", "memories", "code_mode", "code_mode_host", "tool_suggest"];
const REQUEST_TIMEOUT = 20_000;
const TURN_TIMEOUT = 120_000;

export function codexBinary() {
  if (process.env.PERSONAL_ASSISTANT_CODEX_BIN) return process.env.PERSONAL_ASSISTANT_CODEX_BIN;
  const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
  return existsSync(bundled) ? bundled : "codex";
}

// Inherit OS/auth location and network configuration, not application secrets,
// API keys, Supabase credentials or the parent Codex task's runtime identifiers.
export function codexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SystemRoot", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
  return { ...Object.fromEntries(allowed.flatMap((key) => source[key] ? [[key, source[key]]] : [])), NODE_ENV: source.NODE_ENV || "production" };
}

class CodexClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private stopped = false;
  private terminalError: Error | null = null;

  constructor(cwd: string) {
    const args = ["app-server", "--stdio", ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), "-c", 'forced_login_method="chatgpt"'];
    this.child = spawn(codexBinary(), args, { cwd, env: codexEnvironment(process.env), stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (line.length > 2_000_000) return this.fail(new Error("Codex returned an oversized event."));
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; } catch { return; }
      if (message.method && message.id !== undefined) {
        // No approvals, client-side tool calls, login or token requests are
        // fulfilled by this runtime. It may only return a planning answer.
        this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "This assistant does not provide tools or permissions." } }) + "\n");
        return;
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      }
      this.listeners.forEach((listener) => listener(message));
    });
    // Drain diagnostics without returning potentially sensitive runtime logs.
    this.child.stderr.resume();
    this.child.on("error", () => this.fail(new Error("Could not start Codex. Check that Codex is installed and available to this local server.")));
    this.child.stdin.on("error", () => this.fail(new Error("The Codex connection closed.")));
    this.child.on("exit", () => {
      if (!this.stopped) this.fail(new Error("Codex stopped. Check its login and access to its local state directory."));
    });
  }

  private fail(error: Error) {
    this.terminalError = error;
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
    this.listeners.forEach((listener) => listener({ method: "local/error", error: { message: error.message } }));
  }

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.terminalError) throw this.terminalError;
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error("Codex did not respond. Check the local runtime and try again.")); }, REQUEST_TIMEOUT);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value as T); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  async initialize() {
    await this.call("initialize", { clientInfo: { name: "personal_os_assistant", title: "Personal OS", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    const { account } = await this.call<AccountResult>("account/read", { refreshToken: false });
    if (account?.type !== "chatgpt") throw new Error("Sign in to Codex with your ChatGPT Business account on this machine. API-key authentication is not used by this assistant.");
    return account;
  }

  async answer(threadId: string, input: AssistantRequest, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let answer = "";
      const cleanup = () => { clearTimeout(timeout); this.listeners.delete(onEvent); signal?.removeEventListener("abort", onAbort); };
      const fail = (message: string) => { cleanup(); reject(new Error(message)); };
      const onAbort = () => fail("The reply was cancelled.");
      const timeout = setTimeout(() => fail("Codex took longer than two minutes. Your message is preserved; try again."), TURN_TIMEOUT);
      const onEvent = (event: RpcMessage) => {
        if (event.method === "local/error") return fail(event.error?.message ?? "Codex disconnected.");
        if (event.params?.threadId !== threadId) return;
        if (event.method === "item/completed") {
          const item = event.params.item as { type?: string; text?: string; phase?: string } | undefined;
          if (item?.type === "agentMessage" && item.phase !== "commentary") answer = item.text ?? "";
        }
        if (event.method === "turn/completed") {
          const turn = event.params.turn as { status?: string; error?: { message?: string } } | undefined;
          if (turn?.status !== "completed") return fail("Codex could not complete the reply. Check your subscription usage or connection and retry.");
          if (!answer.trim() || answer.length > 32_000) return fail("Codex did not return a usable answer. Try again.");
          cleanup(); resolve(answer);
        }
      };
      this.listeners.add(onEvent);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) return onAbort();
      void this.call("turn/start", { threadId, effort: "medium", input: [{ type: "text", text: buildAssistantPrompt(input), text_elements: [] }] })
        .catch(() => fail("Codex could not start the reply. Check the configured model and connection."));
    });
  }

  close() {
    this.stopped = true;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const child = this.child;
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2_000);
    force.unref();
  }
}

export async function runCodexAssistant(input?: AssistantRequest, signal?: AbortSignal): Promise<{ connection: AssistantConnection; answer?: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "personal-os-assistant-"));
  const client = new CodexClient(cwd);
  try {
    const account = await client.initialize();
    const model = process.env.PERSONAL_ASSISTANT_MODEL || "gpt-5.6-terra";
    const connection: AssistantConnection = { auth: "chatgpt", plan: account.planType ?? null, model };
    if (!input) return { connection };
    const { config } = await client.call<{ config: { mcp_servers?: Record<string, unknown> } }>("config/read", { includeLayers: false });
    const overrides: Record<string, unknown> = {
      ...Object.fromEntries(DISABLED_FEATURES.map((feature) => [`features.${feature}`, false])),
      "agents.enabled": false, "tools.view_image": false, web_search: "disabled", project_doc_max_bytes: 0,
    };
    for (const name of Object.keys(config.mcp_servers ?? {})) overrides[`mcp_servers.${name}.enabled`] = false;
    const thread = await client.call<ThreadResult>("thread/start", {
      model, cwd, ephemeral: true, environments: [], selectedCapabilityRoots: [],
      sandbox: "read-only", approvalPolicy: "never", config: overrides, baseInstructions: ASSISTANT_INSTRUCTIONS,
    });
    return { connection: { ...connection, model: thread.model }, answer: await client.answer(thread.thread.id, input, signal) };
  } finally {
    client.close();
    await rm(cwd, { recursive: true, force: true });
  }
}
