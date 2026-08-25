# Product Spec

Status: updated planning spec for Codex agents  
Scope: personal productivity OS, task mediator, daily memory, and later company strategy flow  
Primary implementation vector: `docs/TASKS.md`

## 1. Product Overview

Productivity OS began as a personal Pomodoro-and-reward app. The durable core is still the focused-work ledger:

```txt
Pomodoro completed -> work block earned -> ledger event recorded -> reward balance updated -> reward can be redeemed
```

The product is now expanding into a Personal OS for founder task management. The immediate next product layer is not a full morning brief or autonomous company orchestrator. The next layer is a task mediator inside the existing task manager:

```txt
conversation/context -> proposed task mutations -> user approval -> database write -> revision log -> updated daily focus
```

The near-term goal is to help the user inspect current work, form a realistic daily focus, track what changed, attribute actual work to tasks, and preserve enough daily continuity that tomorrow's planning agent can begin with useful context.

Longer term, the system should expand in this order:

```txt
Personal OS -> Project OS -> Company OS -> Multi-Agent Execution Layer
```

Expansion should happen by object maturity and workflow maturity, not by adding agent features before the data model can support them.

## 2. Core Philosophy

The ledger remains the source of truth for work/reward accounting. Completed work blocks and reward spending must be recorded as auditable events.

The task vault is the source of truth for work intent. Canonical `tasks` should hold durable task state. Daily focus lists are operating views into that task vault, not separate todo lists.

The daily focus list is the daily operating surface. It should stay small and opinionated. The home page should surface what matters today without exposing the full backlog.

The agent trust model is staged:

```txt
Read freely -> propose visibly -> write only with approval
```

In the current phase, agents may read structured task/work state and propose mutations. They must not silently mutate canonical task, focus, project, memory, source, calendar, email, GitHub, or external communication state.

Continuity comes before search. Morning planning should start from yesterday's plan, unfinished work, recent completions, work-block attributions, stale or resurfacing tasks, deadlines, and user-added tasks. Full semantic search, source ingestion, graph traversal, and external signals come later.

The UI should remain quiet. Operational surfaces may exist in settings or dedicated routes, but the Home screen should remain a calm execution surface centered on the timer, current work state, reward balance, and a compact daily focus.

## 3. Current Build State

The completed foundation includes:

- Next.js App Router scaffold with TypeScript, Tailwind, ESLint, reusable UI primitives, and docs.
- Local Pomodoro timer with work, break, and long-break modes.
- Supabase persistence for timer sessions, work blocks, ledger events, reward rules, and reward redemptions.
- Ledger and reward balance derived from persisted events.
- Reward redemption/reporting flow.
- Basic daily and weekly stats.
- Canonical task storage with durable task revision history.
- Daily focus layer referencing canonical tasks.
- Work-block attribution flow linking completed work to one or more tasks, housekeeping, or other work.

Deferred but still valid:

- Productive time-of-day insight.
- Deeper analytics and history browsing.
- Full AI morning brief.
- External/news ingestion.
- Notifications.
- Calendar/email/GitHub/external actions.
- Team or multi-user company workflow.

## 4. Near-Term Product Scope: Personal OS v0

Personal OS v0 should support:

- quiet canonical task management
- small daily focus list
- work-block attribution to tasks
- planning context retrieval from structured records
- deterministic candidate daily-plan generation
- visible proposed task mutation cards
- explicit approve/reject/modify controls
- transactional application of approved proposals
- daily planning session records
- one daily memory document per user per day
- internal-only brief shell after daily memory is stable

Personal OS v0 should not require external AI provider integration. Deterministic rules and typed proposal contracts are acceptable and preferable until the data contracts are stable. If an AI provider is later introduced, it should output into the same proposal contracts rather than receiving direct database write access.

## 5. Product Non-Goals for the Current Build Sequence

Do not build yet:

- autonomous task mutation
- autonomous project or strategy mutation
- external web/news search
- market research ingestion
- SMS notifications
- calendar integration
- email integration
- GitHub actions
- collaborator messages
- native mobile app
- complex team/multi-user workflows
- source ingestion at scale
- semantic embedding search
- entity graph traversal
- role-specific assistants
- multi-agent execution workflows

