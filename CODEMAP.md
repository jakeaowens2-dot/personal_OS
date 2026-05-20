# CODEMAP.md

This file is the lightweight repo index for agents.

Keep it short. Its purpose is to help agents find the right files without scanning the full codebase.

Update this file whenever important files or directories are added, moved, deleted, or substantially repurposed.

## Current State

The repository may not be scaffolded yet.

Once the Next.js project is created, use the structure below.

## Expected Structure

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

Expected files:
- `src/components/timer/PomodoroTimer.tsx`
- `src/components/timer/TimerControls.tsx`
- `src/components/timer/TimerModeTabs.tsx`
- `src/lib/timer.ts`

### Ledger behavior

Expected files:
- `src/lib/ledger.ts`
- `src/components/ledger/LedgerEventList.tsx`
- `src/components/ledger/WorkBlockStats.tsx`

### Rewards

Expected files:
- `src/lib/rewards.ts`
- `src/components/rewards/RewardBalance.tsx`
- `src/components/rewards/RewardCatalog.tsx`
- `src/components/rewards/RewardRedemptionForm.tsx`

### Shared types

Expected file:
- `src/lib/types.ts`

### Supabase

Expected files:
- `src/lib/supabase.ts`
- `supabase/migrations/*`

### UI primitives

Expected files:
- `src/components/ui/Button.tsx`
- `src/components/ui/Card.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/StatCard.tsx`

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
