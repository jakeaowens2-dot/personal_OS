create extension if not exists pgcrypto;

create table if not exists public.timer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('work', 'break', 'long_break')),
  planned_minutes integer not null check (planned_minutes > 0),
  started_at timestamptz,
  ended_at timestamptz,
  completed boolean not null default false,
  interrupted boolean not null default false,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.work_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  timer_session_id uuid not null references public.timer_sessions (id) on delete cascade,
  earned_at timestamptz not null default timezone('utc', now()),
  duration_minutes integer not null check (duration_minutes > 0),
  tag text,
  quality_rating integer check (quality_rating between 1 and 5),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('work_earned', 'reward_spent', 'correction', 'bonus')),
  delta_work_blocks integer not null default 0,
  delta_reward_blocks integer not null default 0,
  source text not null,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  cost_work_blocks integer not null check (cost_work_blocks >= 0),
  reward_minutes integer not null check (reward_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reward_rule_id uuid not null references public.reward_rules (id) on delete restrict,
  reward_name text not null,
  cost_work_blocks integer not null check (cost_work_blocks >= 0),
  redeemed_at timestamptz not null default timezone('utc', now()),
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists timer_sessions_user_id_started_at_idx
  on public.timer_sessions (user_id, started_at desc);

create index if not exists work_blocks_user_id_earned_at_idx
  on public.work_blocks (user_id, earned_at desc);

create index if not exists work_blocks_timer_session_id_idx
  on public.work_blocks (timer_session_id);

create index if not exists ledger_events_user_id_created_at_idx
  on public.ledger_events (user_id, created_at desc);

create index if not exists reward_rules_user_id_active_idx
  on public.reward_rules (user_id, active);

create index if not exists reward_redemptions_user_id_redeemed_at_idx
  on public.reward_redemptions (user_id, redeemed_at desc);