## 6. Stack

Use:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase
- Vercel Hobby

Vercel should host the app shell and user-triggered API routes. Supabase should store durable state and eventually handle scheduled backend operations when needed. Do not rely on frequent Vercel cron for repeated nudges or background loops.

## 7. Primary Surfaces

### Home

Home remains the main execution surface.

It should include:

- current timer
- current mode
- start/pause/reset controls
- today’s completed work blocks
- reward balance
- recent ledger events
- current session state
- small weekly summary
- compact daily focus list
- compact planning entry point

Home should not become the backlog, the project archive, the full agent console, or the full brief reader. The timer should remain the visual focal point.

### Task Settings

Task settings is the quiet backlog and task hygiene surface.

It should include:

- canonical task list
- create/edit/complete/archive controls
- status and priority editing
- daily focus management
- revision history access
- optional parent task display/editing
- agent payload visibility or debugging affordances where appropriate

### Planning Surface

The planning surface is the first agent-mediated product surface.

It should support:

- start or resume today’s planning session
- view a planning context summary
- add a short planning note
- generate candidate daily plan
- review proposal cards
- approve/reject/modify proposals
- apply approved proposals
- finalize daily focus

The first version may be deterministic. It does not need a full chat interface.

### Proposal Review Cards

Proposal cards are the safety boundary between agent reasoning and durable writes.

Each card should show:

- proposal type
- affected task or daily focus item
- before/after summary where applicable
- reason
- approve control
- reject control
- modify control

Proposal cards should be durable across refresh and should not apply changes until approved.

### Daily Memory Archive

Daily memory archive is the quiet continuity surface.

It should support:

- view recent daily memory documents
- inspect a specific date
- edit markdown sections
- see whether a day is draft or finalized
- preserve structured source snapshot JSON for traceability

### Brief

The brief is later than task mediation and daily memory.

The internal-only brief shell may include:

1. Morning opener placeholder
2. Internal signals
3. Where we left off
4. Risks/open loops
5. Recommended daily focus

External Signals and Market/Company Breakdown should remain placeholders until source/entity infrastructure and external signal classification exist.

### Project OS Surfaces

Project OS surfaces come after Personal OS is stable.

They should eventually answer questions such as:

- What is the state of Topeka?
- What changed on the portal this week?
- What are the bridge-round open loops?
- What tasks connect to Santa Clara?

Project OS should add projects, strategic arcs, project memory, and source/entity links without turning the product into a generic team project-management suite.

## 8. Data Model

### TimerSession

Represents a work, break, or long-break session.

Fields:
- `id`
- `user_id`
- `mode`: `work | break | long_break`
- `planned_minutes`
- `started_at`
- `ended_at`
- `completed`
- `interrupted`
- `notes`

### WorkBlock

Represents one completed unit of focused work.

Fields:
- `id`
- `user_id`
- `timer_session_id`
- `earned_at`
- `duration_minutes`
- `tag`
- `quality_rating`

### LedgerEvent

Authoritative accounting record.

Fields:
- `id`
- `user_id`
- `event_type`: `work_earned | reward_spent | correction | bonus`
- `delta_work_blocks`
- `delta_reward_blocks`
- `source`
- `metadata`
- `created_at`

### RewardRule

Defines exchange rates and reward types.

Fields:
- `id`
- `user_id`
- `name`
- `cost_work_blocks`
- `reward_minutes`
- `active`
- `created_at`

### RewardRedemption

Represents reward usage.

Fields:
- `id`
- `user_id`
- `reward_rule_id`
- `reward_name`
- `cost_work_blocks`
- `redeemed_at`
- `notes`

### Task

Canonical task storage. This is implemented and should be treated as the source of truth for task state.

Fields:
- `id`
- `user_id`
- `title`
- `description`
- `status`
- `priority`
- `area`
- `due_at`
- `source`
- `parent_task_id`
- `project_id` later
- `completed_at`
- `archived_at`
- `last_seen_at`
- `human_summary`
- `agent_payload_json`
- `schema_version`

