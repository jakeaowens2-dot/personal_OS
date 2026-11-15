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
  constrainPlanningToolsForFlow,
  createPlanningToolHandler,
  restrictMorningTransitionTools,
  PLANNING_TOOLS,
} = require("../src/lib/assistant/tools.ts");
const { hermesPaths } = require("../src/lib/assistant/hermes.ts");
const { withAssistantRun } = require("../src/lib/assistant/turn-runtime.ts");
const { MemorySaver } = require("@langchain/langgraph");
const {
  conversationGraphTestContract,
  loadDailyInitialization,
  runConversationGraph,
} = require("../src/lib/assistant/conversation-graph.ts");
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

test("foreground cancels and awaits carryover before entering the shared runtime", async () => {
  const sequence = [];
  const background = withAssistantRun(id, "catch_up", new AbortController().signal, async (signal) => {
    sequence.push("background");
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    await new Promise((resolve) => setImmediate(resolve));
    sequence.push("background cleaned up");
  });
  await withAssistantRun(id, "message", new AbortController().signal, async () => {
    sequence.push("foreground");
  });
  await background;
  assert.deepEqual(sequence, ["background", "background cleaned up", "foreground"]);
});

test("runtime rejects competing foreground and catchup, isolates users, and releases on failure", async () => {
  await assert.rejects(withAssistantRun(id, "message", new AbortController().signal, async () => {
    for (const kind of ["message", "catch_up"])
      await assert.rejects(withAssistantRun(id, kind, new AbortController().signal, async () => {}), /Another reply/);
    await withAssistantRun(source, "message", new AbortController().signal, async () => {});
    throw new Error("fake failure");
  }), /fake failure/);
  await withAssistantRun(id, "message", new AbortController().signal, async () => {});
});

test("explicit Stop propagates to the runtime and an already stopped request never runs", async () => {
  const stop = new AbortController();
  await withAssistantRun(id, "message", stop.signal, async (signal) => {
    stop.abort();
    assert.equal(signal.aborted, true);
  });
  await assert.rejects(withAssistantRun(id, "message", stop.signal, async () => assert.fail("must not execute")), /abort/i);
});

