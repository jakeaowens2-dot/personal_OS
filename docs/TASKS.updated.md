# Tasks

This file defines the phased rollout.

Agents should complete tasks in order unless instructed otherwise.

When a task is completed:
- Mark it complete.
- Add a short note with changed files and verification.
- Do not skip ahead to later phases.

## Side module — Project fieldbook (2026-08-30)

Status: Complete

Note: Added `/projects/safety-evidence`, a user-scoped project deliverable tracker seeded with the intersection-evidence launch plan. It classifies each deliverable by appropriate input shape, requires explicit submission before completion, stores submissions in Supabase, and imports future bulleted project outlines. `/task-tracker` opens a local in-memory preview for rapid iteration without sign-in or saved-data changes. Verified with `npm run typecheck`, `npm run lint`, and `npm run build`.

## Next Up (2026-08-23) — Task attribution: "add a new task" + picker fix

Status: Complete (NU-1 + NU-2)

Note: Reworked the attribution picker in `src/app/page.tsx`. The always-present
"Other" checkbox is gone. In its place: an "Add a task" button (persists a stub via
`createTask` with `source=attribution_capture`, `addTaskToDailyFocus`-es it, and
checks it in the picker) and a text-only "Select from existing task library" button
opening a searchable popup (`fetchTasks`). After a work block is saved, if any task
was newly created that turn, a "Enter metadata for new task" dialog opens (area,
priority, due date, description) with Save or "Complete later". `buildAttributionSelections`
no longer creates tasks — new tasks are created at "Add a task" time and flow through
the normal selection mapping. Verified with `npm run typecheck`, `npm run lint`, and
`npm run build`.

Two changes to the work-block attribution flow, to be done in order. They share the
same surface (`AttributionFields` + the attribution state/handlers in
`src/app/page.tsx`), and the second fix partly falls out of the first.

### Conceptual model — "focus" vs. the task library

The picker's `availableTasks` is the day's curated **focus** list, not the whole
task library. In the future this focus set is assembled by the morning brief /
planning agent each day, so it changes daily. Conceptually:

