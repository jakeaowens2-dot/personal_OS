-- Acceptance is the user's agreement: connect that transaction to today's focus.
-- This is not a scheduler and does not repopulate focus just by loading a page.
create function public.assistant_focus_accepted_task(p_task uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks; focus_list uuid; today date:=(now() at time zone 'America/Chicago')::date;
begin
  select * into t from tasks where id=p_task and user_id=auth.uid();
  if not found then raise exception 'Accepted task unavailable.'; end if;
  if t.status not in ('open','in_progress','blocked') then
    update daily_focus_items i set focus_status='done'
      from daily_focus_lists l where i.daily_focus_list_id=l.id and l.user_id=auth.uid()
      and l.date=today and i.task_id=t.id and t.status='completed' and i.focus_status in ('planned','active');
    return;
  end if;
  insert into daily_focus_lists(user_id,date) values(auth.uid(),today)
    on conflict(user_id,date) do nothing;
  select id into focus_list from daily_focus_lists where user_id=auth.uid() and date=today for update;
  insert into daily_focus_items(daily_focus_list_id,task_id,position,focus_status,note)
    select focus_list,t.id,coalesce(max(position),0)+1,'active','Agreed in Personal Assistant'
    from daily_focus_items where daily_focus_list_id=focus_list
    on conflict(daily_focus_list_id,task_id) do nothing;
  -- Existing order, notes, active/deferred/done choices are deliberately preserved.
end $$;
revoke all on function public.assistant_focus_accepted_task(uuid) from public,anon,authenticated;

create function public.assistant_focus_on_acceptance() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='applied' and old.status='pending' then
    if new.user_id is distinct from auth.uid() then raise exception 'Proposal ownership mismatch.'; end if;
    perform assistant_focus_accepted_task(new.task_id);
  end if;
  return new;
end $$;
revoke all on function public.assistant_focus_on_acceptance() from public,anon,authenticated;
create trigger assistant_focus_on_acceptance after update of status on public.assistant_task_proposals
for each row execute function public.assistant_focus_on_acceptance();
