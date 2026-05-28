create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_task_id uuid references public.tasks (id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'completed', 'archived')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  area text,
  due_at timestamptz,
  source text not null default 'manual',
  completed_at timestamptz,
  archived_at timestamptz,
  last_seen_at timestamptz,
  human_summary text,
  agent_payload_json jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1 check (schema_version > 0),
  updated_by_actor_type text not null default 'human' check (updated_by_actor_type in ('human', 'agent', 'system')),
  updated_by_actor_label text,
  last_change_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tasks_completed_requires_completed_at
    check (status <> 'completed' or completed_at is not null),
  constraint tasks_archived_requires_archived_at
    check (
      (status = 'archived' and archived_at is not null)
      or (status <> 'archived' and archived_at is null)
    )
);

create table if not exists public.task_revisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null check (action_type in ('created', 'updated', 'completed', 'reopened', 'archived', 'restored')),
  actor_type text not null check (actor_type in ('human', 'agent', 'system')),
  actor_label text,
  change_reason text,
  before_json jsonb,
  after_json jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists tasks_user_id_status_updated_at_idx
  on public.tasks (user_id, status, updated_at desc);

create index if not exists tasks_user_id_priority_updated_at_idx
  on public.tasks (user_id, priority, updated_at desc);

create index if not exists task_revisions_task_id_created_at_idx
  on public.task_revisions (task_id, created_at desc);

create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.log_task_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action text := 'updated';
begin
  if tg_op = 'INSERT' then
    action := 'created';
  elsif old.status <> new.status then
    if new.status = 'completed' and old.status <> 'completed' then
      action := 'completed';
    elsif new.status = 'archived' and old.status <> 'archived' then
      action := 'archived';
    elsif old.status = 'archived' and new.status <> 'archived' then
      action := 'restored';
    elsif old.status = 'completed' and new.status <> 'completed' then
      action := 'reopened';
    end if;
  end if;

  insert into public.task_revisions (
    task_id,
    user_id,
    action_type,
    actor_type,
    actor_label,
    change_reason,
    before_json,
    after_json
  )
  values (
    new.id,
    new.user_id,
    action,
    new.updated_by_actor_type,
    new.updated_by_actor_label,
    new.last_change_reason,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_tasks_updated_at();

drop trigger if exists log_task_revision on public.tasks;
create trigger log_task_revision
after insert or update on public.tasks
for each row
execute function public.log_task_revision();

alter table public.tasks enable row level security;
alter table public.task_revisions enable row level security;

create policy "tasks_select_own"
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "tasks_insert_own"
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "tasks_update_own"
  on public.tasks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "task_revisions_select_own"
  on public.task_revisions
  for select
  to authenticated
  using (auth.uid() = user_id);
