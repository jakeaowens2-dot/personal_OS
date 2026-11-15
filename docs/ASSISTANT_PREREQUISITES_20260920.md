# Reviewed descriptions and prerequisites — 2026-09-20

Status: implemented locally; additive Supabase migration activated and verified.

## Contract

- `propose_task.patch.description` writes the canonical task description. Empty
  text explicitly clears it. `human_summary` remains a distinct progress note.
- `prerequisite_task_ids` replaces the task's prerequisite list. It contains at
  most 30 unique existing task UUIDs; `[]` explicitly removes the links. The list
  lives in `tasks.agent_payload_json.prerequisite_task_ids`, preserving other keys.
- Existing `agent_payload_json.dependencies` strings remain legacy free-text notes.
  They are displayed separately and never interpreted as task IDs.
- Proposed prerequisites must be owned, available, non-archived tasks. Self-links,
  duplicate IDs and transitive cycles are rejected. A task prerequisite means its
  completion is needed before the dependent task; it does not automatically set
  status, claim completion, or stop a human from recording progress.
- A new task cannot link to another unaccepted proposal. Accept the prerequisite
  task first, then propose its canonical ID as the dependent task's prerequisite.
- The proposal stores a server-generated snapshot of prerequisite IDs, titles,
  statuses and update timestamps. Acceptance revalidates the graph and snapshot;
  a changed prerequisite or target task requires a fresh proposal. Failures leave
  the proposal pending and mutate nothing. Repeated acceptance is idempotent.
- Per-user transaction locks serialize approved link changes. A task trigger also
  validates direct task-vault JSON link edits. Existing free-text notes are not
  migrated. Later archival/deletion is not automatically reconciled into other
  tasks: a missing/archived prerequisite needs explicit review, never an inference
  that it was completed. General dependency scheduling is outside this window.
- Reviewed writes retain existing task revisions, ownership policies and the
  authenticated user approval boundary. No agent auto-approval was added.

## UI

Cards use a 28% surface-color fill over the page background. Removed the rationale
accordion and routine status line. Only an actual proposed status/priority change
shows its before/after values. Description, progress and prerequisite names remain
separate. Accepted/rejected cards collapse; prior descriptive/progress content is
shown when relevant to a correction. Stored rationale remains in the audit record.

## Verification

- TypeScript, lint and 20 assistant tests passed.
- Full SQL acceptance suite passed against isolated PostgreSQL 18.3 through PGlite
  0.5.8. Docker's daemon was unavailable (EOF/hung startup), so it was not counted
  as a successful PostgreSQL 17 run. The fallback package was installed under
  `/private/tmp`; no application dependency changed.
- SQL tests cover description/link creation and clearing, approval/rejection,
  exact-once revisions, preserving unrelated payload keys, invalid/duplicate/self/
  foreign references, cycles and stale prerequisite snapshots, alongside existing
  source ownership, RLS, stale target, lease, retry and carry-forward checks.
  The fallback is single-session: it does not prove simultaneous-writer behavior.
- Inspected the real signed-in expanded cards in the browser: no rationale/status
  clutter and visibly lower-contrast fill. Proposal display tests cover separate
  description/progress and human-readable prerequisite snapshots.

## Live Hermes replay using the saved plan

Read-only export contained the actual two memory homes and three accepted tasks.
The export was copied into an isolated temporary runtime profile; the evaluation
had no database client and no ability to write real user records.

1. **Recall:** recovered the report as first priority, the case study that follows,
   its sales/marketing rationale and all three 5/5/5 outreach targets. Explicitly
   identified weekdays-only as an earlier assumption rather than user confirmation.
2. **Simulated correction/progress:** in the test copy only, specified a two-page
   sales PDF and reported the report draft ready but unsent. Hermes saved a daily
   entry, proposed the canonical description plus report prerequisite, and proposed
   report `in_progress` with a precise progress note. Canonical task copies stayed
   unchanged pending approval. Outreach cadence remained unresolved.
3. **Fresh session:** with previous conversation excluded from the supplied packet,
   recovered the PDF correction and unsent report progress from working state. It
   correctly distinguished reported progress from still-open canonical tasks and
   said both proposals remained pending. No task acceptance was claimed.

All assertions passed. This demonstrates the live model/adapter behavior with
isolated storage; SQL tests separately establish durable approval behavior. It
is not a completed real-user closeout/opening cycle. None of the simulated PDF or
report-progress facts were written to the real account.

Reproduce with `node scripts/assistant-plan-replay.cjs /absolute/private/snapshot.json`.
The snapshot has `memoryHomes`, `tasks` and `recentMessages` arrays. This opt-in test
uses the subscription. It writes private evidence in a temporary directory and
removes its copied runtime authentication on exit.

## Activation receipt

Applied `20260921000000_assistant_task_prerequisites.sql` through the configured
session pooler after matching its project to the app's public Supabase URL.
SQL SHA-256 (trailing whitespace excluded): `5519c1bc5dfc2b20ebee3ff1824daef282aee5bb0b39096ec755f3288483cc76`.
The migration committed atomically. Verified the new trigger, RLS, authenticated-only
review RPC grants and private helper permissions. Task, task-revision, memory-revision
and proposal counts were unchanged. No historical tasks or memory were backfilled.
As with the original pilot, activation was direct SQL; no CLI migration-history
baseline was invented. Frontend remains local, not a new hosted Vercel release.

Next: clarify weekday versus seven-day outreach before recurring tracking; exercise
one real closeout/opening cycle and normal user-approved corrections in daily use.
