// Opt-in live Hermes evaluation using a read-only exported plan copy.
// The test has no Supabase client or database credentials and never changes real app state.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { runHermes } = require('../src/lib/assistant/hermes.ts');
const { parseTaskPatch, parseEntry, localDate } = require('../src/lib/assistant/state.ts');
const snapshotPath = process.argv[2];
assert.ok(snapshotPath, 'Provide a private, read-only snapshot JSON path.');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-os-plan-replay-'));
process.env.PERSONAL_ASSISTANT_RUNTIME_HOME = testHome;
const userId = randomUUID(), sessionId = randomUUID();
const homes = structuredClone(snapshot.memoryHomes), tasks = structuredClone(snapshot.tasks), messages = structuredClone(snapshot.recentMessages);
const proposals = [], calls = [], results = [];
const report = tasks.find((t) => /deliver.*report/i.test(t.title));
const caseStudy = tasks.find((t) => /case study/i.test(t.title));
assert.ok(report && caseStudy);
const canonicalBefore = JSON.stringify(tasks);
const state = () => ({ schemaVersion: 1, date: localDate(), timeZone: 'America/Chicago', memoryHomes: homes, preferences: homes.filter((d) => d.kind === 'preferences'), priorities: homes.filter((d) => d.kind === 'priorities'), dailyNotes: homes.filter((d) => d.kind === 'daily'), tasks, recentMessages: messages.slice(-12), pendingProposals: proposals });
async function tool(name, args) {
  calls.push({ name, args });
  console.log('Tool:', name);
  if (name === 'read_context') return state();
  if (name === 'read_memory') return { document: homes.find((d) => d.kind === args.kind && d.document_key === args.document_key) ?? null };
  if (name === 'read_history') return { items: messages.filter((m) => !args.source_ids || args.source_ids.includes(m.id)), has_more: false };
  if (name === 'read_tasks') return { items: tasks.filter((t) => (!args.task_ids || args.task_ids.includes(t.id)) && (!args.query || t.title.toLowerCase().includes(args.query.toLowerCase()))), has_more: false };
  if (name.startsWith('save_')) {
    const kind = name.slice(5), entry = parseEntry(kind, args.entry);
    assert.ok(entry.source_ids.every((id) => messages.some((m) => m.id === id)), 'Unrecognized source');
    let home = homes.find((d) => d.kind === kind && d.document_key === args.document_key);
    if (!home) { home = { id: randomUUID(), kind, document_key: args.document_key, revision: 0, content_json: { entries: [] } }; homes.push(home); }
    if (home.revision !== args.expected_revision) return { saved: false, error: 'Stale revision; read_context first' };
    home.content_json.entries = home.content_json.entries.filter((e) => e.id !== entry.id).concat(entry);
    home.revision++;
    return { saved: true, document_id: home.id, entry_id: entry.id, revision: home.revision };
  }
  if (name === 'propose_task') {
    const patch = parseTaskPatch(args.patch), task = tasks.find((t) => t.id === args.task_id);
    assert.ok(task, 'This test should update existing tasks');
    assert.equal(args.expected_updated_at, task.updated_at);
    assert.ok(args.source_ids.every((id) => messages.some((m) => m.id === id)));
    assert.ok((patch.prerequisite_task_ids ?? []).every((id) => tasks.some((t) => t.id === id)));
    const p = { id: randomUUID(), task_id: task.id, patch_json: patch, before_json: task, status: 'pending', source_ids: args.source_ids };
    proposals.push(p);
    return { proposed: true, proposal_id: p.id, status: 'pending' };
  }
  if (name === 'finish_planning') return { reviewed: true, task_changes_require_user_approval: true };
  throw new Error(`Unexpected test tool ${name}`);
}
async function turn(request, newSession = false) {
  const message = { id: randomUUID(), role: 'user', text: request, local_date: localDate(), created_at: new Date().toISOString() };
  messages.push(message);
  const result = await runHermes({ userId, sessionId: newSession ? randomUUID() : sessionId, turnId: randomUUID(), prompt: { currentApplicationState: newSession ? { ...state(), recentMessages: [message] } : state(), request }, tool });
  assert.ok(result.reviewed);
  results.push(result);
  messages.push({ id: randomUUID(), role: 'assistant', text: result.answer });
  fs.writeFileSync(path.join(testHome, 'evidence.json'), JSON.stringify({ results, calls, homes, proposals }, null, 2), { mode: 0o600 });
  console.log('Result:', result.answer);
  return result.answer;
}
(async () => {
  try {
    const recalled = await turn('Read-only recall check: what is my first priority, what follows it and why, and what are the three daily outreach quantities? Distinguish confirmed facts from assumptions about weekdays. Do not create or change tasks or memory for this check.');
    assert.match(recalled, /report/i); assert.match(recalled, /case study/i); assert.match(recalled, /sales|marketing/i); assert.match(recalled, /5|five/i);
    assert.equal(calls.filter((c) => c.name.startsWith('save_') || c.name === 'propose_task').length, 0);
    await turn('Isolated evaluation scenario: treat this message as a simulated user update in this test copy only. Correction to the suggested case-study format: its first deliverable must be a two-page sales PDF, not a website article. The report draft is ready but has NOT been sent. Record this correction and progress in working memory. Propose updating the existing case study description and linking it to report delivery as its prerequisite. Also propose the report as in_progress with a precise progress note. Keep the 5/5/5 outreach targets unchanged; weekday versus seven-day cadence remains unresolved.');
    const casePatch = proposals.find((p) => p.task_id === caseStudy.id && p.patch_json.description)?.patch_json;
    assert.ok(casePatch); assert.match(casePatch.description, /PDF/i); assert.deepEqual(casePatch.prerequisite_task_ids, [report.id]);
    const reportPatch = proposals.find((p) => p.task_id === report.id && p.patch_json.status === 'in_progress')?.patch_json;
    assert.ok(reportPatch); assert.match(reportPatch.human_summary, /not.*sent|unsent|send|delivery.*pending/i);
    assert.equal(JSON.stringify(tasks), canonicalBefore, 'Proposals must not mutate canonical tasks');
    assert.match(JSON.stringify(homes), /PDF/i);
    const recovered = await turn('You are a fresh successor without the prior conversation. From current app memory, what was corrected about the case study deliverable, what report progress was reported, and have those task changes actually been accepted? Do not save new state.', true);
    assert.match(recovered, /PDF/i); assert.match(recovered, /not.*sent|unsent|not.*delivered|delivery.*pending/i); assert.match(recovered, /pending|await|not.*accept|not.*applied/i);
    console.log('PASS: saved-plan recall, correction, progress, reviewed description/prerequisite proposals, and fresh-session recovery.');
    console.log('Evidence:', path.join(testHome, 'evidence.json'));
  } finally {
    fs.rmSync(path.join(testHome, userId, 'auth.json'), { force: true });
  }
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
