# CODEMAP.md

This file is the lightweight repo index for agents.

Keep it short. Its purpose is to help agents find the right files without scanning the full codebase.

Update this file whenever important files or directories are added, moved, deleted, or substantially repurposed.

## Current Structure

```txt
src/
  app/
    globals.css
    history/
      page.tsx
    growth/
      page.tsx
      growth.module.css
    layout.tsx
    page.tsx
    task-tracker/
      page.tsx
    projects/
      safety-evidence/
        page.tsx
    settings/
      tasks/
        page.tsx
      agent-context/
        page.tsx
  components/
    assistant/
      MorningOpening.tsx
      MorningOpening.module.css
    auth/
      EmailAuthPanel.tsx
    behaviors/
      HealthyBehaviorCheckin.tsx
    ledger/
      LedgerEventList.tsx
    overview/
      MiniBlocks.tsx
      OverviewModule.tsx
      WeeklyOverview.tsx
    timer/
      PomodoroTimer.tsx
      TimerControls.tsx
      TimerModeTabs.tsx
    ui/
      Badge.tsx
      Button.tsx
      Card.tsx
      Dialog.tsx
      DayOffsetSelector.tsx
      PopoverMenu.tsx
      StatCard.tsx
      TaskPriorityLabel.tsx
  lib/
    behaviors.ts
    cn.ts
    economy.ts
    dates.ts
    history.ts
    knowledge.ts
    ledger.ts
    tasks.ts
    supabase/
      client.ts
      middleware.ts
      server.ts
    workspace.ts
    timer.ts
    timerRuntime.ts
    timerPalette.ts
    projectTrackers.ts
    types.ts
    planning.ts
    agentPayload.ts
  proxy.ts

.gitignore
eslint.config.mjs
next.config.ts
package.json
postcss.config.mjs
tsconfig.json
tsconfig.typecheck.json

docs/
  ECONOMY.md
  PERSONAL_ASSISTANT_BRIEF_SPEC.md
  PRODUCT_SPEC.updated.md
  STYLE_GUIDE.md
  TASKS.updated.md

supabase/
  migrations/
    20260520233500_initial_schema.sql
    20260528001500_add_tasks_and_revisions.sql
    20260528011500_add_daily_focus.sql
    20260528023000_add_work_block_attributions.sql
    20260528103000_add_ledger_event_correction_fields.sql
    20260823000000_add_work_block_attribution_delete_policy.sql
    20260823000001_add_behavior_events.sql
    20260830000000_add_project_tracker.sql
    20260905000000_update_screen_time_penalty_economy.sql
    20260917000000_add_healthy_behaviors.sql
    20260921000001_add_healthy_behavior_outcomes.sql
    20260925000000_add_paper_reading_log.sql
    20260925010000_require_named_workspace_users.sql
    20260929000000_assistant_pending_focus_plan.sql

desktop/
  PersonalOSApp.swift
  Info.plist

scripts/
  build-macos-app.sh
  economy.test.cjs
  generate-app-icon.mjs
  generate-icns.mjs
  reconcile-20260928-balance.sql
  repair-20260929-morning-focus.sql
```

## Planned Structure

```txt
src/
  app/
    page.tsx
    layout.tsx
    globals.css
    history/
      page.tsx
    brief/
      page.tsx

  components/
    ui/
      Button.tsx
      Card.tsx
      Badge.tsx
      Dialog.tsx
      StatCard.tsx
    timer/
      PomodoroTimer.tsx
      TimerControls.tsx
      TimerModeTabs.tsx
    ledger/
      LedgerEventList.tsx
      WorkBlockStats.tsx
    rewards/
      RewardBalance.tsx
      RewardCatalog.tsx
      RewardRedemptionForm.tsx
    brief/
      DailyBriefCard.tsx

  lib/
    types.ts
    supabase.ts
    timer.ts
    ledger.ts
    rewards.ts
    analytics.ts
    tasks.ts
    ai.ts
    notifications.ts

supabase/
  migrations/
  functions/
    generate-daily-brief/
    send-morning-nudge/
```

## Navigation Guide

### Product behavior

Read:
- `docs/PRODUCT_SPEC.updated.md`
- `docs/PERSONAL_ASSISTANT_BRIEF_SPEC.md` for the agreed assistant, morning-brief,
  research-buffer, SMS, and competitor-watch product direction.
- `docs/PERSONAL_ASSISTANT_AUDIT_2026-09-10.md` for verified progress, integration gaps,
  and the proposed first assistant release.
- `docs/STYLE_GUIDE.md`

