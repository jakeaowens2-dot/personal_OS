# CODEMAP.md

This file is the lightweight repo index for agents.

Keep it short. Its purpose is to help agents find the right files without scanning the full codebase.

Update this file whenever important files or directories are added, moved, deleted, or substantially repurposed.

## Current Structure

```txt
src/
  app/
    globals.css
    layout.tsx
    page.tsx
    settings/
      tasks/
        page.tsx
  components/
    auth/
      EmailAuthPanel.tsx
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
      StatCard.tsx
  lib/
    behaviors.ts
    cn.ts
    economy.ts
    ledger.ts
    tasks.ts
    supabase/
      client.ts
      middleware.ts
      server.ts
    workspace.ts
    timer.ts
    timerPalette.ts
    types.ts
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
- `docs/STYLE_GUIDE.md`

### Task sequencing

Read:
- `docs/TASKS.updated.md`

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
- `src/components/ledger/LedgerEventList.tsx` now exposes recent-activity edit/delete actions for supported ledger events.

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
- `src/components/overview/WeeklyOverview.tsx` renders the weekly Work / Reward / Penalty sections plus destroyed reward blocks.
- `src/app/page.tsx` hosts the "Behavior tracking" dialog and mixes behavior events into reward accounting.

Task storage files:
- `src/lib/tasks.ts` handles canonical task CRUD, task sorting, and revision fetching.
- `src/lib/tasks.ts` also manages the daily focus list used by the home page and task vault.

### Shared UI helpers

Current file:
- `src/lib/cn.ts`

### Auth UI

Current files:
- `src/components/auth/EmailAuthPanel.tsx` renders the quiet email magic-link sign-in prompt used by Home and Task Vault.
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