Rules:
- Canonical `tasks` are the source of truth for all task state.
- Daily focus items must reference canonical tasks rather than duplicating task content.
- Task changes must create durable task revision rows.
- Agent-readable context belongs in compact, versioned `agent_payload_json`, not in unbounded transcript fields.
- Optional `parent_task_id` supports lightweight `subtask -> task` relationships before project objects exist.

`status` values (canonical):
- `open` — created, no work yet.
- `in_progress` — work has begun.
- `blocked` — depends on another item being resolved first; a blocker surfaces to the top of focus.
- `completed` — done.
- `archived` — removed from active consideration (completed-for-history, or dropped/abandoned), kept in compact history.

`priority` values (canonical): `critical`, `high`, `medium`, `low`.

### TaskAgentPayloadV1

Versioned task-level agent context stored in `tasks.agent_payload_json`.

Suggested fields:
- `schema_version`
- `summary`
- `context`
- `next_action`
- `known_blockers`
- `source_notes`
- `last_agent_reviewed_at`
- `tags`
- `estimated_remaining_blocks`

Rules:
- Treat missing or malformed payloads as recoverable.
- Preserve unknown keys where practical.
- Do not store full chat transcripts in task payloads.
- Keep payloads compact enough to be included in planning context packets.

### TaskRevision

Durable audit row for task changes.

Fields:
- `id`
- `task_id`
- `user_id`
- `action_type`
- `actor_type`
- `actor_label`
- `change_reason`
- `before_json`
- `after_json`
- `created_at`

Rules:
- Actor type should distinguish human, agent, and system changes.
- Approved agent proposals should create revisions when applied.
- Revisions are an agent retrieval source, not just a human audit log.

### DailyFocusList

Daily operating surface for tasks.

Fields:
- `id`
- `user_id`
- `date`
- `created_at`
- `updated_at`

Rules:
- One list per user/date is expected.
- The list is a daily view into the task vault.
- Daily focus should remain small.

### DailyFocusItem

Task reference inside a daily focus list.

Fields:
- `id`
- `daily_focus_list_id`
- `task_id`
- `position`
- `focus_status`
- `carried_forward`
- `note`
- `created_at`
- `updated_at`

`focus_status` values (canonical):
- `planned` — staged for a future day; the agent's buffer of the most immediate open
  tasks. Not necessarily rendered in today's focus; surfaced at the top of the task
  library for the user to pull in.
- `active` — on today's focus list right now.
- `done` — completed today; sets the task to `completed`.
- `deferred` — moved to a future day; the task stays `open` and is re-evaluated
  tomorrow. Rendered with orange strikethrough when shown.
- `dropped` — abandoned; sets the task to `archived`. Rendered like `deferred`.

`carried_forward` is a boolean flag (not a status) marking an item carried over from
a prior day's plan. It renders a "lingering" badge. It is orthogonal to
`focus_status` (an `active` item can also be carried-forward).

Rules:
- Completing from the daily surface mutates the canonical task (`completed`) and sets
  focus `done`, creating a task revision.
- Dropping/archiving from the daily surface mutates the task (`archived`) and sets
  focus `dropped`.
- Deferring leaves the task `open` and sets focus `deferred`.
- Adding to today sets focus `active`.
- Focus status explains what happened to the plan; task status tracks the task's own
  lifecycle. They are intentionally separate vocabularies.
- Carry-forward metadata should help future agents detect repeated deferrals and
  unresolved work.

### WorkBlockAttribution

Links actual completed work to planned or unplanned tasks.

Fields:
- `id`
- `work_block_id`
- `task_id`
- `attribution_label`
- `share_ratio`
- `attributed_minutes`
- `created_at`

Rules:
- Completed work blocks should be attributed to one or more tasks/options.
- If multiple tasks are selected, attribution should be split evenly.
- A persistent `chores/housekeeping` option should be available for non-task-specific work.
- Selecting `other` should create or resolve to queryable canonical task-like state where practical.
- Work-block attribution should be required rather than silently skipped.
- Ledger and work history should show human-readable task attribution.

### PlanningContextPacketV1

Computed object, not necessarily a database table.

