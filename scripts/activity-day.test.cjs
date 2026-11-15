const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(__dirname, "../src", name.slice(2)) : name, ...args);
};
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { wakingDateKey, recordDateKey, pacificWallTime } = require("../src/lib/activity-day.ts");
const { getDayOffsetFromTimestamp, getTimestampForDayOffset } = require("../src/lib/dates.ts");
const { createLocalCompletionArtifacts } = require("../src/lib/ledger.ts");
const { createManualWorkArtifactIds, persistManualWorkBlock, persistWorkBlockAttributions } = require("../src/lib/workspace.ts");
const { buildWeeklyEconomyDays, ledgerEventsToSettlementEvents } = require("../src/lib/economy.ts");

test("4am Pacific cutoff is independent of server timezone and handles both DST transitions", () => {
  for (const [before, at, prior, next] of [
    ["2026-11-16T11:59:59.999Z", "2026-11-16T12:00:00Z", "2026-11-15", "2026-11-16"],
    ["2026-07-20T10:59:59.999Z", "2026-07-20T11:00:00Z", "2026-07-19", "2026-07-20"],
    ["2026-03-08T10:59:59.999Z", "2026-03-08T11:00:00Z", "2026-03-07", "2026-03-08"],
    ["2026-11-01T11:59:59.999Z", "2026-11-01T12:00:00Z", "2026-10-31", "2026-11-01"],
  ]) {
    assert.equal(wakingDateKey(before), prior);
    assert.equal(wakingDateKey(at), next);
  }
});
test("legacy activity never gets reinterpreted under the new cutoff", () => {
  const at = "2026-11-16T10:00:00Z";
  assert.equal(recordDateKey(at), "2026-11-16");
  assert.equal(recordDateKey(at, null), "2026-11-16");
  assert.equal(recordDateKey(at, "2026-11-15"), "2026-11-15");
});
test("manual Today/Yesterday before 4am maps to the selected waking day with real timestamps", () => {
  const now = new Date("2026-11-16T10:30:00Z");
  assert.equal(getTimestampForDayOffset(0, undefined, undefined, now), now.toISOString());
  const yesterday = getTimestampForDayOffset(-1, undefined, undefined, now);
  assert.equal(yesterday, "2026-11-15T10:30:00.000Z");
  assert.equal(wakingDateKey(yesterday), "2026-11-14");
});
test("historical duration/note/attribution edits preserve original completion timestamp", () => {
  const now = new Date("2026-11-16T10:30:00Z");
  const old = "2026-11-14T10:30:00+00:00";
  const offset = getDayOffsetFromTimestamp(old, null, now);
  assert.equal(offset, -1);
  assert.equal(getTimestampForDayOffset(offset, old, null, now), old);
  const modern = "2026-11-16T10:30:00Z";
  assert.equal(getTimestampForDayOffset(0, modern, "2026-11-15", now), modern);
});
test("an explicit historical date move changes day without changing clock or duration", () => {
  const now = new Date("2026-11-16T10:30:00Z");
  const moved = getTimestampForDayOffset(0, "2026-11-14T10:30:00Z", null, now);
  assert.equal(moved, now.toISOString());
  assert.equal(wakingDateKey(moved), "2026-11-15");
});
test("natural work retains real end/start instants and one coherent persisted activity day", () => {
  const end = new Date("2026-11-16T10:30:00Z");
  const result = createLocalCompletionArtifacts({ completedAt: end, mode: "work", durationMinutes: 75 });
  assert.equal(result.workBlock.activity_date, "2026-11-15");
  assert.equal(result.ledgerEvent.activity_date, "2026-11-15");
  assert.equal(result.workBlock.earned_at, end.toISOString());
  assert.equal(result.timerSession.ended_at, end.toISOString());
  assert.equal(Date.parse(result.timerSession.ended_at) - Date.parse(result.timerSession.started_at), 75 * 60_000);
  assert.equal(result.ledgerEvent.metadata.work_block_id, result.workBlock.id);
});
test("manual work persists the same day and work-block link in both artifacts", async () => {
  const writes = {};
  const client = { from: (table) => ({ upsert: async (row) => { writes[table] = row; return { error: null }; } }) };
  const result = await persistManualWorkBlock(client, { completedAt: "2026-11-16T10:30:00Z", durationMinutes: 50, userId: "user" });
  assert.equal(writes.work_blocks.activity_date, "2026-11-15");
  assert.equal(writes.ledger_events.activity_date, "2026-11-15");
  assert.equal(writes.ledger_events.metadata.work_block_id, result.workBlock.id);
  assert.equal(writes.work_blocks.duration_minutes, 50);
});
test("weekly attribution moves only new labels; historical reward settlement is unchanged", () => {
  const end = new Date("2026-11-16T10:30:00Z");
  const modern = createLocalCompletionArtifacts({ completedAt: end, mode: "work", durationMinutes: 50 });
  const legacy = { ...modern.workBlock, id: "legacy", activity_date: null };
  const oldLedger = { ...modern.ledgerEvent, id: "old-ledger", activity_date: null };
  const before = ledgerEventsToSettlementEvents([oldLedger]);
  const week = buildWeeklyEconomyDays({ weekStart: pacificWallTime("2026-11-09"), behaviorEvents: [],
    workBlocks: [modern.workBlock, legacy], ledgerEvents: [modern.ledgerEvent, oldLedger] });
  assert.equal(week[6].workMinutes, 50, "new Sunday waking-day record remains on Sunday");
  assert.equal(week.reduce((sum, day) => sum + day.workMinutes, 0), 50, "old Monday record does not move into Sunday");
  assert.deepEqual(ledgerEventsToSettlementEvents([oldLedger]), before);
});

test("manual retries reuse work/session/ledger IDs without duplicating credit", async () => {
  const tables = new Map();
  const client = { from: (table) => ({ upsert: async (row) => {
    if (!tables.has(table)) tables.set(table, new Map());
    tables.get(table).set(row.id, row);
    return { error: null };
  } }) };
  const input = { artifactIds: createManualWorkArtifactIds(), completedAt: "2026-11-16T10:30:00Z", durationMinutes: 50, userId: "user" };
  await persistManualWorkBlock(client, input);
  await persistManualWorkBlock(client, input);
  for (const table of ["work_blocks", "ledger_events", "timer_sessions"]) assert.equal(tables.get(table).size, 1);
});

test("attribution retries reuse IDs and keep the existing waking-day ledger label", async () => {
  const rows = new Map();
  const query = { eq: () => query, is: async () => ({ error: null }) };
  const client = { from: () => ({ upsert: async (items) => { items.forEach(row => rows.set(row.id, row)); return { error: null }; }, update: () => query }) };
  const input = { attributionIds: ["attr-a", "attr-b"], durationMinutes: 75,
    ledgerEvent: { id: "ledger", activity_date: "2026-11-15", created_at: "2026-11-16T10:30:00Z", metadata: {} },
    selections: [{ taskId: "task-a", label: "A" }, { taskId: "task-b", label: "B" }], userId: "user", workBlockId: "work" };
  await persistWorkBlockAttributions(client, input);
  const result = await persistWorkBlockAttributions(client, input);
  assert.equal(rows.size, 2);
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.attributed_minutes, 0), 75);
  assert.equal(result.ledgerEvent.activity_date, "2026-11-15");
  assert.ok([...rows.values()].every(row => row.work_block_id === "work" && row.created_at === input.ledgerEvent.created_at));
});
