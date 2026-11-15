# Personal assistant audit — September 10, 2026

Status: Audit and proposed direction; not an implementation or deployment approval.

The app has useful task and planning foundations, but no implemented assistant
runtime. The shortest path is one complete conversation-to-approved-focus loop.
The main delay is sequencing and integration, rather than an obsolete core stack.

## Evidence and current progress

Reviewed the assistant specification, relevant roadmap sections, planning and task
code, auth helpers, migrations, Git state, earlier assistant task, and current
official OpenAI documentation.

| Layer | Observed state |
| --- | --- |
| Task foundation | Canonical tasks, daily focus, work attribution, task revision triggers, user-scoped queries and RLS migrations exist. |
| Planning retrieval | `PlanningContextPacketV1` and `/settings/agent-context` exist locally. Section failures become warnings; candidate planning and repeated deferrals explicitly remain `not_computed`. |
| Assistant execution | No model integration, assistant endpoint, conversation UI, or assistant message persistence found in this checkout. No OpenAI/Codex SDK dependency. |
| Approval execution | Broad proposal contracts, storage, review UI, and transactional batch application remain planned. Existing task revisions do not implement this workflow. |
| Continuity and proactive work | Daily memory, briefs, research, SMS, scheduler and worker are specified, not implemented in this repo. |
| Release state | `personal-assistant-phase` is at `4f8c7c8`; packet hardening is modified, preview/spec are untracked, and unrelated economy/history changes share the working tree. Live remote main is `9c1311c`; no remote branch named `personal-assistant-phase` was returned. |

The production line has economy/history and exercise-date commits that this branch
does not contain as commits. A separate local release branch includes `7b810e5`,
the work-attribution retry fix, but its recorded worktree is prunable. Preserve
this work and reconcile deliberately before publishing assistant changes.

Verification: `npm run lint`, `npm run typecheck`, `npm run build`, and
`git diff --check` passed. No automated test suite or test script was found.
Build success does not validate authenticated Supabase queries or assistant quality.
The remote schema probe requested zero rows, but the network proxy rejected the
connection with HTTP 403. No live schema, signed-in data, hosted deployment, model
entitlement, or DigitalOcean worker was verified. Local configuration has public
Supabase settings; `OPENAI_API_KEY` is absent. This is not evidence about hosted secrets.

## Keep

- **Next.js and Supabase as the application core.** Existing auth, tasks, focus,
  ledger and revisions are reusable. No framework or database replacement is
  justified by this audit.
- **Application-owned state and authorization.** The model reads bounded context
  and proposes changes; authenticated application code validates and applies them.
- **The inspectable planning packet.** Keep warnings, record IDs and generation
  timestamps. Incomplete retrieval must never masquerade as an empty workload.
- **Task history and a small focus view.** Keep canonical tasks separate from the
  daily operating list; keep the timer overview quiet and give conversation its
  own small route.
- **A thin model boundary.** One typed request/result boundary is sufficient.
  Implement one provider initially, with small run records for errors and usage.

## Repair before trusting planning

These are source-level findings; they have not been reproduced against live data.

1. **Unscheduled work can be invisible.** `src/lib/planning.ts:325` returns backlog
   counts, not candidate task records. A newly created task without a deadline,
   focus item or attribution can be absent from all substantive packet sections.
   Include a bounded selection of open/recently edited tasks, descriptions and
   blockers. Prefer targeted task-detail retrieval over sending the entire vault.
2. **The v1 payload is disconnected.** `src/lib/agentPayload.ts:1` defines summary,
   next action, blockers and effort, but no source file imports its helpers.
   `src/lib/types.ts:79` and `src/lib/tasks.ts:179` still use the earlier payload
   shape. The v1 parser returns defaults for records without its embedded version.
   Normalize legacy data without losing it; do not assume effort estimates or
   task-level memory are already available to the assistant.
3. **Day boundaries depend on the execution host.** `src/lib/planning.ts:10`
   computes today/yesterday using the runtime timezone. Accept an explicit date,
   instant and user timezone before moving retrieval to a server. Use
   `America/Chicago` for the initial user and verify midnight/DST cases.
4. **Time and completeness need clearer semantics.** Recent attribution maps
   `created_at` to `earnedAt` (`planning.ts:284`), which is recording time rather
   than necessarily the work date. Deadline retrieval excludes blocked tasks and
   limits to ten rows; carryover uses only flagged active/planned occurrences and
   a fifty-row cap. These are useful signals, not a complete account of deadlines
   or unresolved work. Include blocked deadline tasks and expose truncation.
