create policy "work_block_attributions_delete_own"
  on public.work_block_attributions
  for delete
  to authenticated
  using (auth.uid() = user_id);
