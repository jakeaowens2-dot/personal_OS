# Productivity OS

A personal productivity operating system built around a Pomodoro timer, a work-block ledger, and a reward-spending loop.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase
- Vercel Hobby

## Core MVP

The MVP is not a generic task app. It is a work/reward system.

A completed Pomodoro creates a timestamped work block. Work blocks are stored in a durable ledger and can be spent on reward blocks. The app should make productivity visible without turning the interface into a noisy backlog.

## Repo Context

Read these files before working:

- `AGENTS.md` — agent behavior, engineering rules, and token economy rules.
- `CODEMAP.md` — where important code lives.
- `docs/PRODUCT_SPEC.updated.md` — product scope, architecture, data model, UI behavior.
- `docs/TASKS.updated.md` — phased rollout and task-by-task implementation plan.

## Development

Initial setup target:

```bash
npx create-next-app@latest productivity-os \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir
```

Add Supabase client:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

## Environment

Add these variables in local development and in your deployment environment:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Notes:
- These are public client-safe values and are the only Supabase values the current app should use.
- Do not expose a service-role key to client components.
- `.env.example` shows the expected variable names, and `.env.local` can hold your local values.

## Vercel Deployment

Deploy the `productivity-os-v1` directory as a Next.js project on Vercel.

Before the first production deploy:

1. In Vercel Project Settings, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
2. In Supabase, enable Email auth and magic-link sign-in under Authentication providers.
3. Apply the SQL migrations in `supabase/migrations/` to the target Supabase project.

Recommended verification after deploy:

1. Open the production site and confirm the home page loads without the missing-env message.
2. Start or complete a work timer and confirm a workspace session is created.
3. Add a manual work block and verify a `timer_sessions`, `work_blocks`, and `ledger_events` row are written.
4. Spend a reward and verify a `reward_rules`, `reward_redemptions`, and `ledger_events` row are written.

If the site loads but persistence fails, check these first:
- Email auth and magic-link sign-in are enabled in Supabase.
- Both public env vars are present in Vercel for the correct environment.
- The schema and RLS policies from `supabase/migrations/` were applied to the same Supabase project referenced by the Vercel env vars.

## Current Phase

Start with the current planned phase in `docs/TASKS.updated.md`.

Do not build AI brief, notification nudges, calendar/email integrations, or SMS until the timer-ledger-rewards loop works.
