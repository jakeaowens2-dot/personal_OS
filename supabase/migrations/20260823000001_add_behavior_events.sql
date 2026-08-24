create table if not exists public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  behavior_type text not null check (behavior_type in ('indulgence', 'screen_time', 'exercise')),
  occurred_at timestamptz not null default timezone('utc', now()),
  duration_minutes integer check (duration_minutes >= 0),
  penalty_minutes integer check (penalty_minutes >= 0),
  note text,
  deleted_at timestamptz,
  deleted_by_actor_label text,
  deletion_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists behavior_events_user_occurred_at_idx
  on public.behavior_events (user_id, occurred_at desc);

alter table public.behavior_events enable row level security;

create policy "behavior_events_select_own"
  on public.behavior_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "behavior_events_insert_own"
  on public.behavior_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "behavior_events_update_own"
  on public.behavior_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "behavior_events_delete_own"
  on public.behavior_events
  for delete
  to authenticated
  using (auth.uid() = user_id);
