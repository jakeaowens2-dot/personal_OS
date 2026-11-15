-- Task approval and daily scheduling are distinct decisions. An accepted task
-- may be for tomorrow (or later), so acceptance must not add it to today's list.
drop trigger if exists assistant_focus_on_acceptance on public.assistant_task_proposals;
drop function if exists public.assistant_focus_on_acceptance();
drop function if exists public.assistant_focus_accepted_task(uuid);

-- Completion approval may still settle an item already present today. It never
-- introduces or reactivates a focus item.
create function public.assistant_focus_settle_completed_task(p_task uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks; today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into t from tasks where id=p_task and user_id=auth.uid();
  if not found then raise exception 'Accepted task unavailable.'; end if;
  if t.status='completed' then
    update daily_focus_items i set focus_status='done',status_reason='Completed through an accepted assistant task change'
      from daily_focus_lists l
      where i.daily_focus_list_id=l.id and l.user_id=auth.uid() and l.date=today
        and i.task_id=t.id and i.focus_status in ('planned','active');
  end if;
end $$;
revoke all on function public.assistant_focus_settle_completed_task(uuid) from public,anon,authenticated;

create function public.assistant_focus_on_task_acceptance() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='applied' and old.status='pending' then
    if new.user_id is distinct from auth.uid() then raise exception 'Proposal ownership mismatch.'; end if;
    perform assistant_focus_settle_completed_task(new.task_id);
  end if;
  return new;
end $$;
revoke all on function public.assistant_focus_on_task_acceptance() from public,anon,authenticated;
create trigger assistant_focus_on_task_acceptance after update of status on public.assistant_task_proposals
for each row execute function public.assistant_focus_on_task_acceptance();

-- The completed morning ritual has delegated authority to set today's execution
-- list. The active leased turn, persisted user-message sources and receipt make
-- the write bounded, attributable and retry-safe.
create function public.assistant_set_today_focus(
  p_turn uuid,
  p_lease uuid,
  p_operation uuid,
  p_task_ids uuid[],
  p_reason text,
  p_sources uuid[]
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  focus_list uuid;
  today date := (now() at time zone 'America/Chicago')::date;
  requested_count integer;
  owned_count integer;
  existing assistant_tool_receipts;
  receipt jsonb;
begin
  perform assistant_require_turn(p_turn,p_lease);
  perform assistant_require_sources(p_sources);
  requested_count := coalesce(cardinality(p_task_ids),0);
  if requested_count not between 1 and 8 or coalesce(length(trim(p_reason)),0) not between 1 and 2000 then
    raise exception 'Today focus requires 1-8 ordered tasks and a reason.';
  end if;
  if (select count(distinct task_id) from unnest(p_task_ids) task_id)<>requested_count then
    raise exception 'Today focus tasks must be unique.';
  end if;

  select * into existing from assistant_tool_receipts
    where user_id=auth.uid() and turn_id=p_turn and tool='set_today_focus';
  if found then
    if existing.id<>p_operation or existing.result_json->'task_ids'<>to_jsonb(p_task_ids) then
      raise exception 'This morning turn already set a different focus list.';
    end if;
    return existing.result_json;
  end if;

  select count(*) into owned_count from tasks
    where user_id=auth.uid() and id=any(p_task_ids)
      and status in ('open','in_progress','blocked');
  if owned_count<>requested_count then
    raise exception 'Every focus item must be an existing unfinished owned task.';
  end if;

  insert into daily_focus_lists(user_id,date) values(auth.uid(),today)
    on conflict(user_id,date) do nothing;
  select id into focus_list from daily_focus_lists
    where user_id=auth.uid() and date=today for update;

  update daily_focus_items set
    focus_status='deferred',
    status_reason='Not selected in the completed morning plan'
    where daily_focus_list_id=focus_list
      and focus_status in ('planned','active')
      and not (task_id=any(p_task_ids));

  insert into daily_focus_items(daily_focus_list_id,task_id,position,focus_status,note,status_reason)
    select focus_list,task_id,ordinality,'active','Set in Personal Assistant morning plan',null
      from unnest(p_task_ids) with ordinality as selected(task_id,ordinality)
    on conflict(daily_focus_list_id,task_id) do update set
      position=excluded.position,
      focus_status='active',
      note=coalesce(daily_focus_items.note,excluded.note),
      status_reason=null;

  update daily_focus_lists set updated_at=now() where id=focus_list;
  receipt:=jsonb_build_object(
    'saved',true,
    'date',today,
    'task_ids',to_jsonb(p_task_ids),
    'tasks',(select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'priority',t.priority) order by selected.ordinality)
      from unnest(p_task_ids) with ordinality selected(task_id,ordinality)
      join tasks t on t.id=selected.task_id)
  );
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json)
    values(p_operation,auth.uid(),p_turn,'set_today_focus',receipt);
  return receipt;
end $$;

revoke all on function public.assistant_set_today_focus(uuid,uuid,uuid,uuid[],text,uuid[]) from public,anon;
grant execute on function public.assistant_set_today_focus(uuid,uuid,uuid,uuid[],text,uuid[]) to authenticated;
