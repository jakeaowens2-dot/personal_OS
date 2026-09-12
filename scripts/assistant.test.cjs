const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

// Use the repo's existing TypeScript compiler to load these Node-only modules;
// no test framework or runtime dependency is added to the app.
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { parseAssistantRequest, isLocalAssistantRequest } = require("../src/lib/assistant/contracts.ts");
const { codexEnvironment, runCodexAssistant } = require("../src/lib/assistant/codex.ts");
const { buildAssistantPrompt } = require("../src/lib/assistant/prompt.ts");
const input = { messages: [{ id: "one", role: "user", text: "Help me plan." }], context: null };

test("accepts bounded conversation data, rejects forged roles and oversized input", () => {
  assert.deepEqual(parseAssistantRequest(input), input);
  for (const invalid of [null, {}, { messages: [] }, { messages: [{ ...input.messages[0], role: "system" }] }, { messages: [{ ...input.messages[0], role: "assistant" }] }, { messages: [{ ...input.messages[0], text: "x".repeat(8001) }] }, { ...input, context: { large: "x".repeat(64001) } }]) {
    assert.throws(() => parseAssistantRequest(invalid));
  }
});

test("only permits explicitly enabled, same-origin loopback requests", () => {
  const request = (overrides = {}) => new Request("http://localhost:3016/api/assistant", { method: "POST", headers: { host: "localhost:3016", origin: "http://localhost:3016", "content-type": "application/json", ...overrides } });
  assert.equal(isLocalAssistantRequest(request(), true), true);
  assert.equal(isLocalAssistantRequest(request({ "x-forwarded-host": "localhost:3016" }), true), true);
  assert.equal(isLocalAssistantRequest(request(), false), false);
  for (const headers of [{ origin: "https://outside.example" }, { origin: "null" }, { "content-type": "text/plain" }, { "x-forwarded-host": "outside.example" }, { host: "outside.example" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal(isLocalAssistantRequest(request(headers), true), false);
  }
  assert.equal(isLocalAssistantRequest(new Request("https://outside.example/api/assistant", { headers: { host: "outside.example" } }), true), false);
});

test("does not pass app secrets or API credentials to Codex", () => {
  const env = codexEnvironment({ HOME: "/home/example", PATH: "/bin", HTTPS_PROXY: "http://proxy", OPENAI_API_KEY: "secret", SUPABASE_SERVICE_ROLE_KEY: "secret", CODEX_THREAD_ID: "parent" });
  assert.equal(env.HOME, "/home/example");
  assert.equal(env.HTTPS_PROXY, "http://proxy");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.CODEX_THREAD_ID, undefined);
});

test("prompt preserves conversation order and marks missing context honestly", () => {
  const prompt = JSON.parse(buildAssistantPrompt({ ...input, messages: [...input.messages, { id: "two", role: "assistant", text: "What matters most?" }, { id: "three", role: "user", text: "The demo." }] }));
  assert.equal(prompt.currentWorkspaceContext.status, "unavailable");
  assert.equal(prompt.recentConversation[2].text, "The demo.");
});

async function fakeRuntime(mode, work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "personal-os-runtime-test-"));
  const executable = path.join(directory, "codex");
  const transcript = path.join(directory, "calls.jsonl");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const lines = require('node:readline').createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
lines.on('line', line => {
  const m=JSON.parse(line); fs.appendFileSync(${JSON.stringify(transcript)}, line+'\\n');
  if (m.method==='initialize') send({id:m.id,result:{}});
  if (m.method==='account/read') send({id:m.id,result:{account:{type:${JSON.stringify(mode === "api" ? "apiKey" : "chatgpt")},planType:'business'}}});
  if (m.method==='config/read') send({id:m.id,result:{config:{mcp_servers:{dangerous:{}}}}});
  if (m.method==='thread/start') {
    const p=m.params;
    if (p.sandbox!=='read-only'||p.approvalPolicy!=='never'||p.environments.length||p.selectedCapabilityRoots.length||p.config['mcp_servers.dangerous.enabled']!==false||p.config['features.shell_tool']!==false) process.exit(2);
    send({id:m.id,result:{thread:{id:'test-thread'},model:p.model}});
  }
  if (m.method==='turn/start') {
    send({id:m.id,result:{turn:{id:'test-turn'}}});
    ${mode === "exit" ? "process.exit(1);" : mode === "wait" ? "" : `
    send({id:999,method:'item/tool/call',params:{name:'unexpected'}});
    send({method:'item/completed',params:{threadId:'test-thread',item:{type:'agentMessage',phase:'final_answer',text:'Start with the demo.'}}});
    send({method:'turn/completed',params:{threadId:'test-thread',turn:{status:${JSON.stringify(mode === "failed" ? "failed" : "completed")}}}});
    `}
  }
});
`, { mode: 0o700 });
  const previous = process.env.PERSONAL_ASSISTANT_CODEX_BIN;
  process.env.PERSONAL_ASSISTANT_CODEX_BIN = executable;
  try { await work(() => fs.readFileSync(transcript, "utf8").trim().split("\n").map(JSON.parse)); }
  finally {
    if (previous === undefined) delete process.env.PERSONAL_ASSISTANT_CODEX_BIN;
    else process.env.PERSONAL_ASSISTANT_CODEX_BIN = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("runs a restricted ephemeral turn and returns a subscription-backed answer", async () => {
  await fakeRuntime("success", async (calls) => {
    const result = await runCodexAssistant(input);
    assert.equal(result.answer, "Start with the demo.");
    assert.equal(result.connection.auth, "chatgpt");
    const thread = calls().find((call) => call.method === "thread/start").params;
    assert.equal(thread.ephemeral, true);
    assert.equal(thread.config.web_search, "disabled");
    assert.equal(thread.config["project_doc_max_bytes"], 0);
    assert.equal(fs.existsSync(thread.cwd), false);
  });
});

test("rejects API-key authentication instead of silently falling back", async () => {
  await fakeRuntime("api", async (calls) => {
    await assert.rejects(runCodexAssistant(input), /ChatGPT Business/);
    assert.equal(calls().some((call) => call.method === "thread/start"), false);
  });
});

test("failed turns and crashed runtimes do not become successful replies", async () => {
  await fakeRuntime("failed", async () => { await assert.rejects(runCodexAssistant(input), /could not complete/); });
  await fakeRuntime("exit", async () => { await assert.rejects(runCodexAssistant(input), /Codex stopped/); });
});

test("cancelling a pending turn rejects and cleans up its workspace", async () => {
  await fakeRuntime("wait", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 250);
    try { await assert.rejects(runCodexAssistant(input, controller.signal), /cancelled/); }
    finally { clearTimeout(timer); }
  });
});