5. **Batch approval cannot reuse independent writes blindly.** For example,
   `src/lib/tasks.ts:783` reorders focus using two separate updates. Implement the
   first approved focus operation in one database transaction, with ownership,
   eligibility, stale-state and duplicate-apply checks. Do not expand this into
   a general mutation engine before there is a second real use case.

## Stale or disproportionate direction

- **The roadmap is a dependency chain longer than the first useful product.**
  Deterministic scoring, repeated-deferral classification, all proposal variants,
  planning sessions, daily memory and briefing are useful candidates for later
  iterations. A read-only conversation does not require all of them first.
  Deterministic validation is essential; a complete deterministic planner is not.
- **Scheduling has two proposed owners.** The assistant spec selects a
  DigitalOcean worker with an OS timer in section 4, then calls Supabase scheduled
  functions the intended mechanism in section 11. Either can be appropriate, but
  choose one scheduling owner only when adding proactive delivery.
- **Codex entitlement is an unproven deployment assumption.** Current docs still
  support programmatic Codex use and ChatGPT authentication. This direction is
  not obsolete, but authenticated worker lifecycle and account availability are
  extra dependencies for a basic hosted planning chat. The App Server docs also
  mark WebSocket transport experimental/unsupported. Keep a Codex runtime local
  to a worker rather than making that transport the public app interface.
- **Research infrastructure is separate scope.** Defer competitor registries,
  paper queues, unread-edition rollover, separate research roles, SMS and 7 AM
  delivery until the assistant is useful when opened manually. Preserve these
  preferences in the existing spec; they are not cancelled.
- **Documentation overstates consistency.** `AGENTS.md` refers to missing
  un-suffixed task/spec paths. The roadmap calls the preview's workspace anonymous
  although current code requires sign-in. The code map mixes planned and current
  structures. Fix navigation/status wording during the first implementation slice.

## Recommended immediate bearing

Build a hosted, on-demand planning helper inside Personal OS. For speed, my
recommendation is a server-side Responses API integration on the existing app,
with Supabase holding conversation and proposal state. This revises the prior
Codex-first preference and requires separate API credentials/billing. It is a
proposal, not a provider switch made by this audit.

If using the existing Business entitlement remains a firm requirement, first run
one bounded Codex proof: authenticate the intended account, supply real read-only
planning context, get one structured result, and verify access/limits. A local
proof is not an always-available deployment. After success, use the same narrow
app contract with one trusted worker; do not implement two providers concurrently.

The API supports schema-constrained output, but application checks must still
validate task ownership, current state, allowed operations, refusals and incomplete
responses. Official references: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), and
[App Server and authentication](https://learn.chatgpt.com/docs/app-server).

| Slice | Concrete deliverable | Completion evidence |
| --- | --- | --- |
| 1. Establish a release baseline | Preserve the dirty checkout; start from current main and port relevant assistant work, explicitly accounting for the local retry fix. Repair missing candidate context and timezone handling. | Signed-in packet matches actual tasks/focus, including an unscheduled task and a blocked deadline; query failures remain visible. |
| 2. Make conversation useful | One `/assistant` route, authenticated server endpoint, one provider, durable recent messages, bounded current context and basic run/error records. Read-only task access. | Ask “I have three hours; what should I do?” and receive a grounded answer, follow up, refresh and resume. No task state changes. |
| 3. Make one action safe | A durable ordered daily-focus proposal referencing existing task IDs, reasons, date and state versions; review/regenerate, approve or reject. | Approval applies once in one transaction. Reject does nothing. Repeated approval is harmless. Stale or foreign task IDs fail safely. |
| 4. Use it before expanding | Deploy and try real morning planning and an afternoon change of plan. Retrieve the latest approved plan and bounded recent conversation for continuity. | Verify useful recommendations, persistence, latency, visible failure behavior and usage. Add compact daily summaries only when this experience needs them. |

The first milestone is complete when a real signed-in user can discuss current
work, review a small plan, approve it, see today's focus update, and return later
without losing the conversation. Autonomous research, general task mutation,
scheduled summaries and SMS are outside this milestone.

Before shipping the write path, test empty accounts, failed context sections,
blocked deadlines, timezone boundaries, invalid model output, duplicate requests,
stale approvals and cross-user task references. This is a small targeted suite,
not a new evaluation platform. Compare a handful of real planning answers with
the source records; compilation alone is not a quality evaluation.
