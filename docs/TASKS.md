# Tasks

This file defines the phased rollout.

Agents should complete tasks in order unless instructed otherwise.

When a task is completed:
- Mark it complete.
- Add a short note with changed files and verification.
- Do not skip ahead to later phases.

## Phase 0 — Project Scaffold

### 0.1 Create Next.js project

Status: Not started

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

Status: Not started

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

Status: Not started

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

Status: Not started

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

Status: Not started

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

Status: Not started

When a work timer completes, create an in-memory work block and ledger event.

Acceptance criteria:
- Completed work session increases today’s work-block count.
- Ledger list shows a work-earned event.
- Refresh persistence is not required yet.

## Phase 2 — Supabase Persistence

### 2.1 Add Supabase client

Status: Not started

Install and configure Supabase client.

Acceptance criteria:
- Environment variables are documented.
- Supabase client is isolated in `src/lib/supabase.ts`.
- No service-role secret is exposed to client components.

### 2.2 Create database schema migration

Status: Not started

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

Status: Not started

On completed work session, write:
- Timer session.
- Work block.
- Ledger event.

Acceptance criteria:
- Data survives refresh.
- Failed writes are handled visibly.
- Duplicate completion writes are avoided.

## Phase 3 — Ledger and Rewards

### 3.1 Build ledger screen

Status: Not started

Create a ledger page showing earned/spent events.

Acceptance criteria:
- Events display type, delta, source, and timestamp.
- Events are ordered newest first.
- Empty state is handled.

### 3.2 Build reward balance

Status: Not started

Calculate current reward/work balance from ledger events.

Acceptance criteria:
- Balance is derived from persisted events.
- Dashboard shows current balance.
- Ledger remains source of truth.

### 3.3 Add reward redemption

Status: Not started

Allow user to redeem a reward.

Acceptance criteria:
- Redemption creates a reward redemption record.
- Redemption creates a ledger event.
- Balance updates after redemption.
- User cannot spend more work blocks than available.

## Phase 4 — Analytics

### 4.1 Add daily and weekly stats

Status: Not started

Show:
- Today’s completed work blocks.
- This week’s work blocks.
- Current streak if simple to implement.

Acceptance criteria:
- Stats derive from persisted work blocks or ledger events.
- Dashboard remains uncluttered.

### 4.2 Add productive time-of-day insight

Status: Not started

Show most productive hour or time window.

Acceptance criteria:
- Uses timestamped work blocks.
- Handles insufficient data gracefully.

## Phase 5 — Quiet Task Management

Do not start until Phase 1 through Phase 4 are complete.

### 5.1 Add task model and storage

Status: Not started

Add quiet global task storage.

Acceptance criteria:
- Tasks can be created, edited, completed, and archived.
- Task backlog is not shown prominently on dashboard.

### 5.2 Add today task surfacing

Status: Not started

Surface only critical/today tasks on the home page.

Acceptance criteria:
- Dashboard shows a small number of tasks.
- Backlog remains accessible but quiet.

## Phase 6 — AI Morning Brief

Do not start until task storage exists.

### 6.1 Generate structured daily brief

Status: Not started

Generate a daily brief from:
- Recent work history.
- Open tasks.
- Stale concerns.
- User-defined priorities.

Acceptance criteria:
- Brief is stored in `daily_briefs`.
- Brief has structured fields.
- AI does not mutate tasks automatically.

### 6.2 Add narrow external news context

Status: Not started

Add narrow web/news search for user-defined company topics.

Acceptance criteria:
- Search topics are configurable.
- Results are cached.
- Brief includes source links.
- Costs are controlled.

## Phase 7 — Notifications

Do not start until daily briefs exist.

### 7.1 Add notification provider

Status: Not started

Start with Pushover or Telegram.

Acceptance criteria:
- User can receive a test notification.
- Secrets are stored server-side.
- Provider logic is isolated.

### 7.2 Add morning nudge loop

Status: Not started

Notify repeatedly until daily brief is opened.

Acceptance criteria:
- Notification checks `opened_at`.
- Loop stops once brief is opened.
- Uses Supabase scheduling or another suitable scheduler, not frequent Vercel Hobby cron.
