const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
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
const {
  localDate,
  parseTurn,
  parseEntry,
  parseTaskPatch,
} = require("../src/lib/assistant/state.ts");
const {
  operationId,
  createPlanningToolHandler,
  PLANNING_TOOLS,
} = require("../src/lib/assistant/tools.ts");
const { hermesPaths } = require("../src/lib/assistant/hermes.ts");
const id = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const entry = {
  id,
  text: "A priority worth preserving",
  source_ids: [source],
  origin: "user_stated",
  state: "active",
  title: "Offline demo",
  rationale: "Unreliable venue connectivity",
};

test("daily grouping respects Central midnight and daylight saving changes", () => {
  assert.equal(localDate(new Date("2026-09-13T04:59:59Z")), "2026-09-12");
  assert.equal(localDate(new Date("2026-09-13T05:00:00Z")), "2026-09-13");
  assert.equal(localDate(new Date("2026-12-13T05:59:59Z")), "2026-12-12");
  assert.equal(localDate(new Date("2026-12-13T06:00:00Z")), "2026-12-13");
});
test("turn input rejects forged context, impossible dates, and invalid provenance IDs", () => {
  assert.equal(parseTurn({ id, kind: "message", text: "Plan today" }).id, id);
  for (const input of [
    { id, kind: "message", text: "x", user_id: source },
    { id, kind: "closeout", text: "x", reviewDate: "2026-02-30" },
    { id, kind: "message", text: "x", sourceMessageId: "fake" },
  ])
    assert.throws(() => parseTurn(input));
});
test("memory homes enforce provenance, inference labels, shape, and carry-forward reasons", () => {
  assert.deepEqual(parseEntry("priorities", entry), entry);
  for (const bad of [
    { ...entry, source_ids: [] },
    { ...entry, user_id: id },
    { ...entry, origin: "certain" },
    { ...entry, title: null },
  ])
    assert.throws(() => parseEntry("priorities", bad));
  assert.throws(() =>
    parseEntry("daily", {
      id,
      text: "Unresolved",
      source_ids: [source],
      disposition: "uncertain",
      rationale: "",
    }),
  );
  assert.equal(
    parseEntry("daily", {
      id,
      text: "Unresolved",
      source_ids: [source],
      disposition: "uncertain",
      rationale: "Need to confirm timing",
    }).disposition,
    "uncertain",
  );
});
test("task proposals cannot change arbitrary fields or bypass review", () => {
  assert.deepEqual(
    parseTaskPatch({
      status: "completed",
      human_summary: "The rehearsal passed",
    }),
    { status: "completed", human_summary: "The rehearsal passed" },
  );
  for (const input of [
    {},
    { user_id: id },
    { completed_at: "today" },
    { status: "archived" },
    { priority: "urgent" },
  ])
    assert.throws(() => parseTaskPatch(input));
  assert.equal(
    PLANNING_TOOLS.some((t) =>
      /approve|resolve|execute|shell|terminal/.test(t.name),
    ),
    false,
  );
});
test("retry operations are stable under key order and change when payload changes", () => {
  assert.equal(
    operationId(id, "save_daily", { a: 1, b: 2 }),
    operationId(id, "save_daily", { b: 2, a: 1 }),
  );
  assert.notEqual(
    operationId(id, "save_daily", { a: 1 }),
    operationId(id, "save_daily", { a: 2 }),
  );
});
test("tool router derives ownership server-side and returns errors without fake save receipts", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: null, error: { message: "Memory changed" } };
    },
  };
  const handler = createPlanningToolHandler({
    client,
    userId: id,
    turnId: id,
    leaseId: source,
    context: async () => ({}),
  });
  const result = await handler.handle("save_priorities", {
    document_key: "core",
    expected_revision: 0,
    entry,
    reason: "User direction",
  });
  assert.equal(result.saved, false);
  assert.match(result.error, /Memory changed/);
  assert.equal(calls[0].args.p_turn, id);
  assert.equal("user_id" in calls[0].args, false);
  assert.equal(handler.isReviewed(), false);
  assert.equal(
    (await handler.handle("finish_planning", { reason: "Pretend done" })).saved,
    false,
  );
  assert.equal((await handler.handle("approve_task", {})).saved, false);
  assert.equal(
    (await handler.handle("save_priorities", { user_id: source })).saved,
    false,
  );
});
test("review publication is bound to the requested date and must happen before completion", async () => {
  const handler = createPlanningToolHandler({
    client: { rpc: async () => ({ data: { saved: true }, error: null }) },
    userId: id,
    turnId: id,
    leaseId: source,
    reviewDate: "2026-09-11",
    reviewOrigin: "catch_up",
    context: async () => ({}),
  });
  assert.equal(
    (await handler.handle("finish_planning", { reason: "Done" })).saved,
    false,
  );
  const other = createPlanningToolHandler({
    client: { rpc: async () => ({ data: { saved: true }, error: null }) },
    userId: id,
    turnId: id,
    leaseId: source,
    reviewDate: "2026-09-11",
    reviewOrigin: "catch_up",
    context: async () => ({}),
  });
  assert.equal(
    (
      await other.handle("publish_review", {
        date: "2026-09-10",
        expected_revision: 2,
      })
    ).saved,
    false,
  );
  assert.equal(
    (
      await handler.handle("publish_review", {
        date: "2026-09-11",
        expected_revision: 2,
      })
    ).saved,
    true,
  );
  assert.equal(
    (
      await handler.handle("finish_planning", {
        reason: "All dispositions reviewed",
      })
    ).reviewed,
    true,
  );
});
test("runtime profiles are scoped to authenticated user IDs and cannot traverse paths", () => {
  assert.match(hermesPaths(id).profile, new RegExp(id + "$"));
  assert.throws(() => hermesPaths("../../.hermes"));
});