test("new daily grouping respects Pacific 4am and daylight saving changes", () => {
  assert.equal(localDate(new Date("2026-09-13T10:59:59Z")), "2026-09-12");
  assert.equal(localDate(new Date("2026-09-13T11:00:00Z")), "2026-09-13");
  assert.equal(localDate(new Date("2026-12-13T11:59:59Z")), "2026-12-12");
  assert.equal(localDate(new Date("2026-12-13T12:00:00Z")), "2026-12-13");
});
test("turn input rejects forged context, impossible dates, and invalid provenance IDs", () => {
  assert.equal(parseTurn({ id, kind: "message", text: "Plan today" }).id, id);
  assert.equal(
    parseTurn({
      id,
      kind: "message",
      text: "Let’s begin.",
      morningAction: "begin",
    }).morningAction,
    "begin",
  );
  for (const input of [
    { id, kind: "message", text: "x", user_id: source },
    { id, kind: "closeout", text: "x", reviewDate: "2026-02-30" },
    { id, kind: "message", text: "x", sourceMessageId: "fake" },
    { id, kind: "message", text: "x", morningAction: "skip" },
    {
      id,
      kind: "catch_up",
      text: "x",
      morningAction: "begin",
      reviewDate: "2026-09-11",
    },
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
test("morning focus forwards an ordered mix of canonical tasks and proposal placeholders", async () => {
  const calls = [];
  const handler = createPlanningToolHandler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { saved: true, entries: args.p_entries }, error: null };
      },
    },
    userId: id,
    turnId: id,
    leaseId: source,
    context: async () => ({}),
  });
  const entries = [{ task_id: id }, { proposal_id: source }];
  assert.deepEqual(
    await handler.handle("set_today_focus", {
      entries,
      reason: "The morning agreement selected both items.",
      source_ids: [source],
    }),
    { saved: true, entries },
  );
  assert.equal(calls[0].name, "assistant_set_today_focus_plan");
  assert.deepEqual(calls[0].args.p_entries, entries);
  assert.equal("p_task_ids" in calls[0].args, false);

  const invalid = await handler.handle("set_today_focus", {
    entries: [{ task_id: id, proposal_id: source }],
    reason: "Invalid mixed entry.",
    source_ids: [source],
  });
  assert.equal(invalid.saved, false);
  assert.match(invalid.error, /exactly one task or proposal/i);
});
test("intermediate morning turns can read and finish but cannot write planning state", async () => {
  const calls = [];
  const restricted = restrictMorningTransitionTools(async (name, args) => {
    calls.push({ name, args });
    return { reviewed: name === "finish_planning" };
  });
  assert.deepEqual(await restricted("save_daily", { entry: "no" }), {
    saved: false,
    error: "Morning-opening documentation is deferred until final synthesis.",
  });
  assert.deepEqual(await restricted("propose_task", {}), {
    saved: false,
    error: "Morning-opening documentation is deferred until final synthesis.",
  });
  assert.deepEqual(await restricted("set_today_focus", {}), {
    saved: false,
    error: "Morning-opening documentation is deferred until final synthesis.",
  });
  assert.deepEqual(await restricted("read_context", {}), { reviewed: false });
  assert.deepEqual(await restricted("finish_planning", { reason: "waiting" }), {
    reviewed: true,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["read_context", "finish_planning"],
  );
});
test("only final morning synthesis can write the ordered daily focus", async () => {
  const calls = [];
  const handle = async (name, args) => {
    calls.push({ name, args });
    return { saved: true };
  };
  const args = {
    entries: [{ task_id: id }],
    reason: "The completed ritual selected this work.",
    source_ids: [source],
  };
  assert.deepEqual(
    await constrainPlanningToolsForFlow(handle, "normal")(
      "set_today_focus",
      args,
    ),
    {
      saved: false,
      error: "Today’s focus can be set only by the completed morning synthesis.",
    },
  );
  assert.deepEqual(
    await constrainPlanningToolsForFlow(handle, "morning_synthesis")(
      "set_today_focus",
      args,
    ),
    { saved: true },
  );
  assert.equal(calls.length, 1);
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

function graphEvent(turnId, messageId, text, kind = "message") {
  return { turnId, messageId, text, kind };
}

test("morning-start routing recognizes direct conversational affirmations", () => {
  assert.equal(conversationGraphTestContract.affirmative("Yes"), true);
  assert.equal(
    conversationGraphTestContract.affirmative(
      "I want to go through our morning ritual now",
    ),
    true,
  );
  assert.equal(
    conversationGraphTestContract.affirmative(
      "Please correct the Anthony Sherman task first.",
    ),
    false,
  );
  assert.equal(
    conversationGraphTestContract.affirmative("Yes, but correct the task first"),
    false,
  );
  assert.equal(
    conversationGraphTestContract.affirmative(
      "I want to begin our morning ritual, but first update the report task.",
    ),
    false,
  );
  assert.equal(
    conversationGraphTestContract.decline("No, correct the task first"),
    false,
  );
  assert.equal(
    conversationGraphTestContract.decline(
      "Pause the morning opening for now.",
    ),
    true,
  );
});

test("morning harness preserves the agent response and makes the required question final", () => {
  const question = "What matters most?";
  assert.equal(
    conversationGraphTestContract.withRequiredQuestion(
      `That constraint meaningfully narrows the day.\n\n${question}`,
      question,
    ),
    `That constraint meaningfully narrows the day.\n\n${question}`,
  );
  assert.equal(
    conversationGraphTestContract.withRequiredQuestion(
      "That constraint meaningfully narrows the day.",
      question,
    ),
    `That constraint meaningfully narrows the day.\n\n${question}`,
  );
  assert.equal(
    conversationGraphTestContract.withRequiredQuestion(
      "Good morning. What matters most for you today?",
      question,
    ),
    `Good morning.\n\n${question}`,
  );
});

test("daily graph lets Hermes respond between constrained morning questions", async () => {
  const checkpointer = new MemorySaver();
  const date = "2026-09-26";
  const userId = id;
  const turns = [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003",
    "30000000-0000-4000-8000-000000000004",
  ];
  const messages = [
    "40000000-0000-4000-8000-000000000001",
    "40000000-0000-4000-8000-000000000002",
    "40000000-0000-4000-8000-000000000003",
    "40000000-0000-4000-8000-000000000004",
  ];
  const flows = [];
  let synthesis;
  const dependencies = {
    runAgent: async (event, flow) => {
      flows.push(flow);
      if (flow.purpose === "morning_synthesis") {
        synthesis = flow;
        return { answer: "A shaped day.", reviewed: true };
      }
      assert.equal(flow.purpose, "morning_transition");
      assert.ok(flow.morningTransition?.requiredNextQuestion);
      return {
        answer: `Hermes responded to: ${event.text}`,
        reviewed: true,
      };
    },
  };
  const begin = await runConversationGraph({
    checkpointer,
    userId,
    date,
    event: {
      ...graphEvent(turns[0], messages[0], "Let’s begin the morning opening."),
      morningAction: "begin",
    },
    dependencies,
  });
  assert.equal(begin.phase, "awaiting_available_time");
  assert.match(begin.answer, /How much time/);
  assert.equal(flows.length, 0);

  const time = await runConversationGraph({
    checkpointer,
    userId,
    date,
    event: graphEvent(turns[1], messages[1], "Six hours; appointment at four."),
    dependencies,
  });
  assert.equal(time.phase, "awaiting_brain_dump");
  assert.match(time.answer, /Six hours; appointment at four/);
  assert.match(time.answer, /brain dump/i);
  assert.equal(flows.length, 1);
  assert.ok(time.answer.endsWith(flows[0].morningTransition.requiredNextQuestion));

  const brain = await runConversationGraph({
    checkpointer,
    userId,
    date,
    event: graphEvent(turns[2], messages[2], "Report, outreach, and camera issue."),
    dependencies,
  });
  assert.equal(brain.phase, "awaiting_company_move");
  assert.match(brain.answer, /Report, outreach, and camera issue/);
  assert.match(brain.answer, /company forward/i);
  assert.equal(flows.length, 2);
  assert.ok(
    brain.answer.endsWith(flows[1].morningTransition.requiredNextQuestion),
  );

  const final = await runConversationGraph({
    checkpointer,
    userId,
    date,
    event: graphEvent(turns[3], messages[3], "Finish the report narrative."),
    dependencies,
  });
  assert.equal(final.phase, "complete");
  assert.equal(final.answer, "A shaped day.");
  assert.equal(flows.length, 3);
  assert.equal(synthesis.purpose, "morning_synthesis");
  assert.equal(synthesis.morning.availableTime.sourceMessageId, messages[1]);
  assert.equal(synthesis.morning.brainDump.text, "Report, outreach, and camera issue.");
  assert.equal(synthesis.morning.companyMove.text, "Finish the report narrative.");

  const saved = await loadDailyInitialization({ checkpointer, userId, date });
  assert.deepEqual(saved, {
    phase: "complete",
    availableTimeAnswered: true,
    brainDumpAnswered: true,
    companyMoveAnswered: true,
    completedAt: saved.completedAt,
  });
  assert.ok(saved.completedAt);
});

test("daily graph keeps normal work coarse, offers the opening, and caches retries", async () => {
  const checkpointer = new MemorySaver();
  const event = graphEvent(
    "50000000-0000-4000-8000-000000000001",
    "60000000-0000-4000-8000-000000000001",
    "Correct the Anthony task first.",
  );
  let calls = 0;
  const options = {
    checkpointer,
    userId: id,
    date: "2026-09-27",
    event,
    dependencies: {
      runAgent: async (_event, flow) => {
        calls++;
        assert.equal(flow.purpose, "normal");
        assert.equal(flow.offerMorningOpening, true);
        return { answer: "Corrected. Shall we begin the morning opening?", reviewed: true };
      },
    },
  };
  const first = await runConversationGraph(options);
  const retry = await runConversationGraph(options);
  assert.equal(first.answer, retry.answer);
  assert.equal(retry.resumed, true);
  assert.equal(calls, 1);
});

test("daily graph resumes a failed coarse agent node from its checkpoint", async () => {
  const checkpointer = new MemorySaver();
  const event = graphEvent(
    "70000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000001",
    "Help me reconcile this plan.",
  );
  let attempts = 0;
  const options = {
    checkpointer,
    userId: id,
    date: "2026-09-28",
    event,
    dependencies: {
      runAgent: async () => {
        attempts++;
        if (attempts === 1) throw new Error("Synthetic interruption");
        return { answer: "Resumed safely.", reviewed: true };
      },
    },
  };
  await assert.rejects(runConversationGraph(options), /Synthetic interruption/);
  const resumed = await runConversationGraph(options);
  assert.equal(resumed.answer, "Resumed safely.");
  assert.equal(attempts, 2);
});

test("morning transition resumes after its answer checkpoint without losing the required question", async () => {
  const checkpointer = new MemorySaver();
  const date = "2026-09-28";
  const begin = graphEvent(
    "71000000-0000-4000-8000-000000000001",
    "81000000-0000-4000-8000-000000000001",
    "Let’s begin.",
  );
  const answer = graphEvent(
    "71000000-0000-4000-8000-000000000002",
    "81000000-0000-4000-8000-000000000002",
    "Six hours, with an appointment at four.",
  );
  let attempts = 0;
  const dependencies = {
    runAgent: async (_event, flow) => {
      attempts++;
      assert.equal(flow.purpose, "morning_transition");
      if (attempts === 1) throw new Error("Synthetic morning interruption");
      return { answer: "I’m here with you.", reviewed: true };
    },
  };
  const opened = await runConversationGraph({
    checkpointer,
    userId: id,
    date,
    event: { ...begin, morningAction: "begin" },
    dependencies,
  });
  assert.equal(opened.phase, "awaiting_available_time");
  assert.equal(attempts, 0);
  await assert.rejects(
    runConversationGraph({
      checkpointer,
      userId: id,
      date,
      event: answer,
      dependencies,
    }),
    /Synthetic morning interruption/,
  );
  const resumed = await runConversationGraph({
    checkpointer,
    userId: id,
    date,
    event: answer,
    dependencies,
  });
  assert.equal(resumed.phase, "awaiting_brain_dump");
  assert.match(resumed.answer, /^I’m here with you\./);
  assert.match(resumed.answer, /brain dump/i);
  assert.equal(attempts, 2);
});

test("a failed background catch-up cannot block a new foreground morning turn", async () => {
  const checkpointer = new MemorySaver();
  const date = "2026-09-29";
  const background = graphEvent(
    "72000000-0000-4000-8000-000000000001",
    "82000000-0000-4000-8000-000000000001",
    "Prepare yesterday’s carryover.",
    "catch_up",
  );
  const foreground = graphEvent(
    "72000000-0000-4000-8000-000000000002",
    "82000000-0000-4000-8000-000000000002",
    "Let’s begin.",
  );
  const dependencies = {
    runAgent: async (event, flow) => {
      if (event.kind === "catch_up")
        throw new Error("Synthetic background failure");
      assert.fail(`Foreground button unexpectedly invoked Hermes: ${flow.purpose}`);
    },
  };
  await assert.rejects(
    runConversationGraph({
      checkpointer,
      userId: id,
      date,
      event: background,
      dependencies,
    }),
    /Synthetic background failure/,
  );
  const result = await runConversationGraph({
    checkpointer,
    userId: id,
    date,
    event: { ...foreground, morningAction: "begin" },
    dependencies,
  });
  assert.equal(result.phase, "awaiting_available_time");
  assert.match(result.answer, /How much time do you have available/);
});

test("daily graph can steer a stopped coarse agent node without replaying earlier graph steps", async () => {
  const checkpointer = new MemorySaver();
  const original = graphEvent(
    "90000000-0000-4000-8000-000000000001",
    "a0000000-0000-4000-8000-000000000001",
    "Build a strict schedule for today.",
  );
  let attempts = 0;
  let observedFlow;
  const dependencies = {
    runAgent: async (_event, flow) => {
      attempts++;
      observedFlow = flow;
      if (attempts === 1) throw new Error("Stopped for steering");
      return { answer: "I rebuilt it around flexible priorities.", reviewed: true };
    },
  };
  await assert.rejects(
    runConversationGraph({
      checkpointer,
      userId: id,
      date: "2026-09-29",
      event: original,
      dependencies,
    }),
    /Stopped for steering/,
  );
  const steered = await runConversationGraph({
    checkpointer,
    userId: id,
    date: "2026-09-29",
    event: {
      ...graphEvent(
        "90000000-0000-4000-8000-000000000002",
        "a0000000-0000-4000-8000-000000000002",
        "Keep it broad and resilient to interruptions.",
      ),
      steeringForTurnId: original.turnId,
    },
    dependencies,
  });
  assert.equal(steered.answer, "I rebuilt it around flexible priorities.");
  assert.equal(attempts, 2);
  assert.deepEqual(observedFlow.steering, {
    originalTurnId: original.turnId,
    originalText: original.text,
    direction: "Keep it broad and resilient to interruptions.",
  });
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
 if(${JSON.stringify(mode)}==='progress'){
  if(input.budgets.compression_total_seconds>=input.budgets.run_seconds)process.exit(3);
  send({type:'progress',stage:'context_ready',history_messages:70,snapshots_projected:8,history_chars_before:835983,history_chars_after:55000});
 }
 if(${JSON.stringify(mode)}==='bad-progress'){send({type:'progress',stage:'arbitrary',history_messages:'private data'});return;}
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

test("Hermes accepts content-free replay progress, rejects unknown metadata, and shares bounded budgets", async () => {
  const { runHermes } = require("../src/lib/assistant/hermes.ts");
  await fakeHermes("progress", async () => {
    const result = await runHermes({ userId: id, prompt: { test: true }, tool: async () => ({ reviewed: true }) });
    assert.equal(result.answer, "Use the saved plan.");
  });
  await fakeHermes("bad-progress", async () => {
    await assert.rejects(runHermes({ userId: id, prompt: { test: true } }), /invalid progress metadata/);
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

test("status is one current narrative and task history summarizes real revisions", () => {
  const { proposalStatusSummary, taskRevisionSummary } = require("../src/lib/assistant/proposal-presentation.ts");
  const proposal = { status: "applied", before_json: { human_summary: "Not started" }, patch_json: { human_summary: "Pipeline work is underway; report not delivered." } };
  assert.equal(proposalStatusSummary(proposal), "Pipeline work is underway; report not delivered.");
  assert.equal(proposalStatusSummary({ ...proposal, status: "rejected" }), "Not started");
  assert.equal(taskRevisionSummary(null, { title: "Report" }), "Created: Report.");
  assert.match(taskRevisionSummary({ status: "open", human_summary: "Not started" }, { status: "in_progress", human_summary: "Pipeline underway" }), /Marked in progress · Progress: Pipeline underway/);
  assert.ok(taskRevisionSummary({ human_summary: "Old" }, { human_summary: "a".repeat(700) }).length < 200);
});