### Task sequencing

Read:
- `docs/TASKS.updated.md`

### Planning context

Current files:
- `src/lib/planning.ts` builds the read-only, warning-aware planning context packet from task, focus, and work records.
- `src/app/settings/agent-context/page.tsx` renders the settings-only preview of that exact packet.

### Local personal assistant

- `docs/ASSISTANT_LOCAL.md` is the current subscription-first plan and local run guide.
- `docs/HERMES_EVALUATION_2026-09-11.md` records the live Hermes subscription, tools and memory trial, including installed-runtime defects.
- `docs/ASSISTANT_MEMORY_PILOT.md` defines core memory ownership, visible carry-forward reviews, daily chat views and continuing agent context; includes the implemented pilot contract and remaining activation checks.
- `src/app/assistant/page.tsx` is authenticated daily chat, date history, export, closeout/catch-up and retry recovery.
- `src/app/assistant/assistant.module.css` styles the warm chat layout, Moab orange sandstone bubbles and compact composer.
- `src/app/api/assistant/route.ts` authenticates local state/turn/review/proposal requests; SQL leases fence concurrent turns.
- `src/lib/assistant/hermes.ts` and `scripts/hermes-planning-worker.py` run the dedicated native Hermes loop with fixed application tools and profile-scoped history.
- `scripts/hermes_history.py` projects obsolete workspace snapshots out of model replay without rewriting stored history; `scripts/hermes-history.test.py` verifies content/identity preservation and compression budgets.
- `src/lib/assistant/conversation-graph.ts` owns coarse LangGraph routing, checkpoints morning answers, lets Hermes author each transition, enforces the one required next question, and handles final synthesis, pause/resume and retry recovery.
- `src/lib/assistant/checkpointer.ts` owns the private Postgres checkpointer and one daily thread ID per authenticated user/date.
- `src/lib/assistant/state.ts`, `store.ts`, `tools.ts`, and `planning-prompt.ts` own canonical types/validation, current context, tool contracts, and planning instructions.
- `src/lib/assistant/turn-runtime.ts` cancels and drains local carryover work before foreground chat; database leases remain authoritative.
- `supabase/migrations/20261020000000_assistant_turn_recovery.sql` reconciles expired/orphaned turns and gives foreground requests precedence over carryover; `scripts/assistant-turn-recovery.test.sql` verifies recovery and stale-worker fencing.
- `src/components/assistant/WorkingState.tsx` renders memory, carry-forward reviews, and collapsible task cards with priority chips and approval status.
- `src/lib/assistant/proposal-presentation.ts` builds concise Status and revision History text, plus prerequisite labels.
- `supabase/migrations/20260921020000_assistant_chat_decisions.sql` permanently anchors resolved cards to saved responses; `scripts/assistant-chat-decisions.test.sql` verifies owner-scoped placement and retry stability.
- `supabase/migrations/20260921000000_assistant_task_prerequisites.sql` adds reviewed descriptions, task-ID prerequisites, graph validation and approval snapshots.
- `supabase/migrations/20260927000000_assistant_morning_focus.sql` separates task approval from scheduling and gives only final morning synthesis an audited, ordered Today’s Focus write; `scripts/assistant-focus.test.sql` checks order, replacement, retry safety and completion settlement.
- `scripts/assistant-prerequisites.test.sql` covers link/description approval invariants; `assistant-db-pglite.cjs` is an optional isolated Docker-free SQL runner.
- `scripts/assistant-plan-replay.cjs` evaluates real Hermes recall/corrections/proposals against an isolated saved-plan copy.
- `scripts/merge-primary-anonymous-history.sql` is the assertion-heavy one-time ownership repair from the verified anonymous working history to `jake@cumulant.ai`.
- `scripts/repair-20260927-morning-focus.sql` is the source-preserving one-time correction that restores the three ordered tasks from the saved September 27 morning synthesis.
- `docs/ASSISTANT_PREREQUISITES_20260920.md` records the contract, verification and live migration activation.
- `docs/ASSISTANT_PILOT_REVIEW_20260920.md` audits the first real planning turn, saved memory/tasks, and remaining continuity/dependency gaps.
- `supabase/migrations/20260912000000_assistant_daily_planning.sql` owns assistant storage, RLS, leases, revision-safe memory writes and atomic task approval.
- `scripts/assistant-planning.test.cjs` and `assistant-db.test.{cjs,sql}` verify boundaries and disposable-database acceptance; `assistant-hermes.smoke.cjs` is the opt-in subscription-backed runtime check.
- `codex.ts`, `prompt.ts`, `context.ts`, and their original tests retain the earlier chat-only experiment as reference; they are not the active endpoint. `contracts.ts` still supplies local request limits/origin checks.
- `scripts/start-assistant.mjs` launches the loopback experiment; `scripts/assistant.test.cjs` verifies its boundaries with a fake runtime.
- `src/components/assistant/MorningOpening.tsx` renders the morning invitation, durable progress and pause/continue controls; the questions themselves are assistant chat messages.
- `docs/ASSISTANT_FLOW_GRAPH.md` documents graph nodes, checkpoint frequency, recovery semantics and authority boundaries.

