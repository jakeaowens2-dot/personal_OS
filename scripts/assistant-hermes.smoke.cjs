const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const root = process.cwd();
const ts = require(path.join(root, "node_modules/typescript"));
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const { runHermes } = require(path.join(root, "src/lib/assistant/hermes.ts"));
const { parseEntry, localDate } = require(
  path.join(root, "src/lib/assistant/state.ts"),
);
// Opt-in smoke test: uses the existing ChatGPT subscription, never real app records.
const profileRoot = fs.mkdtempSync(
  path.join(require("node:os").tmpdir(), "personal-os-hermes-smoke-"),
);
process.env.PERSONAL_ASSISTANT_RUNTIME_HOME = profileRoot;
const userId = randomUUID(),
  sessionId = randomUUID(),
  source = randomUUID();
const homes = {};
const calls = [];
let proposed = false;
const state = () => ({
  schemaVersion: 1,
  date: localDate(),
  timeZone: "America/Chicago",
  memoryHomes: Object.values(homes),
  dailyNotes: Object.values(homes).filter((d) => d.kind === "daily"),
  recentMessages: [
    {
      id: source,
      role: "user",
      text: "This is fictional test data. I prefer brief paragraphs. My ongoing priority is the Juniper offline demo because venue connectivity is unreliable. The prototype is ready; rehearsal remains. Please create a rehearsal task, pending my approval.",
    },
  ],
  tasks: [],
  pendingProposals: proposed
    ? [{ title: "Rehearse the Juniper offline demo", status: "pending" }]
    : [],
});
async function tool(name, args) {
  calls.push({ name, args });
  console.log("Tool:", name);
  if (name === "read_context") return state();
  if (name === "read_history")
    return { items: state().recentMessages, has_more: false };
  if (name === "read_tasks") return { items: [], has_more: false };
  if (name.startsWith("save_")) {
    const kind = name.slice(5);
    if (
      kind === "daily"
        ? !/^\d{4}-\d{2}-\d{2}$/.test(args.document_key)
        : args.document_key !== "core"
    )
      return {
        saved: false,
        error:
          "Use document_key core for preferences/priorities, local ISO date for daily",
      };
    const entry = parseEntry(kind, args.entry);
    assert.ok(entry.source_ids.every((s) => s === source));
    const key = kind + "/" + args.document_key;
    const home = homes[key] || {
      id: randomUUID(),
      kind,
      document_key: args.document_key,
      revision: 0,
      content_json: { entries: [] },
    };
    if (home.revision !== args.expected_revision)
      return { saved: false, error: "Stale revision; use read_context" };
    home.revision++;
    home.content_json.entries = home.content_json.entries
      .filter((e) => e.id !== entry.id)
      .concat(entry);
    homes[key] = home;
    return {
      saved: true,
      home: kind,
      document_id: home.id,
      entry_id: entry.id,
      revision: home.revision,
    };
  }
  if (name === "propose_task") {
    proposed = true;
    return { proposed: true, proposal_id: randomUUID(), status: "pending" };
  }
  if (name === "finish_planning") return { reviewed: true };
  return { error: "Unavailable test tool", saved: false };
}
(async () => {
  try {
    const first = await runHermes({
      userId,
      sessionId,
      turnId: randomUUID(),
      prompt: {
        currentApplicationState: state(),
        request:
          state().recentMessages[0].text +
          " One-time native-session check word: TERRACE-K6. This check word is not a preference or priority; do not save it in app memory.",
      },
      tool,
    });
    console.log("First result:", JSON.stringify(first));
    console.log("Homes:", Object.keys(homes));
    assert.ok(first.reviewed);
    assert.ok(homes["preferences/core"]);
    assert.ok(homes["priorities/core"]);
    assert.ok(Object.keys(homes).some((k) => k.startsWith("daily/")));
    assert.ok(proposed);
    const second = await runHermes({
      userId,
      sessionId,
      turnId: randomUUID(),
      prompt: {
        currentApplicationState: { ...state(), recentMessages: [] },
        request:
          "Also repeat the exact one-time native-session check word from our previous turn. What did I say was ready, what remains, and was the rehearsal task actually applied? Answer from continuing context and app state; do not create duplicate memories or proposals.",
      },
      tool,
    });
    console.log("Continuing result:", JSON.stringify(second));
    assert.match(second.answer, /prototype/i);
    assert.match(second.answer, /TERRACE-K6/);
    assert.match(second.answer, /pending|approval|not.*applied/i);
    const successor = await runHermes({
      userId,
      sessionId: randomUUID(),
      turnId: randomUUID(),
      prompt: {
        currentApplicationState: { ...state(), recentMessages: [] },
        request:
          "New successor: without the old runtime conversation, tell me my communication preference and ongoing priority and why. Use the app memory.",
      },
      tool,
    });
    console.log("Successor result:", JSON.stringify(successor));
    assert.match(successor.answer, /paragraph/i);
    assert.match(successor.answer, /offline/i);
    assert.match(successor.answer, /connect/i);
    fs.writeFileSync(
      path.join(profileRoot, "evidence.json"),
      JSON.stringify({ first, second, successor, homes, calls }, null, 2),
    );
    console.log(
      "PASS: real Hermes tools, persistent native context, and successor app-memory bootstrap",
    );
    console.log("Evidence:", path.join(profileRoot, "evidence.json"));
  } finally {
    fs.rmSync(path.join(profileRoot, userId, "auth.json"), { force: true });
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
