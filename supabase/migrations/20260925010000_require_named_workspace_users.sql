create or replace function public.is_named_workspace_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and email is not null
      and not is_anonymous
  );
$$;

revoke all on function public.is_named_workspace_user() from public, anon;
grant execute on function public.is_named_workspace_user() to authenticated;

do $$
declare
  table_name text;
  protected_tables constant text[] := array[
    'timer_sessions', 'work_blocks', 'ledger_events', 'reward_rules',
    'reward_redemptions', 'tasks', 'task_revisions', 'daily_focus_lists',
    'daily_focus_items', 'behavior_events', 'work_block_attributions',
    'project_trackers', 'project_tracker_items', 'assistant_sessions',
    'assistant_turns', 'assistant_messages', 'assistant_memory_documents',
    'assistant_memory_revisions', 'assistant_tool_receipts',
    'assistant_task_proposals', 'assistant_daily_reviews',
    'assistant_review_presentations', 'paper_reading_entries'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists named_accounts_only on public.%I', table_name);
      execute format(
        'create policy named_accounts_only on public.%I as restrictive for all to authenticated using ((select public.is_named_workspace_user())) with check ((select public.is_named_workspace_user()))',
        table_name
      );
    end if;
  end loop;
end $$;
