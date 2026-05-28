create table if not exists public.work_block_attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  work_block_id uuid not null references public.work_blocks (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  attribution_label text not null,
  share_ratio numeric(6,5) not null check (share_ratio > 0 and share_ratio <= 1),
  attributed_minutes integer not null check (attributed_minutes > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists work_block_attributions_user_created_at_idx
  on public.work_block_attributions (user_id, created_at desc);

create index if not exists work_block_attributions_work_block_id_idx
  on public.work_block_attributions (work_block_id);

alter table public.work_block_attributions enable row level security;

create policy "work_block_attributions_select_own"
  on public.work_block_attributions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "work_block_attributions_insert_own"
  on public.work_block_attributions
  for insert
  to authenticated
  with check (auth.uid() = user_id);
