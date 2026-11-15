create table if not exists public.project_trackers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (char_length(trim(slug)) > 0),
  title text not null check (char_length(trim(title)) > 0),
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_trackers_user_slug_unique unique (user_id, slug)
);

create table if not exists public.project_tracker_items (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.project_trackers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  phase text not null check (char_length(trim(phase)) > 0),
  position integer not null check (position > 0),
  title text not null check (char_length(trim(title)) > 0),
  description text,
  input_kind text not null check (input_kind in ('short_text', 'long_text', 'link', 'list')),
  input_label text not null check (char_length(trim(input_label)) > 0),
  input_placeholder text,
  submission text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_tracker_items_completed_requires_submission
    check (completed_at is null or (submission is not null and char_length(trim(submission)) > 0))
);

create index if not exists project_trackers_user_updated_at_idx
  on public.project_trackers (user_id, updated_at desc);

create index if not exists project_tracker_items_tracker_position_idx
  on public.project_tracker_items (tracker_id, position);

create or replace function public.set_project_tracker_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_project_trackers_updated_at on public.project_trackers;
create trigger set_project_trackers_updated_at
before update on public.project_trackers
for each row execute function public.set_project_tracker_updated_at();

drop trigger if exists set_project_tracker_items_updated_at on public.project_tracker_items;
create trigger set_project_tracker_items_updated_at
before update on public.project_tracker_items
for each row execute function public.set_project_tracker_updated_at();

alter table public.project_trackers enable row level security;
alter table public.project_tracker_items enable row level security;

create policy "project_trackers_select_own" on public.project_trackers
  for select to authenticated using (auth.uid() = user_id);
create policy "project_trackers_insert_own" on public.project_trackers
  for insert to authenticated with check (auth.uid() = user_id);
create policy "project_trackers_update_own" on public.project_trackers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "project_tracker_items_select_own" on public.project_tracker_items
  for select to authenticated using (auth.uid() = user_id);
create policy "project_tracker_items_insert_own" on public.project_tracker_items
  for insert to authenticated with check (auth.uid() = user_id);
create policy "project_tracker_items_update_own" on public.project_tracker_items
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
