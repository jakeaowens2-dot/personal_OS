-- Read-only, owner-scoped activity: never touch tasks merely to rank the picker.
create index if not exists work_block_attributions_user_task_created_idx
  on public.work_block_attributions(user_id,task_id,created_at desc);

create or replace function public.task_library_activity()
returns table(task_id uuid,last_used_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
  select t.id,max(a.created_at) filter (where w.id is not null)
  from tasks t
  left join work_block_attributions a on a.task_id=t.id and a.user_id=auth.uid()
  left join work_blocks w on w.id=a.work_block_id and w.user_id=auth.uid() and w.deleted_at is null
  where t.user_id=auth.uid() and public.is_named_workspace_user() and t.status<>'archived'
  group by t.id
$$;
revoke all on function public.task_library_activity() from public,anon;
grant execute on function public.task_library_activity() to authenticated;