### Local macOS app

- `desktop/PersonalOSApp.swift` is the small native WebKit shell. It owns a dedicated window and starts/stops the existing loopback workspace with the app lifecycle.
- `scripts/build-macos-app.sh` produces the signed local bundle; the icon generators create the checked app identity without an external graphics dependency.
- `src/app/manifest.ts` and `public/personal-os-icon.svg` provide standalone web-app metadata and the matching browser identity.

### Knowledge & Growth

- `src/app/growth/page.tsx` is the separate, intentionally narrow profile surface for reporting completed papers and reading notes.
- `src/lib/knowledge.ts` owns paper-log reads and writes; `paper_reading_entries` in `20260925000000_add_paper_reading_log.sql` is the RLS-protected durable record.
- `20260925010000_require_named_workspace_users.sql` adds restrictive RLS gates across Personal OS so anonymous identities cannot read or mutate workspace state.

### Timer UI

Current files:
- `src/components/timer/PomodoroTimer.tsx` (rolls completed work sessions into an overage count-up mode instead of stopping)
- `src/components/timer/TimerControls.tsx`
- `src/components/timer/TimerModeTabs.tsx`
- `src/lib/timer.ts`
- `src/lib/timerPalette.ts`

### Ledger behavior

Current files:
- `src/lib/ledger.ts`
- `src/lib/workspace.ts` handles Supabase-backed workspace session bootstrap, loading, and completion persistence.
- `src/lib/workspace.ts` also persists post-completion work-block attribution and updates ledger metadata with readable task summaries.
- `src/lib/activity-day.ts` defines the Pacific 4am waking-day policy and legacy fallback; `dates.ts` maps manual day controls without moving old timestamps.
- `supabase/migrations/20261115000000_waking_day_policy.sql` stamps new day labels without backfilling history; `scripts/activity-day.test.{cjs,sql}` covers cutoff/DST, edits, links and retry identity.
- `src/components/ledger/LedgerEventList.tsx` now exposes recent-activity edit/delete actions for supported ledger events.
- `src/app/history/page.tsx` streams the full combined ledger and behavior history in timestamp order.
- `src/lib/history.ts` owns cursor-based history retrieval from Supabase.

Planned files:
- `src/lib/ledger.ts`
- `src/components/ledger/LedgerEventList.tsx`
- `src/components/ledger/WorkBlockStats.tsx`
- The compact ledger experience lives on `src/app/page.tsx` during MVP; a dedicated history route can be added later when deeper browsing is needed.

### Rewards

Current files:
- `src/lib/economy.ts` is the canonical block-economy math (work blocks, reward rates, settlement, partial blocks). See `docs/ECONOMY.md`.
- `src/app/page.tsx` derives the live reward balance from ledger + behavior events and hosts subtle manual reward/work correction entry points.

Planned files:
- `src/components/rewards/RewardBalance.tsx`
- `src/components/rewards/RewardCatalog.tsx`
- `src/components/rewards/RewardRedemptionForm.tsx`
- Reward balance and small redemption controls currently live on `src/app/page.tsx` as part of the home overview.

### Shared types

Current file:
- `src/lib/types.ts`

### Behavior tracking

Current files:
- `src/lib/behaviors.ts` holds behavior events (indulgence, screen time, exercise) and their reward/penalty math, plus edit/delete persistence.
- `src/components/overview/MiniBlocks.tsx` renders 1-hour blocks with partial-fill support and solid/outline/destroyed variants.
- `src/components/overview/WeeklyOverview.tsx` renders daily Work / Reward / Penalty columns and overlays destroyed-reward marks.
- `src/app/page.tsx` hosts the "Behavior tracking" dialog and mixes behavior events into reward accounting.