Suggested fields:
- `date`
- `user_id`
- `yesterday_focus`
- `today_focus`
- `carryover`
- `recently_completed`
- `recent_work_attributions`
- `deadline_pressure`
- `backlog_pressure`
- `repeated_deferrals`
- `candidate_daily_plan`
- `context_warnings`

Rules:
- Use IDs and compact summaries, not full raw rows.
- Must serialize cleanly to JSON.
- Should be inspectable in a settings/debug route.
- Should be generated from structured Postgres records before semantic search is introduced.

### PlanningSession

Durable daily planning record.

Suggested fields:
- `id`
- `user_id`
- `date`
- `status`
- `planning_note`
- `context_packet_json`
- `summary_markdown`
- `created_at`
- `updated_at`
- `completed_at`

Rules:
- A planning session records how the day’s plan was formed.
- It may link to proposal batches.
- It should not store long unbounded chat history in v0.

### TaskMutationProposalBatch

Durable group of proposed changes.

Suggested fields:
- `id`
- `user_id`
- `planning_session_id`
- `source`
- `status`
- `context_packet_json`
- `created_at`
- `updated_at`
- `resolved_at`

Rules:
- Batches preserve the context used to generate proposals.
- Batches should survive refresh.
- Batches do not mutate canonical task state directly.

### TaskMutationProposal

Durable pending, approved, rejected, modified, applied, or failed proposed change.

Suggested fields:
- `id`
- `batch_id`
- `user_id`
- `proposal_type`
- `target_task_id`
- `target_daily_focus_item_id`
- `payload_json`
- `status`
- `position`
- `reason`
- `created_at`
- `updated_at`
- `resolved_at`

Supported proposal types:
- create task
- update task
- change status
- change priority
- defer task
- complete task
- add daily focus item
- remove daily focus item
- reorder daily focus item
- update daily focus note/status
- update `agent_payload_json`
- add note/change reason

Rules:
- Every proposal type should have a typed payload contract.
- Unknown payloads should render as recoverable errors.
- Applying approved proposals should be idempotent enough to avoid duplicate writes.
- Applied task changes should create task revisions.

### DailyMemoryDocument

One short agent-legible continuity document per user per day.

Suggested fields:
- `id`
- `user_id`
- `date`
- `status`
- `morning_seed_markdown`
- `planning_log_markdown`
- `work_session_log_markdown`
- `final_summary_markdown`
- `carry_forward_markdown`
- `source_snapshot_json`
- `created_at`
- `updated_at`
- `finalized_at`

Document sections:
- Starting Context
- Planned Focus
- Notable Changes
- Work Completed / Advanced
- Deferred / Blocked / Avoided
- User Feedback / Preferences
- Carry Forward to Tomorrow

Rules:
- One daily memory document per user/date.
- Morning seed should use yesterday’s carry-forward section when available.
- Planning-session finalization should update planning log.
- Work-block attribution should update work-session log.
- End-of-day consolidation should produce final summary and carry-forward notes.
- Store markdown for human legibility and structured snapshot JSON for traceability.

### DailyBrief

Later phase.

Suggested fields:
- `id`
- `user_id`
- `date`
- `source_daily_memory_document_id`
- `summary_markdown`
- `recommended_tasks`
- `company_posture`
- `external_news`
- `opened_at`
- `created_at`
- `updated_at`

Rules:
- Internal brief should be generated from daily memory and planning context first.
- External sections should remain placeholders until source/entity/signal infrastructure exists.
- Brief data should be stored structurally, not only as a freeform blob.

### StrategicArc

Later Project OS object.

Suggested fields:
- `id`
- `user_id`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

### Project

Later Project OS object.

Suggested fields:
- `id`
- `user_id`
- `strategic_arc_id`
- `name`
- `description`
- `status`
- `current_summary`
- `created_at`
- `updated_at`

### SourceMaterial

Later company memory/source-ingestion object.

Suggested fields:
- `id`
- `user_id`
- `project_id`
- `title`
- `source_type`
- `source_url`
- `captured_at`
- `summary_markdown`
- `strategic_relevance`
- `created_at`
- `updated_at`

### RelatedEntity

Later entity graph object.

