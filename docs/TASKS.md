# Tasks

This file defines the phased rollout.

Agents should complete tasks in order unless instructed otherwise.

When a task is completed:
- Mark it complete.
- Add a short note with changed files and verification.
- Do not skip ahead to later phases.

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
