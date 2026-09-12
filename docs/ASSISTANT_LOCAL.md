# Local daily-planning assistant

Current slice (2026-09-12): Hermes runs behind the Personal OS chat using the
machine's existing ChatGPT Codex login. Personal OS owns durable conversations,
preferences, daily notes, ongoing priorities, and reviewed task proposals.
Implementation is present and the assistant migration was applied to the existing
Supabase project on 2026-09-12. Signed-in local browser acceptance remains pending.
This is not a hosted release.

Activation receipt (2026-09-12): connected using the private
`SUPABASE_URL_SESSION_POOLER` field in `.env.local`; verified its project reference
matches the app URL and the existing task columns/audit triggers. Applied only
`20260912000000_assistant_daily_planning.sql` in one transaction and reloaded the
PostgREST schema cache. Verified nine assistant tables and nine ownership policies,
RLS on every table, no anonymous writes, and private helper execution revoked.
The project has no `supabase_migrations.schema_migrations` table; this was a direct
SQL application, not a CLI migration-history baseline. Do not replay this file or
run an unreviewed bulk `db push`. Existing tasks and ledger data were not changed.

## Start and activate

1. Already applied to the current project: `supabase/migrations/20260912000000_assistant_daily_planning.sql`. For a new installation, apply it to the
   **existing Personal OS Supabase project**. This additive migration creates only
   assistant tables/functions/policies; it uses existing `tasks` and task-revision
   triggers. Do not replay unrelated migrations or reset the database.
2. Run `npm run assistant` and open <http://localhost:3016/assistant>.
3. Sign in on Home at that same localhost origin, then return to the assistant.
   Authentication is required for durable planning. The old browser-only archive
   remains exportable under Details; it is not silently imported as new facts.
4. Try a real planning exchange: name a continuing priority and why, give a progress
   update on a task, then review any proposed task change with Apply or Reject.
   Open Memory to inspect the saved entries and their source/revision receipts.

Local authentication is separate from the hosted Vercel session. Home requests
`emailRedirectTo: window.location.origin`. If a locally requested magic link lands
on Vercel, inspect Supabase Auth URL Configuration for the exact localhost redirect
and the email template before requesting another link. That dashboard configuration
has not yet been inspected; the observed localhost browser remains signed out.

Keep the local process running. The launcher binds to `127.0.0.1`; the API also
requires same-origin loopback requests and rejects ordinary Vercel launches.
Current native dependency: the existing Hermes installation, tested at
`~/.hermes/hermes-agent` (0.20.5), with its existing Python environment. No new
JavaScript framework or runtime dependency was added.

| Setting | Default |
| --- | --- |
| `PERSONAL_ASSISTANT_PORT` | `3016` |
| `PERSONAL_ASSISTANT_MODEL` | `gpt-5.6-terra` |
| `PERSONAL_ASSISTANT_HERMES_INSTALL` | `~/.hermes/hermes-agent` |
| `PERSONAL_ASSISTANT_RUNTIME_HOME` | `~/.local/state/personal-os-assistant` |

The dedicated runtime profile is scoped by authenticated user ID, outside the Git
checkout, and private to the host user. Hermes imports the existing Codex login
using its native credential helper when needed. It has no API-key environment or
fallback provider. Credentials never enter browser responses, tool packets, or
Supabase memory. The user's ordinary Hermes profile is unchanged. The single host
still spends its owner's Codex subscription; this is a personal local pilot, not
an externally exposed multi-user model service.

## What this slice does

- Saves messages in authenticated Supabase history before using them as sources.
- Loads current canonical tasks/focus, the three memory homes, relevant daily
  handoffs, pending proposals, and recent conversation for every turn.
- Lets Hermes maintain sourced memory entries automatically, with stable IDs,
  explicit inference labels, expected-revision checks, and append-only revisions.
- Proposes task creation or title/status/priority/progress-note updates. Apply is a
  separate authenticated transaction; stale tasks are rejected, repeated approval
  is idempotent, and existing task-revision triggers record the approved change.
- Offers Today/date navigation, readable sources, memory corrections through chat,
  revision inspection, and an export of the selected day plus loaded working state.
- Shows all three carry-forward groups without a quota. Close out day publishes a
  versioned review; opening after a missed closeout prepares a labeled catch-up.
  Presentation receipts are distinct from approval. Corrections preserve history.
- Keeps one logical native conversation across daily views. Hermes's own session
  persistence/compaction remains available alongside the current application state.
  Native session search is fenced to this dedicated profile; canonical history
  search provides portable source IDs. Opening an old date never rewinds Hermes.
- Preserves accepted sources and successful memory writes when a reply fails or is
  interrupted. Retry keeps the original operation ID; a five-minute lease fences
  overlapping tabs and abandoned workers. An unfinished maintenance pass is visible.

## Runtime boundary

The Python adapter registers a small fixed application toolset in Hermes's native
loop. It does not use the broken stdio MCP transport found in the earlier trial.
The general MCP defect remains in the installed checkout; a broad MCP integration
is not claimed. The application tool handlers and records have no Hermes schema
requirements and can be exposed through another adapter later.

Only app context/history/task reads, the three memory upserts, task proposals,
review publication, maintenance completion, and profile-scoped native history
search are exposed. There is no task-approval tool, arbitrary local-file access,
shell, web, messaging, ledger mutation, or daily-focus mutation in this slice.
Built-in competing user/general memory and background review are disabled only in
the dedicated profile. Useful native session history and compaction are retained.

The former ephemeral Codex adapter remains as tested historical reference; the
active endpoint uses `hermes.ts` and `hermes-planning-worker.py`.

## Verification and remaining acceptance

- `npm run test:assistant`: input, origin, shape/provenance, revision/tool-boundary,
  date-rollover and runtime checks; no model usage.
- `npm run test:assistant:db`: disposable PostgreSQL 17 container; tests the actual
  migrations, RLS, source ownership, leases, memory revisions, stale task proposals,
  idempotent approval/task creation, and a handoff with more than three items, uncertainty, and explicit accounting
  for a prior-day commitment.
  The runner removes its test container. Requires Docker; never targets live data.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run test:assistant:live` is opt-in and consumes the existing ChatGPT
  subscription using only fictional data in a temporary profile. Evidence is
  written beside that profile; copied test authentication is removed on exit.
- Live isolated Hermes exercise: all three homes saved through real tool calls;
  task proposal remained pending; a continuing session recalled progress and a detail deliberately omitted from
  application memory; a fresh
  session recovered preferences and priority/rationale from app-owned state.
  Test data was fictional, outside real application state. Test credentials were
  removed afterward. This verifies the adapter, not activation of the hosted schema.

Pending real-user acceptance: authenticate locally, verify
an actual task/focus read, a real memory correction, approved task update, and
closeout/opening in the signed-in browser. No production deployment or Git push
is part of this slice. The branch is `codex/assistant-daily-planning`; unrelated
existing economy/history work has been preserved.

Deliberate limits: no automatic daily-focus edits, full proposal-batch engine,
nightly jobs, research, integrations, embedding store, or complete erasure workflow.
Memory corrections preserve revisions; “forget” must not claim source/history
purging. Current date views fail visibly at 1,000 messages rather than silently
truncating. Revision inspection currently shows the latest 100 revisions with an
explicit indicator when older revisions exist. These are pilot limits to revisit
with use, not requirements for a larger memory framework.

Build note: Next.js currently emits a non-fatal file-tracing warning for the local
Python launcher. The build succeeds; inspected trace entries contain project
source/docs, not credential files. Trim the deployment trace before any hosted
assistant release. This slice is local-only.
