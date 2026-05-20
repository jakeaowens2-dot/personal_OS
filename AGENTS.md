# AGENTS.md

This file defines how coding agents should work in this repository.

The goal is to build a small, durable personal productivity app without context sprawl, unnecessary codebase scanning, or premature feature expansion.

## Product Summary

This project is a personal productivity operating system built around a Pomodoro timer, a work-block ledger, and a reward-spending loop.

Core MVP:
- A Pomodoro timer with work, break, and long-break modes.
- Completed work sessions create timestamped work blocks.
- Work blocks are recorded in a durable ledger.
- Work blocks can be spent on reward blocks.
- The dashboard shows current work/reward state and basic productivity stats.

Later phases:
- Quiet task management.
- AI-generated executive morning brief.
- Notification nudges until the daily brief is opened.
- External news/search context for strategic recommendations.

Do not build later-phase features until the current task explicitly asks for them.

## Stack

Use:
- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase for database/auth/backend storage
- Vercel Hobby for deployment

Do not introduce a different framework, UI library, database, ORM, state manager, or background-job system unless a task explicitly asks for it.

## Operating Rules for Token Economy

Agents must minimize unnecessary context loading.

Before making changes:
1. Read this `AGENTS.md`.
2. Read the current task in `docs/TASKS.md`.
3. Read `CODEMAP.md` to identify likely files.
4. Read only the specific files needed for the task.
5. Use targeted search before opening broad directories.

Avoid:
- Reading the entire repository.
- Reading the entire product spec unless the task requires product behavior clarification.
- Running broad recursive commands without a reason.
- Reopening files already inspected in the same task.
- Pulling unrelated context into the working set.
- Refactoring unrelated code while completing a task.

Preferred search behavior:
- Use `rg "exactTerm"` for targeted lookup.
- Use `find` or `ls` only at shallow depth when locating directories.
- Prefer opening known files from `CODEMAP.md`.
- If a file is large, inspect the relevant section rather than the full file.

When context is needed:
- Product behavior: read relevant section of `docs/PRODUCT_SPEC.md`.
- Task sequencing: read `docs/TASKS.md`.
- File location: read `CODEMAP.md`.
- Implementation details: read the smallest relevant source files.
- Database contracts: read the data-model section in `docs/PRODUCT_SPEC.md` before changing schema or types.

## Code Map Discipline

`CODEMAP.md` is the repo index for agents.

When adding, moving, deleting, or substantially changing files:
- Update `CODEMAP.md` in the same commit/task.
- Keep descriptions short.
- Do not turn `CODEMAP.md` into full documentation.
- Include only files/directories that help future agents navigate.

The code map should answer:
- Where is the timer?
- Where is ledger logic?
- Where are Supabase clients and database types?
- Where are reusable UI components?
- Where are reward rules?
- Where are task/brief systems once added?

## Implementation Discipline

Make the smallest coherent change that satisfies the task.

Each task should normally include:
- The implementation change.
- Any necessary types.
- Any necessary tests or verification.
- Updates to `CODEMAP.md` if file structure changed.
- Updates to `docs/TASKS.md` only when the task is completed or materially refined.

Do not:
- Add speculative abstractions.
- Add AI behavior before the AI phase.
- Add SMS before notification architecture is explicitly requested.
- Add calendar/email integrations before requested.
- Add global state libraries before local state and server persistence are insufficient.
- Add shadcn/ui, Radix, Zustand, Prisma, Drizzle, tRPC, or other libraries without a task-level reason.

## TypeScript Rules

Use explicit domain types for core models:
- `TimerSession`
- `WorkBlock`
- `LedgerEvent`
- `RewardRule`
- `RewardRedemption`
- `Task`
- `DailyBrief`

Keep shared types in the location identified by `CODEMAP.md`.

Do not use `any` unless unavoidable. If used, add a short comment explaining why.

Business logic belongs in `/lib`, not inside UI components.

## Tailwind Rules

Tailwind is allowed and preferred, but must remain readable.

Use:
- Reusable components for repeated styling.
- Semantic component names.
- Short, grouped class strings.
- A controlled color palette defined in Tailwind config.

Avoid:
- Giant one-off class strings.
- Styling that encodes business logic.
- Duplicate card/button/stat styles across many files.
- Hard-coded colors scattered through components.

If a component becomes visually complex, split it into named subcomponents.

## UI Rules

Primary screens:
- Home/dashboard
- Ledger
- Rewards
- Brief, later phase only

The MVP dashboard should stay sparse:
- Timer
- Today’s work blocks
- Reward balance
- Current/next session state
- Basic weekly productivity summary

Do not expose a large all-time task backlog on the main screen.

## Data Rules

The ledger is the source of truth for work/reward accounting.

A completed Pomodoro should create:
- A completed timer session record.
- A work block record.
- A ledger event with positive work-block delta.

A reward redemption should create:
- A reward redemption record.
- A ledger event with negative work-block delta and/or reward-spending metadata.

Do not compute durable balances only in UI state. UI state may cache or display balances, but persisted ledger events must remain authoritative.

## AI and Automation Boundaries

Do not build autonomous AI task mutation in MVP.

When AI features are added:
- AI may suggest task changes first.
- AI may only mutate tasks after explicit feature implementation.
- AI output must be stored as structured brief data, not only as freeform text.
- External web/news search should be narrow, cached, and cost-aware.
- Notification loops should stop when the relevant daily brief has `opened_at` set.

## Deployment Rules

Vercel Hobby is the deployment target for the Next.js app.

Do not rely on frequent Vercel cron jobs for repeated nudges. Use Vercel for the app shell and API routes. Use Supabase scheduling or another explicit scheduler for recurring notification loops when that phase arrives.

## Verification

Before marking a task complete:
- Run lint/typecheck if available.
- Run relevant tests if available.
- Manually inspect the changed UI path when applicable.
- Confirm no unrelated files were changed.
- Confirm `CODEMAP.md` is updated if structure changed.
- Summarize what changed, how it was verified, and any known gaps.

## Reporting Format

When finishing a task, report:
1. Files changed.
2. Behavior implemented.
3. Verification performed.
4. Follow-up tasks or risks, if any.

Keep reports short and factual.
