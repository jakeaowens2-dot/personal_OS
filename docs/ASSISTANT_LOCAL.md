# Local daily-planning assistant

Current slice (2026-09-12): Hermes runs behind the Personal OS chat using the
machine's existing ChatGPT Codex login. Personal OS owns durable conversations,
preferences, daily notes, ongoing priorities, and reviewed task proposals.
Implementation is present and the assistant migration was applied to the existing
Supabase project on 2026-09-12. Signed-in local browser acceptance remains pending.
This is not a hosted release.

Authentication-only hosted release (2026-09-20): production main commit `35352e0`
adds password sign-in and `/settings/account` on top of current production `8108b41`.
Typecheck, lint and production build passed. Vercel deployment
`BiEDv73B4DehbSo5Zauod3beTdsr` reported success, and the existing signed-in browser
at `https://personal-os-2j29.vercel.app/settings/account` showed the password-change
form for the expected account. Password entry/save remains with the user. This
release does not deploy the local Hermes assistant or unrelated workspace edits.

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

The everyday entry point is the installed macOS app at `~/Applications/Personal OS.app`. It opens in its own window, starts the loopback development workspace when needed, and stops the server when the app quits. This keeps daily interface changes immediately available without a release cycle. The launcher restores Next's generated declaration import after startup so ordinary app use does not dirty the repository. The first app session must sign in on Work tracking because the app intentionally has its own private web session. Native-shell/icon changes require `npm run app:build` and copying that verified bundle to Applications; `npm run app:refresh` performs the web verification build and native build together.

1. Already applied to the current project: `supabase/migrations/20260912000000_assistant_daily_planning.sql`. For a new installation, apply it to the
   **existing Personal OS Supabase project**. This additive migration creates only
   assistant tables/functions/policies; it uses existing `tasks` and task-revision
   triggers. Do not replay unrelated migrations or reset the database.
2. Run `npm run assistant` and open <http://localhost:3016/assistant>.
3. Sign in on Home at that same localhost origin, then return to the assistant.
   Password sign-in is the default; magic links remain optional. Use Home Settings
   → Account password (`/settings/account`) to set/change a password while signed
   in, or request a one-time recovery email when signed out. Recovery requires
   `http://localhost:3016/settings/account` in Supabase Auth's redirect allowlist
   (and the hosted equivalent when deployed). A magic-link-only account still needs
   an authenticated session or recovery email before its first password is set.
   Password recovery uses a link-portable implicit callback because the installed
   app and system browser do not share storage. Ordinary sign-in remains PKCE and
   cookie-backed. A successful recovery callback may open in the normal browser and
   routes to the password form; a failed callback is shown as an error. Old anonymous
   sessions are cleared before a request and are never offered as password-bearing
   accounts.
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
model-provider abstraction was added. `@langchain/langgraph` now owns coarse
conversation routing, and `@langchain/langgraph-checkpoint-postgres` persists one
daily execution thread in the private `assistant_langgraph` schema. It does not
replace Hermes or application-owned memory. See `ASSISTANT_FLOW_GRAPH.md`.

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
  On model replay only, `scripts/hermes_history.py` projects obsolete full-state
  packets into their original request/source/flow fields and replaces historical
  read_context snapshots with explicit refresh markers. All message rows, native
  summaries, receipts, persistence identities and application memories remain
  stored unchanged. The current state packet is supplied in full for the new turn.
  Compression uses a 30-second idle / 60-second total budget inside the 160-second
  native turn budget and 180-second host watchdog. Content-free replay size counts
  appear in the local server log; no prompt or credential text is logged there.
  Native session search is fenced to this dedicated profile; canonical history
  search provides portable source IDs. Opening an old date never rewinds Hermes.
- Preserves accepted sources and successful memory writes when a reply fails or is
  interrupted. Retry keeps the original operation ID; a five-minute lease fences
  overlapping tabs and abandoned workers. An unfinished maintenance pass is visible.
