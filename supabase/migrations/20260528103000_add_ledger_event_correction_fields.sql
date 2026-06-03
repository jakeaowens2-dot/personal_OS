alter table public.timer_sessions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

alter table public.work_blocks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

alter table public.ledger_events
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

alter table public.reward_rules
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

alter table public.reward_redemptions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

alter table public.work_block_attributions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_label text,
  add column if not exists deletion_reason text;

create policy "work_block_attributions_update_own"
  on public.work_block_attributions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