async function fakeHermes(mode, work) {
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "personal-os-hermes-fake-"),
  );
  fs.mkdirSync(path.join(directory, "venv/bin"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "venv/bin/python"),
    `#!/usr/bin/env node
const lines=require('node:readline').createInterface({input:process.stdin});let started=false;
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
lines.on('line',line=>{const input=JSON.parse(line);if(!started){started=true;
 if(${JSON.stringify(mode)}==='wait')return;
 if(${JSON.stringify(mode)}==='empty'){process.exit(0);return;}
 if(${JSON.stringify(mode)}==='failure'){send({type:'error',error:'Synthetic model failure',error_type:'TestError',location:[]});process.exit(1);return;}
 send({type:'tool',id:'1',name:${JSON.stringify(mode === "forbidden" ? "terminal" : "finish_planning")},args:{reason:'No change needed'}});
}else{send({type:'done',answer:'Use the saved plan.',reviewed:true,connection:{auth:'chatgpt',model:'test',runtime:'hermes'}});process.exit(0);}});
`,
    { mode: 0o700 },
  );
  const prior = process.env.PERSONAL_ASSISTANT_HERMES_INSTALL;
  process.env.PERSONAL_ASSISTANT_HERMES_INSTALL = directory;
  try {
    await work();
  } finally {
    if (prior === undefined)
      delete process.env.PERSONAL_ASSISTANT_HERMES_INSTALL;
    else process.env.PERSONAL_ASSISTANT_HERMES_INSTALL = prior;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
test("Hermes transport waits for actual completion and permits only registered app tools", async () => {
  const { runHermes } = require("../src/lib/assistant/hermes.ts");
  let invoked = 0;
  await fakeHermes("success", async () => {
    const result = await runHermes({
      userId: id,
      sessionId: id,
      turnId: source,
      prompt: { test: true },
      tool: async (name) => {
        assert.equal(name, "finish_planning");
        invoked++;
        return { reviewed: true };
      },
    });
    assert.equal(result.answer, "Use the saved plan.");
  });
  assert.equal(invoked, 1);
  await fakeHermes("forbidden", async () => {
    await assert.rejects(
      runHermes({
        userId: id,
        sessionId: id,
        turnId: source,
        prompt: { test: true },
        tool: async () => {
          invoked++;
          return {};
        },
      }),
      /allowlist/,
    );
  });
  assert.equal(invoked, 1);
});
test("Hermes exit zero is not proof of success; errors and cancellation stay failures", async () => {
  const { runHermes } = require("../src/lib/assistant/hermes.ts");
  await fakeHermes("empty", async () =>
    assert.rejects(
      runHermes({ userId: id, prompt: { test: true } }),
      /without a completed/,
    ),
  );
  await fakeHermes("failure", async () =>
    assert.rejects(
      runHermes({ userId: id, prompt: { test: true } }),
      /Synthetic model failure/,
    ),
  );
  await fakeHermes("wait", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(
        runHermes({
          userId: id,
          prompt: { test: true },
          signal: controller.signal,
        }),
        /stopped/,
      );
    } finally {
      clearTimeout(timer);
    }
  });
});

test("proposal cards present the proposed snapshot without inventing dependency links", () => {
  const { proposalPresentation } = require("../src/lib/assistant/proposal-presentation.ts");
  const base = { before_json: null, patch_json: { title: "Create case study", human_summary: "After the report is delivered, adapt it for marketing." } };
  const created = proposalPresentation(base);
  assert.equal(created.title, "Create case study");
  assert.equal(created.priority, "medium");
  assert.deepEqual(created.dependencies, []);
  const changed = proposalPresentation({
    before_json: { title: "Old title", priority: "low", status: "open", human_summary: "Previous progress", agent_payload_json: { dependencies: ["Deliver report", ""] } },
    patch_json: { title: "New title", priority: "high", status: "completed", human_summary: "Delivered" },
  });
  assert.equal(changed.title, "New title");
  assert.equal(changed.previousTitle, "Old title");
  assert.equal(changed.priority, "high");
  assert.equal(changed.previousPriority, "low");
  assert.equal(changed.description, "Delivered");
  assert.equal(changed.previousProgress, "Previous progress");
  assert.deepEqual(changed.dependencies, []);
  assert.deepEqual(changed.dependencyNotes, ["Deliver report"]);
  assert.equal(changed.status, "completed");
  const cleared = proposalPresentation({ before_json: { title: "Task", human_summary: "Outdated" }, patch_json: { human_summary: "" } });
  assert.equal(cleared.description, "");
});


test("descriptions, progress and prerequisite replacements retain distinct semantics", () => {
  const { proposalPresentation } = require("../src/lib/assistant/proposal-presentation.ts");
  assert.deepEqual(parseTaskPatch({ description: "", prerequisite_task_ids: [] }), { description: "", prerequisite_task_ids: [] });
  for (const patch of [{ description: null }, { description: "x".repeat(6001) }, { prerequisite_task_ids: ["not-a-task"] }, { prerequisite_task_ids: [id, id] }, { prerequisite_task_ids: null }]) assert.throws(() => parseTaskPatch(patch));
  const view = proposalPresentation({ before_json: { title: "Case study", description: "Original purpose", human_summary: "Not started" }, patch_json: { description: "Sales-ready case study", human_summary: "Draft started", prerequisite_task_ids: [id] }, prerequisite_snapshot_json: [{ id, title: "Deliver report", status: "completed" }] });
  assert.equal(view.description, "Sales-ready case study");
  assert.equal(view.progress, "Draft started");
  assert.equal(view.previousDescription, "Original purpose");
  assert.equal(view.previousProgress, "Not started");
  assert.deepEqual(view.dependencies, ["Deliver report · completed"]);
});