Task storage files:
- `src/lib/tasks.ts` handles canonical task CRUD, task sorting, and revision fetching.
- `src/lib/task-library.ts` ranks the attribution picker by work usage/creation and builds bounded morning cleanup candidates; `scripts/task-library.test.cjs` verifies ranking, paging and conservative review rules.
- `supabase/migrations/20261027000000_task_library_activity.sql` provides an owner-scoped last-use aggregate without modifying tasks; `scripts/task-library.test.sql` verifies isolation and history preservation.
- `src/lib/tasks.ts` also manages the daily focus list used by the home page and task vault.

### Shared UI helpers

Current file:
- `src/lib/cn.ts`

### Auth UI

Current files:
- `src/components/auth/EmailAuthPanel.tsx` provides password-first sign-in with optional magic links for Home, Task Vault, and agent context.
- `src/components/auth/AuthRecoveryRedirect.tsx` routes successful recovery callbacks to the account password form even when Supabase falls back to the app root.
- `src/app/settings/account/page.tsx` provides authenticated password setup/change and signed-out recovery email requests.
- `src/lib/workspace.ts` now requires an existing authenticated Supabase user instead of creating anonymous users automatically.

### Overview layout

Current files:
- `src/components/overview/OverviewModule.tsx`
- `src/app/page.tsx` uses the shared overview module/grid so neighboring sections align across the page.

### Supabase

Current files:
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/proxy.ts`
- `supabase/migrations/20260528001500_add_tasks_and_revisions.sql` adds canonical tasks plus durable task revision history.
- `supabase/migrations/20260528011500_add_daily_focus.sql` adds the lightweight daily focus list that references canonical tasks.
- `supabase/migrations/20260528023000_add_work_block_attributions.sql` adds durable per-task work-block attribution for post-completion task assignment.
- `supabase/migrations/20260925020000_enforce_single_housekeeping_task.sql` preserves duplicate built-in housekeeping tasks as archived legacy history and enforces one active built-in task per workspace.
- `supabase/migrations/20260830000000_add_project_tracker.sql` adds user-scoped project checklists and submitted deliverables.
- `supabase/migrations/20260528103000_add_ledger_event_correction_fields.sql` adds soft-delete audit fields for ledger-linked records and update access for attribution corrections.

Planned files:
- `supabase/migrations/*`

### UI primitives

Current files:
- `src/components/ui/Button.tsx`
- `src/components/ui/Card.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/Dialog.tsx`
- `src/components/ui/StatCard.tsx`

### App shell

Current files:
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `src/app/settings/tasks/page.tsx` is the quiet task vault for creating, editing, completing, archiving, and auditing canonical tasks.
- `src/app/settings/agent-context/page.tsx` previews the read-only planning context packet used by future daily planning.
- `src/app/projects/safety-evidence/page.tsx` is the project fieldbook: a deliberate submit-to-complete checklist with saved deliverables, outline import, and local in-memory preview mode.
- `src/app/task-tracker/page.tsx` redirects to the local-only fieldbook preview for fast UI iteration.
- `src/app/page.tsx` now also shows the compact daily focus list and links back to the task vault for management.

Architecture note:
- `src/app/page.tsx` is the MVP overview surface for timer, work summary, reward balance, and compact recent ledger activity.
- Dedicated routes are reserved for later deep-history and long-form brief/chat experiences.

### Project config

Current files:
- `package.json`
- `tsconfig.json`
- `tsconfig.typecheck.json`
- `next.config.ts`
- `postcss.config.mjs`
- `eslint.config.mjs`

### AI brief, later phase only

Expected files:
- `src/lib/ai.ts`
- `src/components/brief/DailyBriefCard.tsx`
- `supabase/functions/generate-daily-brief/`

Do not create or modify AI files until the task list reaches the AI phase.

### Notifications, later phase only

Expected files:
- `src/lib/notifications.ts`
- `supabase/functions/send-morning-nudge/`

Do not create notification loops until the task list reaches the notification phase.

## Update Rules

When adding a new important file:
- Add one short line explaining its purpose.
- Do not paste implementation details.
- Do not duplicate the full product spec here.

When moving or deleting a file:
- Update this file in the same task.

When a task only changes internal logic inside an existing mapped file:
- No update is required unless the file’s purpose changed.

### Shared workspace navigation
- `src/components/workspace/WorkspaceHeader.tsx` and its CSS module render the sticky, opaque account/date/status ribbon and Work tracking, Personal Assistant, Knowledge & Growth, and Task Management route tabs. Home supplies its reset/sign-out actions.
- `src/lib/timerRuntime.ts` validates and advances user-scoped wall-clock timer snapshots so active time stays accurate across throttled callbacks, route changes and app reloads.
