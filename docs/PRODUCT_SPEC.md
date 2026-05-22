# Product Spec

## 1. Product Overview

Productivity OS is a personal productivity app for converting focused work into earned reward time.

The app is built around a simple loop:

```txt
Pomodoro completed -> work block earned -> ledger event recorded -> reward balance updated -> reward can be redeemed
```

The product should feel more like a personal operating system than a generic to-do app. The core behavior is structured accountability: work is tracked, rewards are earned, and daily priorities are eventually synthesized by an AI assistant.

## 2. Core Philosophy

The ledger is the source of truth.

The timer generates events, but the durable system is the ledger. Every earned work block and every spent reward should be recorded as an auditable event.

The UI should reduce noise. Large backlogs should not dominate the main screen. The main page should surface what matters today.

AI should be introduced only after the app has enough structured data to reason over.

## 3. MVP Scope

The MVP includes:

- Pomodoro timer.
- Work, break, and long-break modes.
- Completed Pomodoros become work blocks.
- Work blocks are timestamped.
- Work blocks are stored in Supabase.
- A ledger records earned and spent blocks.
- Rewards can be manually redeemed.
- Dashboard shows today’s work blocks, this week’s total, and current reward balance.
- Basic analytics show productivity by time of day and weekly totals.

## 4. Non-Goals for MVP

Do not build yet:

- AI executive morning brief.
- Autonomous task mutation.
- Web/news search.
- SMS notifications.
- Calendar integration.
- Email integration.
- Mobile native app.
- Complex team/multi-user workflows.
- Public social sharing.
- Marketplace-style reward catalog.

## 5. Stack

Use:

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS.
- Supabase.
- Vercel Hobby.

Vercel hosts the app shell and API routes. Supabase stores durable state and should handle recurring backend scheduling when needed later.

## 6. Primary Screens

### Home

The home screen should include:

- Current timer.
- Current mode.
- Start/pause/reset controls.
- Today’s completed work blocks.
- Reward balance.
- A small ledger of recent earned/spent events.
- Current session state.
- Small weekly summary.
- Later: a compact daily task surface.
- Later: a compact chat surface for notes and basic questions.

The home screen is the general overview surface for MVP and near-term phases. Keep it focused on current work state, rewards, and a compact recent-history view rather than splitting these into separate routes too early.

Later, it may include one to three AI-surfaced tasks for today.

### Ledger

The MVP ledger experience may live on the home screen as a compact section beneath the timer.

When the product needs deeper browsing, filtering, or historical drill-down, a dedicated ledger/history route can be introduced.

Ledger content should include:

- Earned work-block events.
- Spent reward events.
- Manual corrections, if implemented.
- Timestamps.
- Event source.

### Rewards

Reward earning rules for the MVP:

- On weekdays, one completed 50-minute work block earns 20 minutes of reward time.
- On weekends, one completed work block earns 30 minutes of reward time, displayed as a `1.5x` bonus state.
- Reward balance may go negative if more reward time is spent than has been earned.
- Reward balance should be derived from persisted ledger events, not optimistic client-only state.

The home overview should include:

- Current reward balance.
- Reward reporting controls.
- Subtle entry points for manual reward redemption and manual work corrections.

Manual reward redemption and manual work correction forms should stay tucked behind lightweight dialogs so the overview surface remains quiet until the user explicitly opens them.

Reward reporting UI rules for the MVP:

- Reward reports should capture duration using separate hour and minute fields.
- Minute entry should move in 5-minute increments.
- Reward reports should capture the day the reward happened using a constrained back-in-time day selector, not a future-planning date picker.
- The selected reward day should be persisted as a concrete datetime using a normalized local midday timestamp for now.

### Brief

Later phase only.

The brief screen should include:

- Morning summary.
- Recommended work for today.
- Critical unresolved concerns.
- External news/context.
- Suggested schedule.
- Opened/read state.

Dedicated screens or tabs become important later when a surface needs significantly more room than the home overview can support, such as deep daily work histories, newsletter-style brief review, or an expanded chat experience for browsing substantial content.

## 7. Data Model

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

Later phase.

Fields:
- `id`
- `user_id`
- `title`
- `description`
- `status`
- `urgency`
- `importance`
- `due_at`
- `source`
- `last_seen_at`
- `ai_notes`

### DailyBrief

Later phase.

Fields:
- `id`
- `user_id`
- `date`
- `summary`
- `recommended_tasks`
- `company_posture`
- `external_news`
- `created_at`
- `opened_at`

## 8. Ledger Rules

A completed work session should create:

1. A completed `TimerSession`.
2. A `WorkBlock`.
3. A `LedgerEvent` with positive `delta_work_blocks`.

A reward redemption should create:

1. A `RewardRedemption`.
2. A `LedgerEvent` with negative `delta_work_blocks`.

Reward balance math should be derived from persisted ledger events:

- `work_earned` events add reward minutes based on whether the event timestamp falls on a weekday or weekend.
- `reward_spent` events subtract the redeemed reward minutes stored in ledger metadata.
- The displayed balance may be positive or negative.
- Reported reward days should be stored as durable datetimes, not relative labels like `today` or `yesterday`.

Current balances should be derived from ledger events or a trusted database view. Do not rely only on client-side state.

## 9. UI Design System

Use Tailwind with a small reusable component layer.

Recommended primitives:

- `Button`
- `Card`
- `Badge`
- `StatCard`
- `Progress`

Design goals:

- Sparse dashboard.
- Strong visual hierarchy.
- Low visual noise.
- Clear timer state.
- Clear work/reward accounting.
- No giant task backlog on the home page.

Use semantic names and reusable components. Avoid scattering long one-off Tailwind class strings across page files.

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

## 10. AI Brief Behavior, Later Phase

The morning brief should eventually:

- Review unresolved tasks and concerns.
- Review recent work history.
- Identify neglected but important work.
- Review company posture if relevant context is provided.
- Search narrow external news topics.
- Recommend the best work to perform today.

AI should initially suggest task changes rather than mutate tasks automatically.

AI-generated brief data should be stored structurally, not only as a freeform blob.

## 11. Notification Behavior, Later Phase

The notification system should eventually bother the user until the daily brief is opened.

Basic loop:

```txt
daily brief created -> notification sent -> check opened_at -> repeat if unopened -> stop once opened
```

Start with Pushover or Telegram before SMS.

Do not use SMS for MVP because application-to-person texting introduces registration, compliance, and cost overhead.

## 12. Deployment Constraints

Deploy the app on Vercel Hobby.

Vercel is suitable for:

- Next.js hosting.
- App shell.
- User-triggered API routes.
- Daily brief endpoint, if invoked once daily.

Do not rely on frequent Vercel cron for repeated nudges. Use Supabase scheduling or another explicit scheduler when notification loops are implemented.

## 13. Success Criteria for MVP

The MVP is successful when:

- A user can run Pomodoro sessions.
- Completed sessions produce durable work blocks.
- Work blocks are recorded in a ledger.
- Reward balance is visible.
- Rewards can be redeemed.
- The dashboard shows useful daily and weekly productivity information.
- The implementation is small enough for coding agents to modify safely.