- Asks the morning initialization questions as separate assistant messages. Daily
  graph state survives reload/app closure; stopped Hermes work resumes from the
  preceding coarse node rather than replaying the full morning sequence.

## Runtime boundary

The Python adapter registers a small fixed application toolset in Hermes's native
loop. It does not use the broken stdio MCP transport found in the earlier trial.
The general MCP defect remains in the installed checkout; a broad MCP integration
is not claimed. The application tool handlers and records have no Hermes schema
requirements and can be exposed through another adapter later.

Only app context/history/task reads, the three memory upserts, task proposals,
review publication, maintenance completion, and profile-scoped native history
search are exposed. There is no task-approval tool, arbitrary local-file access,
shell, web, messaging or ledger mutation. Task acceptance now also propagates the
agreed task into today’s focus atomically; there is no independent agent focus tool.
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
  If Docker is unavailable, install `@electric-sql/pglite` in a temporary directory
  outside the repo and run `ASSISTANT_TEST_PGLITE_MODULE=/absolute/path/to/package
  node scripts/assistant-db-pglite.cjs` (one shell command). This fallback runs the
  same SQL in isolated PostgreSQL with no live database connection.
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

Signed-in real memory writes and approved task creation are verified. Description/
prerequisite writes are active after the 2026-09-20 additive migration. Isolated
real-plan replay passed recall, correction, progress and fresh-session recovery;
see `ASSISTANT_PREREQUISITES_20260920.md`. Real-user closeout/opening and routine
correction acceptance remain to be exercised. No production deployment or Git push
is part of this slice. The branch is `codex/assistant-daily-planning`; unrelated
existing economy/history work has been preserved.

Deliberate limits: no independent agent focus edits or recurring daily scheduling, full proposal-batch engine,
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

## Durable chat decisions — 2026-09-20

Applied `20260921020000_assistant_chat_decisions.sql` to the configured Supabase
project. Five historical closed proposals were attached to the latest owned
assistant response at or before their resolution timestamp. Verified no missing,
foreign, non-assistant or future anchors; task and memory revision counts unchanged.
New accept/reject transactions persist this response ID, and closed decisions
cannot be moved. If no response exists yet, resolution fails atomically and asks
the user to wait. No new user messages or task decisions were manufactured for QA.

The chat renders resolved cards beneath their stored response and only pending
cards in the trailing review queue. Date navigation loads that day's attached
cards without the previous global 200-proposal cutoff. Task History is paged from
canonical revisions and bounded at each proposal/decision timestamp; later task
edits do not rewrite old cards. Entries are concise factual summaries, not generated
narratives. Limits fail visibly instead of silently dropping history.

Verified the report's Status/History, accepted cards under their saved responses,
and the pending CRM proposal in the review queue in the signed-in browser. The
full isolated SQL suite covers owned latest-response selection, pending/unresolved
placement, accepted/rejected decisions, immutable historical anchors and retries.
Typecheck/lint and 21 assistant tests passed.

## Acceptance-to-focus activation — 2026-09-20

Applied `20260921010000_assistant_accepted_focus.sql` through the configured app
session pooler after running the full isolated SQL suite, including
`assistant-focus.test.sql`. Acceptance atomically adds unfinished canonical tasks
to the current Central-date focus as `active`; repeated acceptance does not add
rows, existing focus choices/order/notes remain intact, and accepted completion
settles an existing active/planned item. Rejected proposals add nothing. The helper
and trigger functions are private; authenticated approval remains the entry point.

At the user's explicit request, populated today's focus with the three previously
accepted tasks: NIA report first, then case study and daily outreach. Verified all
three on the signed-in Work tracking page. This is not a recurring scheduler.

The user confirmed seven-day work/planning and outreach including weekends. Used
the normal handoff-correction chat flow to record a sourced preferences entry,
correct daily notes, republish the September 20 handoff preserving newer progress,
and review/apply the outreach wording correction. Other pending proposals from the
user's separate progress exchange were not accepted or altered by this operation.