Suggested fields:
- `id`
- `user_id`
- `entity_type`
- `name`
- `summary_markdown`
- `created_at`
- `updated_at`

Entity types may include city, company, agency, person, grant, investor, customer, competitor, product, source, or other.

## 9. Ledger and Reward Rules

A completed work session should create:

1. a completed `TimerSession`
2. a `WorkBlock`
3. a `LedgerEvent` with positive `delta_work_blocks`

A reward redemption should create:

1. a `RewardRedemption`
2. a `LedgerEvent` with negative `delta_work_blocks`

Reward balance math should be derived from persisted ledger events:

- `work_earned` events add reward minutes based on whether the event timestamp falls on a weekday or weekend.
- `reward_spent` events subtract the redeemed reward minutes stored in ledger metadata.
- The displayed balance may be positive or negative.
- Reported reward days should be stored as durable datetimes, not relative labels like `today` or `yesterday`.

Current balances should derive from ledger events or a trusted database view. Do not rely only on client-side state.

## 10. Planning Retrieval Rules

When the user starts daily planning, retrieve structured context in this order:

1. Today’s daily focus list
2. Yesterday’s daily focus list
3. Carryover work
4. Completed-work neighbors
5. Recent work-block attributions
6. Backlog-pressure tasks
7. Deadline-pressure tasks
8. User-added or recently edited tasks
9. Repeated deferrals
10. Candidate daily plan

Do not search the whole database each morning. Prefer small, explainable, typed queries over broad retrieval.

The first candidate plan builder should be deterministic. It should score tasks based on visible factors such as current focus, carryover, deadlines, stale high-priority tasks, repeated resurfacing, and recent work activity.

## 11. Eat-the-Frog Rule

If a task repeatedly appears, gets deferred, or remains stale despite importance, the system should push for explicit disposition.

Supported dispositions:
- do it today
- schedule later with reason
- split it
- mark blocked
- lower priority
- abandon it
- move to someday/maybe later

This should initially surface as a recommendation or proposal, not an automatic mutation.

## 12. Chat-to-Task / Planning Protocol

The approved protocol is:

```txt
conversation or planning note
-> planning context packet
-> proposed task mutation batch
-> proposal cards
-> user approval/rejection/modification
-> transactional database write
-> task revision log
-> updated daily focus
-> planning session summary
-> daily memory update
```

Rules:
- The agent may read relevant structured records.
- The agent may propose task and focus changes.
- The agent may write only after explicit user approval.
- Approved writes must create appropriate revisions.
- Failed writes must be visible and recoverable.
- Proposal history should not be silently deleted.

## 13. Daily Memory Flow

Daily memory creates a continuity bridge from one day to the next.

Flow:

1. Morning seed
   - ingest yesterday’s carry-forward
   - create today’s starting context
   - include current focuses, concerns, starting points, and watch items

2. Planning-session updates
   - record meaningful task-list changes
   - capture why tasks were added, removed, deferred, or reprioritized

3. Work-session updates
   - after attribution, append or regenerate short notes about what work advanced

4. End-of-day consolidation
   - review focus outcomes, work blocks, user feedback, blocked/deferred items, and agent notes
   - finalize the day’s memory document
   - create carry-forward notes for tomorrow

Daily memory should be editable. It should not become an unbounded transcript.

## 14. Brief Behavior

The brief should start as an internal continuity document before becoming a news or market intelligence product.

Internal-only brief sections:
- Morning opener placeholder
- Internal signals
- Where we left off
- Risks/open loops
- Recommended daily focus

Later full brief sections:
1. Morning Opener
2. External Signals
3. Market / Company Breakdown
4. Internal Signals
5. Where We Left Off
6. Risks / Open Loops
7. Recommended Daily Focus

External signals should follow this classification model when implemented:

1. Morning Curiosity
   - interesting general stories
   - belongs only in the opener

2. Strategic Signal
   - relevant to positioning, market understanding, policy, customers, competitors, technology, or regulation
   - informs context but does not automatically create tasks

3. Actionable Trigger
   - may require action today or this week
   - may generate proposed tasks, not accepted tasks

Scoring dimensions for serious signals:
- strategic relevance
- actionability
- urgency
- confidence
- novelty

