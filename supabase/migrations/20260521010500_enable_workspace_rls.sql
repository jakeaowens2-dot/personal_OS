alter table public.timer_sessions enable row level security;
alter table public.work_blocks enable row level security;
alter table public.ledger_events enable row level security;
alter table public.reward_rules enable row level security;
alter table public.reward_redemptions enable row level security;

create policy "timer_sessions_select_own"
  on public.timer_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "timer_sessions_insert_own"
  on public.timer_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "timer_sessions_update_own"
  on public.timer_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "timer_sessions_delete_own"
  on public.timer_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "work_blocks_select_own"
  on public.work_blocks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "work_blocks_insert_own"
  on public.work_blocks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "work_blocks_update_own"
  on public.work_blocks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "work_blocks_delete_own"
  on public.work_blocks
  for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "ledger_events_select_own"
  on public.ledger_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "ledger_events_insert_own"
  on public.ledger_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "ledger_events_update_own"
  on public.ledger_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "ledger_events_delete_own"
  on public.ledger_events
  for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "reward_rules_select_own"
  on public.reward_rules
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "reward_rules_insert_own"
  on public.reward_rules
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "reward_rules_update_own"
  on public.reward_rules
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reward_rules_delete_own"
  on public.reward_rules
  for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "reward_redemptions_select_own"
  on public.reward_redemptions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "reward_redemptions_insert_own"
  on public.reward_redemptions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "reward_redemptions_update_own"
  on public.reward_redemptions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reward_redemptions_delete_own"
  on public.reward_redemptions
  for delete
  to authenticated
  using (auth.uid() = user_id);
