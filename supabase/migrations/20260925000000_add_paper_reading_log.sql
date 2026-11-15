create table if not exists public.paper_reading_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 500),
  citation text check (citation is null or char_length(citation) <= 1000),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  completed_on date not null,
  notes text not null check (char_length(trim(notes)) between 1 and 20000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists paper_reading_entries_user_completed_idx
  on public.paper_reading_entries (user_id, completed_on desc, created_at desc);

create or replace function public.set_paper_reading_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_paper_reading_entries_updated_at on public.paper_reading_entries;
create trigger set_paper_reading_entries_updated_at
before update on public.paper_reading_entries
for each row execute function public.set_paper_reading_updated_at();

alter table public.paper_reading_entries enable row level security;

create policy "paper_reading_entries_select_own" on public.paper_reading_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "paper_reading_entries_insert_own" on public.paper_reading_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "paper_reading_entries_update_own" on public.paper_reading_entries
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "paper_reading_entries_delete_own" on public.paper_reading_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on function public.set_paper_reading_updated_at() from public, anon, authenticated;
grant select, insert, update, delete on public.paper_reading_entries to authenticated;