Signal-to-task control rule:

```txt
signal -> relevance classification -> implication -> proposed task
```

## 15. Project and Company Expansion Model

Expansion path:

```txt
Personal OS -> Project OS -> Company OS -> Multi-Agent Execution Layer
```

### Personal OS

Current phase.

Focus:
- inspect current work
- discuss/refine daily needs
- form daily focus
- track task changes
- preserve daily memory
- maintain continuity

### Project OS

Next expansion after Personal OS stabilizes.

Add:
- projects
- strategic arcs
- milestones
- decisions
- source materials
- related entities
- project memory notes

Project OS should be project-centric, not team-centric.

### Shared Company Memory

Later phase.

Add selective shared memory:
- decision logs
- strategy revisions
- meeting summaries
- customer/investor interaction records
- market research notes
- entity profiles
- source ingestion
- daily/weekly summaries

Use promotion rules. Not everything becomes company memory.

### Role-Specific Assistants

Later phase.

Possible assistants:
- founder assistant
- engineering assistant
- market research assistant
- investor relations assistant
- grant/procurement assistant
- customer/account assistant
- product strategy assistant

Rule:

```txt
Agents are interfaces to structured company context, not independent personalities wandering through the database.
```

### Multi-Agent Execution Layer

Later phase.

Possible subagents:
- research agent
- task hygiene agent
- source ingestion agent
- briefing writer
- competitor analyst
- repository cartographer
- verification agent
- document drafting agent

The orchestrator coordinates rather than coding, researching, and verifying everything directly.

## 16. UI Design System

Also read:
- `docs/STYLE_GUIDE.md`

Use Tailwind with a small reusable component layer.

Recommended primitives:
- `Button`
- `Card`
- `Badge`
- `StatCard`
- `Progress`

Design goals:
- sparse dashboard
- strong visual hierarchy
- low visual noise
- clear timer state
- clear work/reward accounting
- no giant task backlog on Home
- compact daily focus surface
- visible but non-intrusive planning entry point
- quiet settings/debugging surfaces
- proposal cards that are clear enough to trust before approval

Use semantic names and reusable components. Avoid scattering long one-off Tailwind class strings across page files.

Additional layout rules:
- Prefer grid structure, spacing, and dividers before stacked cards.
- Use sharper radii on operational screens such as settings, task management, audit views, and proposal review.
- Keep explanatory copy minimal and only where the interface would otherwise be unclear.
- Home should stay centered on the timer and current day.
- Planning and memory can use dedicated or settings surfaces if they need room.

Suggested color tokens:

```ts
app: {
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  muted: "#64748B",
  accent: "#225064",
  accentSoft: "#EDF8FC",
  border: "#D0D8DD"
}
```

## 17. Notification Behavior, Later Phase

The notification system should eventually bother the user until the daily brief is opened.

Basic loop:

```txt
daily brief created -> notification sent -> check opened_at -> repeat if unopened -> stop once opened
```

Start with Pushover or Telegram before SMS.

Do not use SMS for MVP because application-to-person texting introduces registration, compliance, and cost overhead.

Do not implement notifications until daily briefs, opened/read state, and scheduling infrastructure are stable.

## 18. Deployment Constraints

Deploy the app on Vercel Hobby.

Vercel is suitable for:
- Next.js hosting
- app shell
- user-triggered API routes
- daily brief endpoint if invoked once daily

Do not rely on frequent Vercel cron for repeated nudges. Use Supabase scheduling or another explicit scheduler when notification loops are implemented.

No service-role secret should be exposed to client components.

## 19. Success Criteria for the Current Build Sequence

The next major build sequence is successful when:

- The user can maintain a quiet canonical task vault.
- The Home page shows only a small daily focus surface.
- Work blocks are attributed to tasks.
- The app can retrieve a structured planning context packet.
- The app can generate a small candidate daily plan.
- The app can show proposal cards for task/focus changes.
- The user can approve, reject, or modify proposed changes.
- Approved proposals mutate canonical records and create revisions.
- Daily memory documents preserve useful continuity across days.
- The internal brief can summarize where things stand without external search.
- The implementation remains small enough for coding agents to modify safely.
