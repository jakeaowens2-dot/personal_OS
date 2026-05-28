create table if not exists public.daily_focus_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_focus_lists_user_date_unique unique (user_id, date)
);

create table if not exists public.daily_focus_items (
  id uuid primary key default gen_random_uuid(),
  daily_focus_list_id uuid not null references public.daily_focus_lists (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  position integer not null check (position > 0),
  focus_status text not null default 'planned' check (focus_status in ('planned', 'active', 'done', 'deferred')),
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_focus_items_list_task_unique unique (daily_focus_list_id, task_id)
);

create index if not exists daily_focus_lists_user_date_idx
  on public.daily_focus_lists (user_id, date desc);

create index if not exists daily_focus_items_list_status_position_idx
  on public.daily_focus_items (daily_focus_list_id, focus_status, position);

create or replace function public.set_daily_focus_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_daily_focus_lists_updated_at on public.daily_focus_lists;
create trigger set_daily_focus_lists_updated_at
before update on public.daily_focus_lists
for each row
execute function public.set_daily_focus_updated_at();

drop trigger if exists set_daily_focus_items_updated_at on public.daily_focus_items;
create trigger set_daily_focus_items_updated_at
before update on public.daily_focus_items
for each row
execute function public.set_daily_focus_updated_at();

alter table public.daily_focus_lists enable row level security;
alter table public.daily_focus_items enable row level security;

create policy "daily_focus_lists_select_own"
  on public.daily_focus_lists
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "daily_focus_lists_insert_own"
  on public.daily_focus_lists
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "daily_focus_lists_update_own"
  on public.daily_focus_lists
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "daily_focus_items_select_own"
  on public.daily_focus_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_focus_lists
      where daily_focus_lists.id = daily_focus_items.daily_focus_list_id
        and daily_focus_lists.user_id = auth.uid()
    )
  );

create policy "daily_focus_items_insert_own"
  on public.daily_focus_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_focus_lists
      where daily_focus_lists.id = daily_focus_items.daily_focus_list_id
        and daily_focus_lists.user_id = auth.uid()
    )
  );

create policy "daily_focus_items_update_own"
  on public.daily_focus_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_focus_lists
      where daily_focus_lists.id = daily_focus_items.daily_focus_list_id
        and daily_focus_lists.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.daily_focus_lists
      where daily_focus_lists.id = daily_focus_items.daily_focus_list_id
        and daily_focus_lists.user_id = auth.uid()
    )
  );
