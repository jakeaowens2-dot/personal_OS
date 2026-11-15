const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { selectLibraryTasks, buildTaskLibraryReview, fetchTaskLibrary } = require("../src/lib/task-library.ts");
const { fetchTasks } = require("../src/lib/tasks.ts");
const now = new Date("2026-10-27T20:00:00Z");
const old = "2026-08-01T12:00:00Z";
const recent = "2026-10-26T12:00:00Z";
const make = (id, values = {}) => ({ id, title: id, status: "open", source: "manual", priority: "medium", created_at: old,
  updated_at: old, completed_at: null, last_used_at: null, agent_payload_json: {}, ...values });

test("picker ranks actual usage and creation, not stale priority or editing timestamps", () => {
  const tasks = [make("old", { priority: "critical", updated_at: recent }),
    make("new", { created_at: "2026-10-27T10:00:00Z" }), make("used", { last_used_at: recent })];
  assert.deepEqual(selectLibraryTasks(tasks).map(t => t.id), ["new", "used", "old"]);
  assert.deepEqual(selectLibraryTasks(tasks, { sort: "last_used" }).map(t => t.id), ["used", "new", "old"]);
  assert.deepEqual(selectLibraryTasks(tasks, { sort: "newest" }).map(t => t.id), ["new", "old", "used"]);
  assert.equal(tasks[0].id, "old", "must not mutate canonical ordering");
});
test("search covers old tasks; completed is opt-in; archived and housekeeping never bloat picker", () => {
  const tasks = [make("Old target"), make("done", { status: "completed" }), make("archive", { status: "archived" }),
    make("chores", { source: "system_housekeeping" })];
  assert.deepEqual(selectLibraryTasks(tasks, { query: " TARGET " }).map(t => t.id), ["Old target"]);
  assert.equal(selectLibraryTasks(tasks).length, 1);
  assert.equal(selectLibraryTasks(tasks, { includeCompleted: true }).length, 2);
});
test("full-library review bounds the oldest batch; inactivity never means completed", () => {
  const tasks = Array.from({ length: 70 }, (_, index) => make(`task-${index}`, { updated_at: recent }));
  tasks.push(make("oldest", { created_at: "2026-07-01T12:00:00Z", updated_at: "2026-07-01T12:00:00Z" }),
    make("done", { status: "completed" }), make("other"), make("extra"));
  const review = buildTaskLibraryReview(tasks, { now });
  assert.equal(review.scannedCount, 74);
  assert.equal(review.candidateCount, 4);
  assert.equal(review.hasMore, true);
  assert.equal(review.candidates.length, 3);
  assert.equal(review.candidates[0].reason, "completed_history");
  assert.equal(review.candidates[1].task.id, "oldest");
  assert.equal(review.candidates[1].task.status, "open");
});
test("recent work, focus, prerequisites, pending and unchanged rejected decisions are protected", () => {
  const tasks = [make("used", { last_used_at: recent }), make("focus"), make("parent"), make("prerequisite"),
    make("child", { parent_task_id: "parent", agent_payload_json: { prerequisite_task_ids: ["prerequisite"] } }),
    make("pending"), make("rejected"), make("changed", { updated_at: "2026-08-02T12:00:00Z" }),
    make("chores", { source: "system_housekeeping" })];
  const review = buildTaskLibraryReview(tasks, { now, protectedTaskIds: ["focus", "child"], decisions: [
    { task_id: "pending", status: "pending" },
    { task_id: "rejected", status: "rejected", expected_updated_at: "2026-08-01T12:00:00+00:00" },
    { task_id: "changed", status: "rejected", expected_updated_at: old },
  ] });
  assert.deepEqual(review.candidates.map(c => c.task.id), ["changed"]);
});
test("completed history waits seven days; active backlog waits thirty; future dates stay protected", () => {
  const tasks = [make("recent completed", { status: "completed", completed_at: recent }),
    make("29 days", { updated_at: "2026-09-28T20:00:00Z" }),
    make("future", { last_used_at: "2026-11-01T00:00:00Z" }), make("eligible")];
  assert.deepEqual(buildTaskLibraryReview(tasks, { now }).candidates.map(c => c.task.id), ["eligible"]);
});
test("canonical task reads page past Supabase's 1000-row response cap", async () => {
  const ranges = [];
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, neq: () => query, order: () => query,
      range: async (start, end) => { ranges.push([start, end]); return { data: start === 0
        ? Array.from({ length: 1000 }, (_, i) => make(String(i))) : [make("oldest-1001")], error: null }; } };
    return query;
  } };
  assert.equal((await fetchTasks(client, "owner")).length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});
test("failed usage lookup is reported, never quietly treated as no activity", async () => {
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, neq: () => query, order: () => query,
      range: async () => ({ data: [], error: null }) };
    return query;
  }, rpc: () => { const query = { order: () => query, range: async () => ({ error: { message: "offline" } }) }; return query; } };
  await assert.rejects(fetchTaskLibrary(client, "owner"), /Task activity unavailable: offline/);
});