- **"Add a task"** (button keeps this label — it's more intuitive) really means
  **"add a focus"**: the new task is added to today's focus set, alongside anything
  the morning brief surfaced.
- The full **task library** (older tasks, backlog) stays out of the picker unless the
  user explicitly reaches for it via a **"Select from existing task library"** action.

So the picker surface has three sources of selectable tasks:
1. Today's focus (morning brief + anything added this turn).
2. New tasks captured via the "Add a task" button (these become focus).
3. Older tasks pulled in on-demand via "Select from existing task library".

### NU-1 Rework the "other" option into an "Add a task" (focus) action

Status: Complete

Replace the always-present "Other" checkbox + inline text field in the attribution
picker with:

1. An **"Add a task"** button at the bottom of the task list. It opens an inline card
   (visually similar to the current "other" card): a "Task name:" label, a text
   input beneath it, and a submit button. Submitting immediately persists a task
   stub via `createTask` (source `attribution_capture`), adds it to the picker's
   selectable list on the spot (checked by default), and adds it to today's focus
   via `addTaskToDailyFocus`.
2. A subtle **"Select from existing task library"** button (text-only, matching the
   existing `variant="text"` styling used for "Add manually" / "Spend reward").
   Clicking it opens a popup listing older tasks, with a **search** field to filter.
   Selecting a task from the library adds it to the picker (checked by default) for
   this work block, so work that got unexpected attention today can be attributed to
   an existing task instead of spawning a near-duplicate.

After the work block is saved, IF a new task was created in that turn, open a
follow-up "Enter metadata for new task" dialog exposing the relevant metadata fields
(area, priority, due date, description/notes). The user can submit, or choose
"Complete later", which leaves the stub as-is (title only).

Acceptance criteria:
- The "other" checkbox is gone; new-task capture is explicit via the "Add a task"
  button, and older tasks are reachable via the searchable "Select from existing
  task library" popup.
- A task created via "Add a task" appears in the picker immediately, is selectable,
  and is added to today's focus list (so it resurfaces in later pickers).
- The searchable library popup filters older tasks and lets the user select one.
- The metadata dialog appears only when a new task was created that turn.
- "Complete later" leaves the stub persisted (title only, default metadata).

### NU-2 Fix: newly captured tasks never resurface in later attribution pickers

Status: Complete

Root cause (diagnosed 2026-08-23): `buildAttributionSelections` persists the
"other" task via `createTask` — it is NOT lost (it lands in `tasks` with
`source=attribution_capture` and appears in the Task vault) — but it is never added
to the daily focus list, and `prepareAttributionSelectionState` sources the picker's
`availableTasks` solely from `fetchDailyFocusItems` (today's focus list) plus
`fetchTasksByIds` (only for preselected ids). So a captured task is orphaned from
the picker and never shows up again.

Fix:
- When a new task is created during attribution, also `addTaskToDailyFocus` it so it
  joins today's focus list and surfaces in future pickers (this is now NU-1's
  "add to today's focus on the spot" behavior).
- The "Select from existing task library" popup is the escape hatch for tasks that
  are NOT in today's focus but still need attributing — this supersedes the need to
  auto-inject `attribution_capture` tasks into `availableTasks`.

Acceptance criteria:
- A task captured via "Add a task" is selectable in the NEXT attribution dialog
  without re-entering it (it is now in the focus list).
- Older tasks are reachable and searchable via the library popup.

---

## Phase 0 — Project Scaffold

### 0.1 Create Next.js project

Status: Complete

Note: Added a root-level Next.js App Router scaffold with TypeScript, Tailwind, ESLint, `src/app`, and verified with `npm run lint`, `npm run typecheck`, `npm run build -- --webpack`, and a successful `npm run dev` startup.

Create the app using:
- Next.js App Router
- TypeScript
- Tailwind
- ESLint
- `src/` directory

Acceptance criteria:
- App runs locally.
- Default page renders.
- Tailwind is configured.
- TypeScript compiles.

### 0.2 Add base repo docs

Status: Complete

Note: Confirmed `AGENTS.md`, `README.md`, `CODEMAP.md`, `docs/PRODUCT_SPEC.md`, and `docs/TASKS.md` at repo root/docs and updated the code map to reflect the live scaffold structure.

Add:
- `AGENTS.md`
- `README.md`
- `CODEMAP.md`
- `docs/PRODUCT_SPEC.md`
- `docs/TASKS.md`

Acceptance criteria:
- Codex guidance is available at repo root.
- Code map exists.
- Product spec and task plan exist.

### 0.3 Add base UI primitives

Status: Complete

Note: Added typed `Button`, `Card`, `Badge`, and `StatCard` primitives under `src/components/ui`, refactored the home page to use them, and verified with `npm run lint`, `npm run typecheck`, and `npm run build -- --webpack`.

Create:
- `Button`
- `Card`
- `Badge`
- `StatCard`

Acceptance criteria:
- Components are typed.
- Components use readable Tailwind.
- Components are reusable.

## Phase 1 — Local Timer MVP

### 1.1 Build Pomodoro timer UI

Status: Complete

Note: Added the Pomodoro timer UI with work, break, and long-break modes, start/pause/reset controls, countdown progress, and visible completion state using `src/components/timer/*` and `src/lib/timer.ts`. Verified with `npm run lint`, `npm run typecheck`, `npm run build -- --webpack`, and a live local preview via `npm run dev`.

Create a timer with:
- Work mode.
- Break mode.
- Long-break mode.
- Start.
- Pause.
- Reset.
- Completion event.

Acceptance criteria:
- Timer counts down.
- User can switch modes.
- Completion is detected.
- UI is clear and sparse.

### 1.2 Add timer domain types

Status: Complete

Note: Added shared `TimerMode`, `TimerSession`, `WorkBlock`, and `LedgerEvent` types in `src/lib/types.ts`, updated timer helpers/components to consume the shared timer mode type, and stabilized `tsconfig.json` so `npm run typecheck` no longer depends on generated `.next` artifacts. Verified with `npm run lint`, `npm run typecheck`, and the existing successful `npm run build -- --webpack`.

Define shared TypeScript types for:
- Timer mode.
- Timer session.
- Work block.
- Ledger event.

Acceptance criteria:
- Core types are in shared type location.
- Timer components use shared types.
- No duplicated model shapes.

### 1.3 Add local completion handling

Status: Complete

Note: Work-mode timer completions now create in-memory `TimerSession`, `WorkBlock`, and `LedgerEvent` records through `src/lib/ledger.ts`, and the dashboard surfaces today’s work-block count plus a local ledger event list. Verified with `npm run lint`, `npm run typecheck`, `npm run build -- --webpack`, and the live preview on `http://localhost:3000`.

When a work timer completes, create an in-memory work block and ledger event.

Acceptance criteria:
- Completed work session increases today’s work-block count.
- Ledger list shows a work-earned event.
- Refresh persistence is not required yet.

### 1.4 Redesign home timer workspace

Status: Complete

Note: Redesigned the home screen into a unified single-workspace layout with a large central timer, integrated mode/status treatment, a quiet horizontal status strip, and softer local activity panels. Verified with `npm run lint`, `npm run typecheck`, `npm run build -- --webpack`, and the live preview on `http://localhost:3000`.

Acceptance criteria:
- Home screen feels like a single unified workspace, not a card dashboard.
- Timer is the clear visual focal point.
- Changing mode changes the timer accent/color treatment.
- Supporting stats are present but visually quiet.

## Phase 2 — Supabase Persistence

### 2.1 Add Supabase client

Status: Complete

Note: Installed `@supabase/supabase-js`, added the isolated client helper in `src/lib/supabase.ts`, documented `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `README.md`, and added `.env.example` with the expected variable names. Verified with `npm run lint` and `npm run typecheck`.

Install and configure Supabase client.

Acceptance criteria:
- Environment variables are documented.
- Supabase client is isolated in `src/lib/supabase.ts`.
- No service-role secret is exposed to client components.

### 2.2 Create database schema migration

Status: Complete

Note: Added the initial Supabase migration at `supabase/migrations/20260520233500_initial_schema.sql` with MVP tables for `timer_sessions`, `work_blocks`, `ledger_events`, `reward_rules`, and `reward_redemptions`, including `user_id` fields, timestamps, foreign keys, and practical indexes. Verified with `npm run lint` and `npm run typecheck`.

Create tables for:
- `timer_sessions`
- `work_blocks`
- `ledger_events`
- `reward_rules`
- `reward_redemptions`

Acceptance criteria:
- Migration is committed.
- Tables reflect the product spec.
- Timestamps and user IDs are included.

### 2.3 Persist completed Pomodoro

Status: Complete

Note: Wired completed work sessions to Supabase persistence using the browser client, anonymous workspace session bootstrap, initial workspace data loading, visible sync/save status messaging, and duplicate-write protection keyed to each completion event. Completed work sessions now upsert a timer session, work block, and ledger event, and saved data reloads on refresh. Verified with `npm run lint` and `npm run typecheck`.

On completed work session, write:
- Timer session.
- Work block.
- Ledger event.

Acceptance criteria:
- Data survives refresh.
- Failed writes are handled visibly.
- Duplicate completion writes are avoided.

## Phase 3 — Ledger and Rewards

### 3.1 Build ledger section

Status: Complete

Note: Kept the ledger in the home overview instead of creating a separate route, extracted the recent-activity UI into `src/components/ledger/LedgerEventList.tsx`, moved ledger deduping into `src/lib/ledger.ts`, and updated the product docs/codemap to reflect the overview-first architecture. Verified with `npm run lint` and `npm run typecheck`.

Create a ledger section within the home overview showing earned/spent events.

Acceptance criteria:
- Events display type, delta, source, and timestamp.
- Events are ordered newest first.
- Empty state is handled.

### 3.2 Build reward balance

Status: Complete

Note: Added persisted-ledger-derived reward balance calculation with weekday and weekend earning rates, negative balance support, weekend `1.5x` display state, and a compact home overview presentation. Verified with `npm run lint` and `npm run typecheck`.

Calculate current reward/work balance from ledger events.

Acceptance criteria:
- Balance is derived from persisted events.
- Dashboard shows current balance.
- Ledger remains source of truth.

### 3.3 Add reward redemption

Status: Complete

Note: Added reward reporting through the home overview dialog, including persisted `reward_redemptions` and `ledger_events`, duration-based reward reporting, constrained back-in-time day selection, normalized midday timestamps for reported reward days, and immediate balance updates after save. Negative reward balance is intentionally supported. Verified with `npm run lint` and `npm run typecheck`.

Allow user to redeem a reward.

Acceptance criteria:
- Redemption creates a reward redemption record.
- Redemption creates a ledger event.
- Balance updates after redemption.
- User may report reward spending even when the resulting balance goes negative.

## Phase 4 — Analytics

Note: Phase 4 is partially deferred by product decision on May 27, 2026. Existing completed analytics work remains in place, and the remaining analytics task will be revisited later when the feature is more actionable.

### 4.1 Add daily and weekly stats

Status: Complete

Note: The home overview now shows today’s completed work blocks and this week’s work blocks using persisted data while keeping the dashboard sparse. A streak was not added. Verified with `npm run lint` and `npm run typecheck`.

Show:
- Today’s completed work blocks.
- This week’s work blocks.
- Current streak if simple to implement.

Acceptance criteria:
- Stats derive from persisted work blocks or ledger events.
- Dashboard remains uncluttered.

### 4.2 Add productive time-of-day insight

Status: Deferred

Show most productive hour or time window.

Acceptance criteria:
- Uses timestamped work blocks.
- Handles insufficient data gracefully.

## Phase 5 — Quiet Task Management

Phase 4.2 is intentionally deferred. Phase 5 is unblocked by product decision.

### 5.1 Add task model and storage

Status: Complete

Note: Added canonical task storage with durable revision history via `supabase/migrations/20260528001500_add_tasks_and_revisions.sql`, shared task types/helpers in `src/lib/types.ts` and `src/lib/tasks.ts`, and a quiet human-editable task vault at `src/app/settings/tasks/page.tsx`. Verified with `npm run lint`, `npm run typecheck`, and `npm run build`.

Add quiet global task storage as the canonical task system.

Acceptance criteria:
- Tasks can be created, edited, completed, and archived.
- Canonical task records are stored in an agent-readable structured format.
- Task edits are durable and auditable.
- Task backlog is not shown prominently on dashboard.

### 5.2 Add today task surfacing

Status: Complete

Note: Added a lightweight daily focus layer via `supabase/migrations/20260528011500_add_daily_focus.sql`, daily-focus helpers in `src/lib/tasks.ts`, quiet today-list management in `src/app/settings/tasks/page.tsx`, and a compact today task surface on the home page in `src/app/page.tsx`. Verified with `npm run lint`, `npm run typecheck`, and `npm run build`.

Surface only critical/today tasks on the home page using a lighter-weight daily focus layer that references canonical tasks.

Acceptance criteria:
- Dashboard shows a small number of tasks.
- Daily task surfacing does not duplicate the canonical task store.
- Backlog remains accessible but quiet.

### 5.3 Add work-block task attribution flow

Status: Complete

Note: Added durable work-block attribution storage via `supabase/migrations/20260528023000_add_work_block_attributions.sql`, attribution persistence in `src/lib/workspace.ts`, recent-attribution and housekeeping helpers in `src/lib/tasks.ts`, ledger attribution display in `src/components/ledger/LedgerEventList.tsx`, and a required post-completion attribution dialog on the home page in `src/app/page.tsx`. Verified with `npm run lint`, `npm run typecheck`, and `npm run build`.

Add a post-completion attribution dialog so completed work blocks can be associated with one or more tasks for future review and duration estimation.

Acceptance criteria:
- After a completed work block, the app prompts the user to attribute that block to one or more tasks.
- The dialog defaults to the last task worked on when that task is still present in the daily focus list, even across days.
- If the last task worked on is no longer in the daily focus list, the dialog defaults to the highest-priority task at the top of the current daily focus list.
- A persistent `chores/housekeeping` option is always available for work that is not task-specific.
- An `other` option is available with a fillable field for work that does not match the visible task list.
- Multiple selections are allowed, and work-block attribution is evenly split across the selected tasks/options.
- Attribution data is stored durably so agents can later estimate task duration patterns from a user’s historical work style.

---

## Phase 5.5 — Core Work/Reward Refinements and Behavior Tracking

Status context: These tasks extend the existing timer/ledger/reward loop (Phases 1–3) and are independent of the Phase 6+ agent-contract roadmap. Implement in the order listed.

> All six tasks (5.5.1–5.5.6) are complete as of 2026-08-23. Verified with `npm run lint`, `npm run typecheck`, and `npm run build`; the two new migrations were applied to the live Supabase project.
>
> **Economy rework (2026-08-23):** the block/economy model was codified in `docs/ECONOMY.md` and implemented in `src/lib/economy.ts`. Key corrections over the initial 5.5.x implementation:
> - 1 block = 1 hour in every currency; partial blocks render with light + dark fill.
> - Work blocks = `work_minutes / 50`; reward earned at 20/30 min per work block (duration-derived, fixing the "1 reward block per work block" bug).
> - Long-flow sessions log total duration → multiple work blocks + proportional reward, then instantiate an extended break (10 min rest per 50 min work).
> - Settlement order (penalty → debt → positive): penalties are a senior claim, overspend becomes blue dashed-outline "debt" blocks, and both fill before positive reward accrues.
> - Behavior entries (indulgence/screen time/exercise) are now editable and deletable via the "⋯" menu, and `hardResetWorkspace` clears them.

### 5.5.1 Undo work blocks from Recent Activity

Status: Complete

Implementation guidance:
- Add a text-only "Delete" control (match the "Add manually" button styling under "Today's work") to each deletable work-block entry in `LedgerEventList`.
- Show it only for `work_earned` events that `isDeletableLedgerEvent` accepts.
- Clicking it opens a small "Are you sure?" micro-dialog.
- On confirm, remove the corresponding rows from Postgres: the ledger event plus its linked `timer_sessions`, `work_blocks`, and `work_block_attributions` rows.
- Use a hard delete for a true "undo" (see decision below).

Acceptance criteria:
- A visible "Delete" text button appears on deletable work-block rows.
- A "Are you sure?" micro-dialog gates the action.
- Confirming removes the entry from Recent Activity and its linked rows from Postgres.
- Today's work, reward balance, and weekly overview update after deletion.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Decision to confirm: hard DELETE vs the existing soft-delete (`softDeleteWorkEvent`). Default is hard delete for a real "undo"; soft-delete remains available for the existing correction flow.

### 5.5.2 Hard workspace reset in Settings

Status: Complete

Implementation guidance:
- Add a "Reset workspace" option to the Home Settings menu (or a dedicated settings route).
- Gate it behind a strict, irreversible warning before executing.
- On confirm, hard-delete all work/reward economy rows for the current user: `timer_sessions`, `work_blocks`, `work_block_attributions`, `ledger_events`, `reward_rules`, `reward_redemptions`, and (once added) `behavior_events`.
- Leave the task vault (`tasks`, `task_revisions`, `daily_focus_lists`, `daily_focus_items`) intact (see decision below).

Acceptance criteria:
- Reset zeroes today's work, reward balance, weekly overview, and clears Recent Activity.
- A prominent "cannot be undone" warning gates the action.
- Reset does not touch canonical task data.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Decision to confirm: reset scope = work/reward economy only, NOT tasks/daily focus.

### 5.5.3 Behavior-tracking subsystem: schema and entry surface

Status: Complete

Implementation guidance:
- Add a migration for a new `behavior_events` table:
  - `id`, `user_id` (FK auth.users), `behavior_type` (check in `indulgence | screen_time | exercise`), `occurred_at`, `duration_minutes`, `penalty_minutes`, `note`, soft-delete fields (`deleted_at`, `deleted_by_actor_label`, `deletion_reason`), `created_at`.
  - RLS policies (select/insert/update own) matching the existing pattern; index on `(user_id, occurred_at desc)`.
- Add shared types and helpers under `src/lib/behaviors.ts`.
- Add a "Behavior tracking" text button under "Spend reward".
- Popup with three selectors:
  - Indulgent behavior: no extra data; records a flat −60 min penalty.
  - Screen time: collect date + total screen minutes; apply `penalty = max(0.5 * ST, ST - 60)` (minutes). Examples: 60 → 30, 120 → 60, 150 → 90.
  - Exercise: collect workout length; records +1:1 positive reward minutes.

Acceptance criteria:
- Three behavior types are recordable via the popup, each collecting the correct fields.
- Indulgence → −60 min; screen time → formula above; exercise → +length minutes.
- Entries persist durably and survive refresh.
- Screen-time and exercise inputs are tracked separately (distinct `behavior_type` rows).

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 5.5.4 Behavior-aware reward accounting and color typing

Status: Complete

Implementation guidance:
- Extend reward-balance computation to include behavior events: exercise adds +minutes; indulgence/screen-time subtract penalty minutes.
- Add color tokens: periwinkle (exercise, positive) and penalty purple to the palette module (hexes tunable).
- Reward-balance display rule: show blue (work reward) + periwinkle (exercise) blocks when net is positive; show purple penalty blocks only when the net balance is negative. Penalties are always recorded but hidden from the balance section while positive.

Acceptance criteria:
- Exercise minutes increase the spendable reward balance 1:1.
- Indulgence and screen-time penalties reduce the reward balance.
- Periwinkle = exercise blocks; purple = penalty blocks.
- Purple penalty blocks appear in the reward-balance section only when the net balance is negative.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 5.5.5 Restructure Weekly Overview (Work / Reward / Penalty)

Status: Complete

Implementation guidance:
- Rewrite the "Weekly overview" module into three sections: Work, Reward, Penalty.
- Work: red blocks = weekly work blocks; textual count of total hours.
- Reward: blue (work-derived) + periwinkle (exercise) blocks; textual summary shows "total:" and "net:" (net = total − penalties).
- Penalty: purple blocks = weekly penalty minutes (indulgence + screen time).
- Add "destroyed reward blocks": greyed-out blue blocks with a purple border and a purple "X" overlay, representing reward blocks consumed by penalties.

Acceptance criteria:
- Three clean sections with per-category block counts and hour totals.
- Correct color mapping: Work red, Reward blue + periwinkle, Penalty purple.
- Reward shows "total:" and "net:" values.
- Destroyed-reward blocks render with the greyed-blue + purple-border + purple-X treatment.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 5.5.6 Rolling timer with overage mode

Status: Complete

Implementation guidance:
- After a work session completes: play the chime but do NOT stop or auto-persist. Switch to "overage mode": the timer begins counting up with a "+" prefix (e.g. "+00:32").
- In overage mode, replace "Pause timer" with "End session".
- On "End session", show a popup: "Did this session represent uninterrupted work?"
  - "Yes" → log the total elapsed duration (planned 50 min + overage) as the work block.
  - "No" → log a single standard work block (50 min).
- After this choice, proceed into the existing persistence + attribution flow using the chosen duration.

Acceptance criteria:
- Work completion rings the alarm and rolls into counting-up overage mode.
- "+" is prepended to the overage count.
- "Pause timer" becomes "End session" during overage.
- Ending the session prompts the uninterrupted-work question; "Yes" logs total elapsed, "No" logs a single block.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Decision to confirm: whether overage time earns additional reward (prorated minutes) or only affects logged work duration (default: duration only). Scope is work mode only; break/long-break keep existing fixed-completion behavior.

---

## Phase 6 — Task Semantics and Agent-Ready Contracts

Phase 6 turns the completed quiet task-management layer into a stable substrate for agent planning. Do not add AI behavior yet. The goal is to remove ambiguity from task state, daily focus state, task history, and lightweight task relationships so later agents can reason over the data safely.

### 6.1 Harden task and daily-focus status vocabularies

Status: Complete

Note (2026-08-23): Unified the status model. `task_status` stays
`open | in_progress | blocked | completed | archived` (already matched the DB — no
task migration needed). `focus_status` is now `planned | active | done | deferred | dropped`
(added `dropped`; migrated the CHECK constraint) with a `carried_forward boolean`
flag on `daily_focus_items` instead of a status value. Added `TASK_STATUS_LABEL` and
`FOCUS_STATUS_LABEL` maps in `src/lib/tasks.ts`, `dropped` + `carried_forward` in
`src/lib/types.ts`, and wired the transitions so they write the correct focus status:
add→`active`, complete→`done`, defer→`deferred`, drop/archive→`dropped`. The spec's
old "active/in_progress/completed/carried_forward/skipped" focus list was superseded
by the two-vocabulary model documented in `docs/PRODUCT_SPEC.updated.md`. Verified
with `npm run typecheck`, `npm run lint`, and `npm run build`. Migration
`20260823000002_add_focus_status_dropped_and_carried_forward.sql` must be applied to
the live Supabase project before this code runs (the app now writes `dropped` and
selects `carried_forward`).

Normalize the allowed values for task status, task priority, and `daily_focus_items.focus_status`.

Implementation guidance:
- Add or update shared TypeScript unions in `src/lib/types.ts`.
- Add helper constants and label maps in `src/lib/tasks.ts` or a nearby task-domain module.
- Ensure task status distinguishes at least: active, completed, blocked, deferred, archived.
- Ensure focus status distinguishes at least: planned, in_progress, completed, deferred, blocked, carried_forward, skipped.
- Keep labels human-readable in the UI, but store stable machine-readable values.
- Do not introduce projects or strategic arcs in this task.

Acceptance criteria:
- All task and focus status values used in the app come from shared typed constants.
- Existing create/edit/complete/archive flows still compile and behave correctly.
- Daily focus status is explicit enough to explain what happened to the daily plan.
- The settings task page and home daily-focus surface render valid labels for every status.
- Invalid status strings are not introduced in new code.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 6.2 Add task relationship support for lightweight subtasks

Status: Complete

Note (2026-08-23): `parent_task_id` already existed in the schema and types. Added
an index (`tasks_user_id_parent_task_id_idx`) via migration
`20260823000004`, a `fetchImmediateChildTasks` helper in `src/lib/tasks.ts`, and a
parent task + child subtask display section in the task settings page (shows the
parent as a read-only badge, subtasks as a clickable list). No cyclic-hierarchy
prevention beyond existing self-parent avoidance in the UI. Verified with `npm run
lint` + `npm run typecheck` + `npm run build`.

Add optional task-to-task hierarchy support so the system can model `subtask -> task` without introducing full project objects yet.

Implementation guidance:
- Inspect the existing Supabase task migration before changing schema.
- If `parent_task_id` does not already exist, add a migration with nullable `parent_task_id` referencing `tasks.id`.
- Add practical indexes for `user_id` and `parent_task_id`.
- Update shared `Task` types and task mapping helpers.
- Add basic UI support in the task settings page for viewing a parent task when present. Full drag-and-drop hierarchy is not required.
- Avoid adding project or strategic arc tables in this phase.

Acceptance criteria:
- A task can optionally reference a parent task.
- Parent-child relationships are user-scoped and do not break row-level security assumptions.
- Existing tasks without a parent still work.
- Query helpers can fetch immediate children for a task.
- No cyclic hierarchy prevention is required beyond avoiding obvious self-parent assignment in UI/helper code.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 6.3 Define `agent_payload_json` schema v1

Status: Complete

Note (2026-08-23): Created `src/lib/agentPayload.ts` with `TaskAgentPayloadV1` type
(fields: schema_version, summary, context, next_action, known_blockers,
source_notes, tags, estimated_remaining_blocks, last_agent_reviewed_at), a
`parseAgentPayloadV1` helper that tolerates null/malformed/older payloads and falls
back to a default empty v1, and `createAgentPayloadV1` for new payloads. No UI
changes — this is the data contract layer only. Verified with `npm run lint` + `npm
run typecheck` + `npm run build`.

Turn `agent_payload_json` from a loose JSON field into a documented, versioned agent-readable context object.

Implementation guidance:
- Add a `TaskAgentPayloadV1` type.
- Include fields such as:
  - `schema_version`
  - `summary`
  - `context`
  - `next_action`
  - `known_blockers`
  - `source_notes`
  - `last_agent_reviewed_at`
  - `tags`
  - `estimated_remaining_blocks`
- Add safe parse and serialize helpers that tolerate missing or older payloads.
- Keep the payload compact. Do not store full chat transcripts in task payloads.
- Document the schema in `docs/PRODUCT_SPEC.md`.

Acceptance criteria:
- Task reads never crash when `agent_payload_json` is null, malformed, or older.
- Task writes preserve existing unknown JSON keys where practical.
- New helper functions produce a valid v1 payload.
- No UI depends directly on raw JSON string manipulation.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 6.4 Add task revision query helpers

Status: Complete

Note (2026-08-23): Added `fetchRecentRevisionsByUser` (by user, limit N),
`fetchRevisionsByDateRange` (by [after, before]), and `splitRevisionsByActor`
(human vs agent/system) to `src/lib/tasks.ts`. The settings page already had a
revision history display for selected tasks. Verified with `npm run lint` + `npm run
typecheck` + `npm run build`.

Make durable task history easy for future agents to retrieve without hand-writing ad hoc queries.

Implementation guidance:
- Add helpers for fetching recent revisions by task, by user, and by date range.
- Return typed records with normalized `before_json` and `after_json` values.
- Add a small internal display surface in settings for a task’s recent revision history.
- Keep the UI sparse. This is mainly an agent/debugging affordance.

Acceptance criteria:
- A task detail or settings surface can show recent revisions for a selected task.
- Revision helpers can return the last N human-made and agent-made changes separately.
- Existing task mutations still create revision rows.
- Revision display handles empty history.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 6.5 Add daily-focus carry-forward metadata

Status: Complete

Note (2026-08-23): Added `status_reason text` and `carried_from_focus_item_id uuid`
(nullable) to `daily_focus_items` via migration
`20260823000003_add_focus_item_carry_forward_metadata.sql`. Updated
`DailyFocusItem` type, select columns, and `updateDailyFocusItem` to handle
`statusReason`. The transition helpers now write status reasons:
defer→reason from caller, done→"Completed from daily focus", drop→"Dropped from
daily focus" (or caller-provided). `carried_from_focus_item_id` support added
for later version. Verified with `npm run lint` + `npm run typecheck` +
`npm run build`. Migration must be applied to live Supabase.

Capture why a daily focus item moved forward, was deferred, or was dropped.

Implementation guidance:
- Inspect existing `daily_focus_items` schema.
- If needed, add nullable fields such as `status_reason`, `carried_from_focus_item_id`, and `resolved_at`.
- Update daily focus helpers to preserve a short reason when items are deferred, skipped, blocked, or carried forward.
- Do not build automated carry-forward logic yet. This task only prepares the data contract.

Acceptance criteria:
- Daily focus items can store a short machine-readable status plus a short human-readable reason.
- Carry-forward lineage can be represented without duplicating canonical task content.
- Existing daily focus list rendering still works when metadata is empty.
- Future retrieval helpers can determine whether an item repeatedly resurfaced.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 7 — Structured Planning Retrieval v0

Phase 7 creates the read-only context packet used when the user starts daily planning. This phase should be deterministic and database-backed. Do not call an external language model yet.

### 7.1 Build planning context query helpers

Status: Complete

Note (2026-08-23): Created `src/lib/planning.ts` with the `buildPlanningContextPacket()`
entry point and typed section sub-queries. The packet covers: today's focus,
yesterday's focus, unresolved carryover, recently completed, recent attributions,
deadline pressure (≤14 days), and backlog pressure (open count by priority).
All queries are user-scoped; every section returns an empty array/default when data
is absent. The `PlanningContextPacketV1` type is JSON-serializable and carries only
IDs + short summaries, not raw DB rows. Verified with `npm run lint` + `npm run
typecheck` + `npm run build`.

Create the database retrieval layer for “let’s plan the day.”

Implementation guidance:
- Add helpers under `src/lib/planning.ts` or `src/lib/agent/planning-context.ts`.
- Retrieve:
  - today’s daily focus list
  - yesterday’s daily focus list
  - unresolved carryover items
  - recent completed tasks
  - recent work-block attributions
  - deadline-pressure tasks
  - backlog-pressure tasks
  - user-created or recently edited tasks
- Keep each query small and scoped to the current user.
- Avoid full-database scans.

Acceptance criteria:
- A single function can retrieve the raw ingredients for daily planning.
- Query helpers are typed and return predictable empty arrays when no data exists.
- Retrieval uses existing canonical tasks, daily focus items, task revisions, and work-block attributions.
- The app still works for a new user with little or no history.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 7.2 Assemble an agent planning context packet

Status: Planned

Compress retrieved records into a small, serializable context object that an agent or deterministic planner can consume.

Implementation guidance:
- Define a `PlanningContextPacketV1` type.
- Include sections:
  - `date`
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
- Include record IDs and short summaries, not entire raw database rows.
- Keep output stable enough to snapshot manually during debugging.

Acceptance criteria:
- The context packet can be JSON-stringified without circular references.
- The packet contains enough IDs for proposed mutations to reference source records.
- The packet does not expose service-role secrets or unrelated user data.
- New and sparse accounts produce a valid packet with useful empty states.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 7.3 Add planning context preview in settings

Status: Planned

Add a quiet internal preview page so a human or coding agent can inspect the planning context before any AI feature uses it.

Implementation guidance:
- Add a settings route such as `src/app/settings/agent-context/page.tsx`.
- Show the current `PlanningContextPacketV1` in readable sections.
- Include a collapsible JSON view for debugging.
- This page is not part of the main home experience.

Acceptance criteria:
- The preview page loads for the current anonymous workspace/user.
- Each context packet section has an empty state.
- The JSON view matches the same packet used by the planner.
- The page uses existing UI primitives and does not become visually dominant.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 7.4 Add deterministic candidate daily-plan builder

Status: Planned

Build a non-AI ranking helper that proposes a candidate daily focus list from the context packet.

Implementation guidance:
- Add a pure helper that scores candidate tasks.
- Prefer tasks already in today’s focus list, unresolved carryover, near deadlines, repeated resurfacing, and recently active work.
- Avoid overfilling the day. Return primary, secondary, and intentional deferral candidates.
- Include score reasons for transparency.
- Do not write any database changes in this task.

Acceptance criteria:
- The helper returns a small candidate plan from a context packet.
- Each candidate includes a reason string.
- The helper handles empty state gracefully.
- The helper does not mutate tasks or daily focus records.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 7.5 Add repeated-deferral and eat-the-frog flags

Status: Planned

Identify tasks that keep appearing without resolution and flag them for explicit disposition.

Implementation guidance:
- Use daily focus history, focus statuses, task revisions, and recent attributions.
- Add helper output such as:
  - `needs_disposition`
  - `deferral_count`
  - `last_completed_work_at`
  - `recommended_dispositions`
- Recommended dispositions should include: do today, schedule later with reason, split, mark blocked, lower priority, abandon, or move to someday.
- Keep this as retrieval/scoring metadata. Do not force UI changes beyond preview display unless simple.

Acceptance criteria:
- The planning context packet can identify repeated deferrals.
- The candidate daily plan builder uses these flags in its reason text.
- Tasks with no history are not falsely flagged.
- The logic is deterministic and explainable.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 8 — Proposed Task Mutation Protocol

Phase 8 introduces the core safety mechanism: the agent may propose changes, but the user must approve before any write occurs.

### 8.1 Add proposal batch and proposed mutation schema

Status: Planned

Create durable storage for stateful proposed task changes.

Implementation guidance:
- Add a Supabase migration for two tables:
  - `task_mutation_proposal_batches`
  - `task_mutation_proposals`
- Suggested batch fields:
  - `id`
  - `user_id`
  - `source`
  - `status`
  - `context_packet_json`
  - `created_at`
  - `updated_at`
  - `resolved_at`
- Suggested proposal fields:
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
- Use statuses such as pending, approved, rejected, modified, applied, failed.
- Include row-level security policies consistent with existing user-scoped tables.

Acceptance criteria:
- Proposal batches can store the context packet used to generate them.
- Individual proposals can represent create, update, status, priority, defer, complete, focus-list, note, and payload changes.
- Proposals are durable across refresh.
- No proposal automatically mutates canonical task state.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 8.2 Add proposed mutation TypeScript contracts and validators

Status: Planned

Create typed application-level contracts for proposal payloads before wiring UI.

Implementation guidance:
- Add discriminated unions such as `CreateTaskProposal`, `UpdateTaskProposal`, `ChangeTaskStatusProposal`, `ChangeTaskPriorityProposal`, `DeferTaskProposal`, `CompleteTaskProposal`, `DailyFocusProposal`, and `UpdateAgentPayloadProposal`.
- Add safe parse helpers for `payload_json`.
- Add conversion helpers from candidate daily plan output into proposal payloads.
- Keep validators dependency-light unless a validation library already exists in the repo.

Acceptance criteria:
- Every supported proposal type has a typed payload shape.
- Invalid or unknown proposal payloads render as recoverable errors rather than crashing.
- Proposal type labels and descriptions are centralized.
- Future AI output can target these same contracts.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 8.3 Build proposal review cards

Status: Planned

Create reusable UI cards for pending task mutation proposals.

Implementation guidance:
- Add components under `src/components/planning/` or `src/components/proposals/`.
- Each card should show:
  - proposal type
  - affected task or focus item
  - before/after summary where applicable
  - reason
  - approve
  - reject
  - modify
- Use existing `Button`, `Card`, and `Badge` primitives.
- Keep the UI compact. This is a planning control surface, not a giant dashboard.

Acceptance criteria:
- Pending proposals render as separate review cards.
- Approve, reject, and modify actions are visible for each proposal.
- Unknown proposal types have a safe fallback display.
- Cards can be rendered from stored database proposal rows.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 8.4 Add proposal modification flow

Status: Planned

Allow the user to edit a proposal before approval.

Implementation guidance:
- Start with simple modal or inline edit states.
- For create/update task proposals, allow editing title, description, priority, due date, area, and reason.
- For daily focus proposals, allow editing position and note.
- Store modified payload back into the proposal row and mark status as modified or keep pending with `modified_at`, whichever fits the schema.
- Do not apply the mutation yet.

Acceptance criteria:
- User can modify supported proposal payloads before approval.
- Modified proposals retain the original reason or record a change reason.
- Unsupported proposal types can still be approved or rejected.
- Refresh preserves modified proposal content.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 8.5 Apply approved proposals transactionally

Status: Planned

Implement the approved-write step that mutates canonical task and daily-focus state only after user approval.

Implementation guidance:
- Add application helpers that apply approved proposals.
- Use the existing Supabase client patterns in the repo.
- Each applied proposal should create appropriate `task_revisions` rows.
- Daily focus proposals should reference canonical tasks and avoid duplicating task content.
- Make application idempotent enough to avoid duplicate writes from double-clicks or retries.
- Surface failed application visibly and leave the proposal recoverable.

Acceptance criteria:
- Approved create/update/status/priority/defer/complete proposals mutate canonical task records correctly.
- Approved daily focus proposals update `daily_focus_lists` and `daily_focus_items` correctly.
- Applied task changes create durable revision rows with `actor_type` set appropriately.
- Re-running an already applied proposal does not duplicate the mutation.
- Failed proposals show a recoverable error state.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 8.6 Add proposal batch summary and cleanup controls

Status: Planned

Add lightweight controls for reviewing and dismissing old proposal batches.

Implementation guidance:
- Show pending, applied, rejected, and failed counts per batch.
- Allow dismissing fully resolved batches from the active review surface.
- Do not delete proposal history by default.
- Add a quiet settings/history surface if the home planning surface would get noisy.

Acceptance criteria:
- Users can distinguish current proposals from stale proposal batches.
- Resolved proposal batches do not clutter the main planning workflow.
- Proposal history remains available for debugging.
- Cleanup does not delete canonical task revisions.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 9 — Daily Planning Mediator v0

Phase 9 creates the first user-facing planning agent surface. It should use the structured context and proposal protocol. The first version may be deterministic and provider-neutral; do not block on external model integration.

### 9.1 Add compact planning surface to Home

Status: Planned

Add a small “Plan the day” surface near the daily focus area.

Implementation guidance:
- The home surface should not become a full chat app.
- Add a button or compact panel that starts a planning session.
- Show today’s recommended primary tasks, secondary tasks, and intentional deferrals after generation.
- Link to the full proposal review UI if needed.
- Preserve the timer as the visual focal point of Home.

Acceptance criteria:
- User can start daily planning from Home.
- Planning output appears without overwhelming the timer workspace.
- Empty states are clear for new users.
- Existing timer, ledger, reward, and daily focus behavior remains intact.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 9.2 Add planning session records

Status: Planned

Persist planning sessions so the app can explain how a daily plan was formed.

Implementation guidance:
- Add a migration for `planning_sessions`.
- Suggested fields:
  - `id`
  - `user_id`
  - `date`
  - `status`
  - `context_packet_json`
  - `summary_markdown`
  - `created_at`
  - `updated_at`
  - `completed_at`
- Link proposal batches to planning sessions if practical.
- Do not store long freeform chat logs yet unless necessary.

Acceptance criteria:
- Starting planning creates or reuses a planning session for the day.
- The session stores the context packet used for recommendations.
- The session can link to generated proposal batches.
- Sessions are user-scoped.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 9.3 Generate planning proposal batches from context

Status: Planned

Wire the deterministic candidate plan builder into proposal batch creation.

Implementation guidance:
- Add a server or client helper consistent with the current architecture.
- Convert candidate primary/secondary/deferral recommendations into pending proposal rows.
- Include reasons from the candidate daily-plan builder.
- Do not apply proposals automatically.
- If an external AI provider is later added, it should output into the same proposal contracts.

Acceptance criteria:
- Starting planning can create a proposal batch from the current context packet.
- Generated proposals are pending and reviewable.
- The user can approve/reject/modify before writes occur.
- No task or focus record is changed until approval.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 9.4 Add a minimal planning conversation note field

Status: Planned

Let the user add instructions or context to the planning session without building a full chat system.

Implementation guidance:
- Add a short freeform input such as “Anything to account for today?”
- Store the note on the planning session.
- Include the note in the context packet or proposal batch metadata.
- Keep the input intentionally small and scoped to planning.

Acceptance criteria:
- User can add planning context before generating proposals.
- The note is stored durably with the planning session.
- The note is visible when reviewing the session.
- The note does not directly mutate tasks.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 9.5 Finalize daily focus from approved proposals

Status: Planned

Complete the loop from planning session to updated daily focus list.

Implementation guidance:
- Add a “Finalize daily focus” action after approved proposals have been applied.
- Mark the planning session complete.
- Ensure the resulting daily focus list has clear positions and focus statuses.
- Generate a short summary markdown for the planning session.

Acceptance criteria:
- User can complete a planning session after applying approved proposals.
- Today’s daily focus list reflects the approved plan.
- Reopening Home shows the finalized focus.
- The planning session stores a concise summary of what changed.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 10 — Daily Memory Documents

Phase 10 builds continuity. The daily memory document should be short, database-backed, and useful for tomorrow’s planning context.

### 10.1 Add `daily_memory_documents` schema

Status: Planned

Create storage for one daily continuity document per user per date.

Implementation guidance:
- Add a Supabase migration for `daily_memory_documents`.
- Suggested fields:
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
- Add a unique constraint on `user_id` and `date`.
- Add row-level security policies consistent with existing user-scoped tables.

Acceptance criteria:
- A user can have at most one daily memory document per date.
- The table supports draft and finalized states.
- Empty markdown fields are handled safely.
- Schema is documented in `docs/PRODUCT_SPEC.md`.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 10.2 Create morning seed helper

Status: Planned

Generate the starting memory for today from yesterday’s memory and current planning context.

Implementation guidance:
- Add helper functions under `src/lib/daily-memory.ts`.
- Retrieve yesterday’s finalized memory if present.
- Include ongoing projects/areas, current focus, concerns, recommended starting points, and watch items.
- Use deterministic markdown templates for now.
- Do not call external AI yet.

Acceptance criteria:
- A daily memory document can be created or updated for today.
- Morning seed uses yesterday’s carry-forward section when present.
- Sparse accounts still get a useful empty-state seed.
- The helper is idempotent for repeated calls on the same date.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 10.3 Append planning-session updates to daily memory

Status: Planned

Record meaningful daily plan formation events in the memory document.

Implementation guidance:
- After a planning session is finalized, update `planning_log_markdown`.
- Capture approved tasks, rejected proposals, intentional deferrals, and major priority changes.
- Keep the entry concise. Do not paste raw proposal JSON.
- Include IDs in `source_snapshot_json` where helpful for traceability.

Acceptance criteria:
- Finalizing a planning session updates the day’s memory document.
- The planning log explains what changed and why.
- Re-running finalization does not duplicate the same log entry.
- Proposal and task IDs remain available in structured snapshot metadata.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 10.4 Append work-session updates after attribution

Status: Planned

Use work-block attribution events to keep the day’s continuity record current.

Implementation guidance:
- After a completed work block is attributed, append or regenerate a concise work-session entry.
- Include task titles, attributed minutes, and whether work advanced planned focus or unplanned work.
- Keep this in a helper so later agents can call it consistently.
- Do not block timer completion if memory update fails; surface a quiet warning if needed.

Acceptance criteria:
- Attributed work blocks can update `work_session_log_markdown`.
- The log distinguishes planned focus work from housekeeping or other work.
- Failures do not corrupt ledger or attribution records.
- Duplicate attribution updates do not create duplicate memory entries.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 10.5 Add end-of-day consolidation action

Status: Planned

Create a manual consolidation action before introducing scheduling.

Implementation guidance:
- Add a settings or memory archive action to finalize today or yesterday.
- Consolidate planning log, work session log, focus outcomes, blocked/deferred items, and carry-forward notes.
- Store output in `final_summary_markdown` and `carry_forward_markdown`.
- Mark status finalized and set `finalized_at`.
- Do not add Supabase scheduled jobs yet.

Acceptance criteria:
- User can manually finalize a daily memory document.
- Finalized memory includes starting context, planned focus, notable changes, completed/advanced work, deferred/blocked/avoided work, user feedback/preferences, and carry-forward.
- Finalization can be safely re-run or clearly prevented after finalization.
- Tomorrow’s morning seed can consume the carry-forward section.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 10.6 Add daily memory archive surface

Status: Planned

Give the user a quiet place to inspect and edit daily memory documents.

Implementation guidance:
- Add a settings route such as `src/app/settings/daily-memory/page.tsx`.
- List recent daily memory documents.
- Allow viewing one document by date.
- Allow editing markdown fields while preserving structured snapshot JSON.
- Keep this out of the main Home flow unless later needed.

Acceptance criteria:
- User can view recent memory documents.
- User can inspect a single day’s memory sections.
- User can edit markdown content for correction.
- Empty and sparse memory states are handled gracefully.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 11 — Internal Brief Shell

Phase 11 creates the brief surface using internal continuity only. External news, market research, and notification loops remain deferred.

### 11.1 Add brief route shell

Status: Planned

Create the route and layout for a future newsletter-style brief.

Implementation guidance:
- Add `src/app/brief/page.tsx` or an equivalent route.
- Use existing UI primitives and product design language.
- Pull from daily memory, planning sessions, daily focus, and recent work history.
- Do not fetch external news or market data.

Acceptance criteria:
- Brief route renders for the current user.
- It has clear empty states when daily memory does not exist.
- It does not interfere with Home.
- Navigation to the brief is subtle.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 11.2 Render internal brief sections

Status: Planned

Render the internal-only sections that are already supported by app data.

Implementation guidance:
- Include:
  - Morning opener placeholder
  - Internal signals
  - Where we left off
  - Risks/open loops
  - Recommended daily focus
- External Signals and Market/Company Breakdown should render as disabled or placeholder sections.
- Keep copy brief and concrete.

Acceptance criteria:
- Brief displays useful internal continuity from existing records.
- External sections are clearly not active yet.
- Recommended daily focus matches approved or current daily focus items.
- Risks/open loops use blocked, stale, or repeated-deferral tasks where available.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 11.3 Add brief opened/read state

Status: Planned

Track whether the user opened the brief without building notifications yet.

Implementation guidance:
- Add or reuse a `daily_briefs` table if it exists.
- If not, add a small migration with:
  - `id`
  - `user_id`
  - `date`
  - `source_daily_memory_document_id`
  - `summary_markdown`
  - `opened_at`
  - `created_at`
  - `updated_at`
- Mark `opened_at` when the route is viewed or when an explicit button is clicked.
- Do not add notification nudges.

Acceptance criteria:
- A daily brief record can be created or retrieved for a date.
- Opening the brief can set `opened_at`.
- The app can distinguish opened and unopened briefs.
- No notification system is introduced.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 11.4 Add internal brief generation helper

Status: Planned

Generate a stored markdown brief from daily memory and planning context.

Implementation guidance:
- Add deterministic brief-generation helper.
- Use daily memory sections, current daily focus, recent work attributions, and unresolved risks.
- Store generated markdown in `daily_briefs.summary_markdown` or equivalent.
- Do not overwrite user-edited content unless explicitly requested.

Acceptance criteria:
- User can generate or refresh an internal brief.
- Generated brief is stored structurally.
- Refreshing a brief does not duplicate records for the same date.
- Existing daily memory remains the source context.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 12 — Project OS Foundations

Phase 12 begins the expansion from Personal OS to Project OS. Do not start this phase until daily planning and daily memory are stable.

### 12.1 Add strategic arcs and projects schema

Status: Planned

Introduce explicit objects for project-level organization.

Implementation guidance:
- Add tables such as `strategic_arcs` and `projects`.
- Suggested `strategic_arcs` fields:
  - `id`
  - `user_id`
  - `name`
  - `description`
  - `status`
  - `created_at`
  - `updated_at`
- Suggested `projects` fields:
  - `id`
  - `user_id`
  - `strategic_arc_id`
  - `name`
  - `description`
  - `status`
  - `current_summary`
  - `created_at`
  - `updated_at`
- Keep these user-scoped for now.

Acceptance criteria:
- Strategic arcs and projects can be created and listed.
- Projects can optionally link to strategic arcs.
- No team/multi-user workflow is introduced.
- Schema is documented in `docs/PRODUCT_SPEC.md`.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 12.2 Link tasks to projects

Status: Planned

Allow canonical tasks to connect to project objects while preserving the existing task vault.

Implementation guidance:
- Add nullable `project_id` to `tasks` if not already present.
- Update task types and mapping helpers.
- Add task settings controls for selecting a project.
- Do not require every task to have a project.

Acceptance criteria:
- A task can optionally link to a project.
- Existing unlinked tasks continue working.
- Daily focus and attribution flows still use canonical tasks.
- Project-linked tasks can be queried efficiently.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 12.3 Add project state page

Status: Planned

Create a quiet project detail surface.

Implementation guidance:
- Add project list and project detail routes under settings or a dedicated project area.
- Show linked tasks, recent work attributions, recent revisions, and current summary.
- Keep editing minimal.
- Do not add source ingestion or entity graph yet.

Acceptance criteria:
- User can open a project and see related tasks.
- Project page can answer basic state questions from structured records.
- Recent work and task changes appear in a concise timeline.
- Empty projects render cleanly.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 12.4 Add project memory notes

Status: Planned

Create a lightweight project continuity layer before shared company memory.

Implementation guidance:
- Add a `project_memory_notes` table or a simple markdown field on projects, whichever fits the codebase better.
- Capture current state, recent changes, open loops, and next actions.
- Allow manual editing.
- Do not automatically promote daily memory into project memory yet.

Acceptance criteria:
- Each project can have a concise current-state note.
- Notes are editable.
- Project notes can be included in future planning context packets.
- No entity graph or source ingestion is required.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 13 — Source and Entity Foundations

Phase 13 prepares company memory and future market/research agents. Keep this manual and structured. Do not build autonomous web ingestion yet.

### 13.1 Add source materials schema

Status: Planned

Create storage for manually added source materials.

Implementation guidance:
- Add a `source_materials` table.
- Suggested fields:
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
- Keep file upload handling out of scope unless already easy in the app.

Acceptance criteria:
- User can create and list source materials manually.
- Sources can optionally link to projects.
- Source summaries are editable markdown.
- No external scraping or web search is introduced.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 13.2 Add related entities schema

Status: Planned

Create a basic entity layer for cities, companies, agencies, people, grants, and other named objects.

Implementation guidance:
- Add a `related_entities` table.
- Suggested fields:
  - `id`
  - `user_id`
  - `entity_type`
  - `name`
  - `summary_markdown`
  - `created_at`
  - `updated_at`
- Add join tables later as needed. Start with the minimum useful model.

Acceptance criteria:
- User can create and list related entities.
- Entities have stable IDs and types.
- Entity summaries are editable.
- No graph traversal is required yet.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 13.3 Link entities to projects, tasks, and sources

Status: Planned

Build the first version of the agent-legible graph as explicit links.

Implementation guidance:
- Add a generic link table or separate join tables for:
  - project-entity
  - task-entity
  - source-entity
- Store `relationship_type` and optional note.
- Keep traversal shallow.
- Do not add embeddings in this phase.

Acceptance criteria:
- Entities can be linked to projects, tasks, and source materials.
- Links are typed and user-scoped.
- Project and task pages can display linked entities.
- The planning context packet can include nearby linked entities when available.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 13.4 Add manual source-to-task proposal path

Status: Planned

Let a source imply a proposed task without automatically creating one.

Implementation guidance:
- Add a control on source detail pages to create a pending task mutation proposal.
- The proposal should use the existing proposal protocol from Phase 8.
- Include source ID and reason in proposal metadata.
- Do not bypass approval.

Acceptance criteria:
- User can turn a source implication into a pending create-task proposal.
- The proposal can be approved, rejected, or modified using existing review cards.
- Approved proposals create canonical tasks and task revisions.
- Source provenance remains traceable.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 14 — External Signals and Full Briefing

Phase 14 is intentionally later. Do not begin until the internal brief, daily memory, proposal protocol, and source/entity structures are stable.

### 14.1 Add external signal classification model

Status: Planned

Implement the three-tier rubric for external information.

Implementation guidance:
- Add types for Morning Curiosity, Strategic Signal, and Actionable Trigger.
- Add scoring fields for strategic relevance, actionability, urgency, confidence, and novelty.
- Start with manual entry/classification.
- Do not fetch external news yet.

Acceptance criteria:
- External signals can be classified manually.
- Actionable triggers can generate pending proposals, not accepted tasks.
- Signal records can link to source materials and entities.
- The brief can display classified signals when present.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 14.2 Add external signal section to brief

Status: Planned

Wire classified signals into the brief.

Implementation guidance:
- Render Morning Curiosity in the opener.
- Render Strategic Signals in external context.
- Render Actionable Triggers with proposal affordances.
- Keep disabled or empty states clear when no signals exist.

Acceptance criteria:
- Brief sections render manually entered classified signals.
- Actionable triggers do not mutate tasks without approval.
- Signal relevance and confidence are visible.
- Internal brief sections remain usable without signals.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

### 14.3 Add provider boundary for future news/search ingestion

Status: Planned

Prepare a clean boundary for later web/news ingestion without implementing broad autonomous search.

Implementation guidance:
- Add interfaces for external signal providers.
- Include mock/manual provider implementation.
- Keep API keys out of client components.
- Document required environment variables only when a real provider is added.

Acceptance criteria:
- App has a provider interface for future ingestion.
- Manual/mock provider can populate the same signal contracts.
- No real external provider is required for local build.
- No secrets are exposed client-side.

Verification:
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Phase 15 — Role-Specific Assistants and Multi-Agent Layer

Phase 15 is long-view only. Do not implement until structured company context is stable.

### 15.1 Define assistant role contracts

Status: Planned

Document role-specific assistant boundaries before adding any agent behavior.

Implementation guidance:
- Add docs for possible assistants:
  - founder assistant
  - engineering assistant
  - market research assistant
  - investor relations assistant
  - grant/procurement assistant
  - customer/account assistant
  - product strategy assistant
- Define each assistant’s readable objects, proposed actions, forbidden actions, and handoff format.
- Do not implement chat interfaces yet.

Acceptance criteria:
- Each role has a narrow scope.
- Each role acts as an interface to structured context, not an independent personality.
- Proposed actions must use existing proposal protocols.
- External actions remain out of scope.

Verification:
- Documentation update only is acceptable.
- `npm run lint`
- `npm run typecheck`

### 15.2 Add orchestrator planning contract

Status: Planned

Define the coordination layer for future multi-agent execution.

Implementation guidance:
- Document orchestrator responsibilities:
  - gather context
  - delegate narrow subtasks
  - collect artifacts
  - request verification
  - produce proposal batches
- Document non-responsibilities:
  - direct unrestricted writes
  - external actions without approval
  - freeform database wandering
- Align with repository cartographer, implementer, verification, reviewer, research, briefing writer, competitor analyst, and document drafting roles.

Acceptance criteria:
- A future multi-agent workflow has a documented handoff model.
- The orchestrator coordinates rather than doing all work directly.
- Existing approval and revision protocols remain the write boundary.
- No production code changes are required unless useful for docs placement.

Verification:
- Documentation update only is acceptable.
- `npm run lint`
- `npm run typecheck`
