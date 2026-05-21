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
  components/
    timer/
      PomodoroTimer.tsx
      TimerControls.tsx
      TimerModeTabs.tsx
    ui/
      Badge.tsx
      Button.tsx
      Card.tsx
      StatCard.tsx
  lib/
    cn.ts
    ledger.ts
    supabase/
      client.ts
      middleware.ts
      server.ts
    workspace.ts
    timer.ts
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
  PRODUCT_SPEC.md
  TASKS.md

supabase/
  migrations/
    20260520233500_initial_schema.sql
```

## Planned Structure

```txt
src/
  app/
    page.tsx
    layout.tsx
    globals.css
    ledger/
      page.tsx
    rewards/
      page.tsx
    brief/
      page.tsx

  components/
    ui/
      Button.tsx
      Card.tsx
      Badge.tsx
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
- `docs/PRODUCT_SPEC.md`

### Task sequencing

Read:
- `docs/TASKS.md`

### Timer UI

Current files:
- `src/components/timer/PomodoroTimer.tsx`
- `src/components/timer/TimerControls.tsx`
- `src/components/timer/TimerModeTabs.tsx`
- `src/lib/timer.ts`

### Ledger behavior

Current file:
- `src/lib/ledger.ts`
- `src/lib/workspace.ts` handles Supabase-backed workspace session bootstrap, loading, and completion persistence.

Planned files:
- `src/lib/ledger.ts`
- `src/components/ledger/LedgerEventList.tsx`
- `src/components/ledger/WorkBlockStats.tsx`

### Rewards

Planned files:
- `src/lib/rewards.ts`
- `src/components/rewards/RewardBalance.tsx`
- `src/components/rewards/RewardCatalog.tsx`
- `src/components/rewards/RewardRedemptionForm.tsx`

### Shared types

Current file:
- `src/lib/types.ts`

### Shared UI helpers

Current file:
- `src/lib/cn.ts`

### Supabase

Current files:
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/proxy.ts`

Planned files:
- `supabase/migrations/*`

### UI primitives

Current files:
- `src/components/ui/Button.tsx`
- `src/components/ui/Card.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/StatCard.tsx`

### App shell

Current files:
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`

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
