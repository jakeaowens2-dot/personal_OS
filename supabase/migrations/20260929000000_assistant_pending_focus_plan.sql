-- Preserve the exact ordered morning plan even when selected work still needs
-- task approval. Proposal placeholders are inert until accepted and only the
-- morning synthesis can attach them to today's focus.

alter table public.assistant_task_proposals
  add column if not exists planned_focus_date date,
  add column if not exists planned_focus_position integer;

alter table public.assistant_task_proposals
  drop constraint if exists assistant_task_proposals_planned_focus_pair;
alter table public.assistant_task_proposals
  add constraint assistant_task_proposals_planned_focus_pair
  check (
    (planned_focus_date is null and planned_focus_position is null)
    or (
      planned_focus_date is not null
      and planned_focus_position is not null
      and planned_focus_position between 1 and 8
    )
  );

create index if not exists assistant_task_proposals_planned_focus_idx
  on public.assistant_task_proposals(user_id, planned_focus_date, planned_focus_position)
  where planned_focus_date is not null;

create or replace function public.assistant_focus_on_task_acceptance() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare focus_list uuid;
begin
  if new.status='applied' and old.status='pending' then
    if new.user_id is distinct from auth.uid() then
      raise exception 'Proposal ownership mismatch.';
    end if;
    perform assistant_focus_settle_completed_task(new.task_id);

    -- A planned proposal schedules only on the date the user approved it for.
    -- Late acceptance preserves the task without rewriting a past focus list.
    if new.planned_focus_date=(now() at time zone 'America/Chicago')::date
       and new.planned_focus_position is not null
       and new.task_id is not null then
      insert into daily_focus_lists(user_id,date)
        values(auth.uid(),new.planned_focus_date)
        on conflict(user_id,date) do nothing;
      select id into focus_list from daily_focus_lists
        where user_id=auth.uid() and date=new.planned_focus_date for update;
      insert into daily_focus_items(
        daily_focus_list_id,task_id,position,focus_status,note,status_reason
      ) values(
        focus_list,new.task_id,new.planned_focus_position,'active',
        'Set in Personal Assistant morning plan after task approval',null
      ) on conflict(daily_focus_list_id,task_id) do update set
        position=excluded.position,
        focus_status='active',
        note=excluded.note,
        status_reason=null;
      update daily_focus_lists set updated_at=now() where id=focus_list;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.assistant_focus_on_task_acceptance() from public,anon,authenticated;

create or replace function public.assistant_set_today_focus_plan(
  p_turn uuid,
  p_lease uuid,
  p_operation uuid,
  p_entries jsonb,
  p_reason text,
  p_sources uuid[]
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  focus_list uuid;
  today date := (now() at time zone 'America/Chicago')::date;
  requested_count integer;
  owned_count integer;
  proposal_count integer;
  existing assistant_tool_receipts;
  receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,207));
  perform assistant_require_turn(p_turn,p_lease);
  perform assistant_require_sources(p_sources);
  if jsonb_typeof(p_entries)<>'array' then
    raise exception 'Today focus entries must be an ordered array.';
  end if;
  requested_count:=jsonb_array_length(p_entries);
  if requested_count not between 1 and 8
     or coalesce(length(trim(p_reason)),0) not between 1 and 2000 then
    raise exception 'Today focus requires 1-8 ordered entries and a reason.';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_entries) entry
    where jsonb_typeof(entry)<>'object'
      or exists(select 1 from jsonb_object_keys(entry) key where key not in ('task_id','proposal_id'))
      or (entry ? 'task_id')=(entry ? 'proposal_id')
      or coalesce(entry->>'task_id',entry->>'proposal_id','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Each focus entry needs exactly one valid task or proposal ID.';
  end if;
  if (
    select count(distinct case
      when entry ? 'task_id' then 'task:'||(entry->>'task_id')
      else 'proposal:'||(entry->>'proposal_id') end)
    from jsonb_array_elements(p_entries) entry
  )<>requested_count then
    raise exception 'Today focus entries must be unique.';
  end if;

  select * into existing from assistant_tool_receipts
    where user_id=auth.uid() and turn_id=p_turn and tool='set_today_focus';
  if found then
    if existing.id<>p_operation or existing.result_json->'entries'<>p_entries then
      raise exception 'This morning turn already set a different focus plan.';
    end if;
    return existing.result_json;
  end if;

  select count(*) into owned_count
  from jsonb_array_elements(p_entries) entry
  join tasks t on t.id=(entry->>'task_id')::uuid
  where entry ? 'task_id'
    and t.user_id=auth.uid()
    and t.status in ('open','in_progress','blocked');
  if owned_count<>(select count(*) from jsonb_array_elements(p_entries) entry where entry ? 'task_id') then
    raise exception 'Every task entry must be an existing unfinished owned task.';
  end if;

  select count(*) into proposal_count
  from jsonb_array_elements(p_entries) entry
  join assistant_task_proposals p on p.id=(entry->>'proposal_id')::uuid
  where entry ? 'proposal_id'
    and p.user_id=auth.uid()
    and p.turn_id=p_turn
    and p.status='pending'
    and p.task_id is null
    and coalesce(p.patch_json->>'status','open') in ('open','in_progress','blocked');
  if proposal_count<>(select count(*) from jsonb_array_elements(p_entries) entry where entry ? 'proposal_id') then
    raise exception 'Proposal placeholders must be pending new-task proposals from this morning turn.';
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
      and not task_id=any(coalesce(array(
        select (entry->>'task_id')::uuid
        from jsonb_array_elements(p_entries) entry where entry ? 'task_id'
      ),array[]::uuid[]));

  insert into daily_focus_items(
    daily_focus_list_id,task_id,position,focus_status,note,status_reason
  )
    select focus_list,(entry->>'task_id')::uuid,ordinality,'active',
      'Set in Personal Assistant morning plan',null
    from jsonb_array_elements(p_entries) with ordinality selected(entry,ordinality)
    where entry ? 'task_id'
  on conflict(daily_focus_list_id,task_id) do update set
    position=excluded.position,
    focus_status='active',
    note=coalesce(daily_focus_items.note,excluded.note),
    status_reason=null;

  update assistant_task_proposals set
    planned_focus_date=null,
    planned_focus_position=null
  where user_id=auth.uid()
    and planned_focus_date=today
    and status='pending'
    and not id=any(coalesce(array(
      select (entry->>'proposal_id')::uuid
      from jsonb_array_elements(p_entries) entry where entry ? 'proposal_id'
    ),array[]::uuid[]));

  update assistant_task_proposals p set
    planned_focus_date=today,
    planned_focus_position=selected.ordinality
  from jsonb_array_elements(p_entries) with ordinality selected(entry,ordinality)
  where selected.entry ? 'proposal_id'
    and p.id=(selected.entry->>'proposal_id')::uuid
    and p.user_id=auth.uid()
    and p.turn_id=p_turn
    and p.status='pending';

  update daily_focus_lists set updated_at=now() where id=focus_list;
  receipt:=jsonb_build_object(
    'saved',true,
    'date',today,
    'entries',p_entries,
    'planned_items',(
      select jsonb_agg(
        case when entry ? 'task_id' then jsonb_build_object(
          'position',ordinality,'kind','task','id',t.id,'title',t.title,'status','active'
        ) else jsonb_build_object(
          'position',ordinality,'kind','proposal','id',p.id,
          'title',p.patch_json->>'title','status','pending_approval'
        ) end order by ordinality
      )
      from jsonb_array_elements(p_entries) with ordinality selected(entry,ordinality)
      left join tasks t on entry ? 'task_id' and t.id=(entry->>'task_id')::uuid
      left join assistant_task_proposals p on entry ? 'proposal_id' and p.id=(entry->>'proposal_id')::uuid
    )
  );
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json)
    values(p_operation,auth.uid(),p_turn,'set_today_focus',receipt);
  return receipt;
end $$;

revoke all on function public.assistant_set_today_focus_plan(uuid,uuid,uuid,jsonb,text,uuid[])
  from public,anon;
grant execute on function public.assistant_set_today_focus_plan(uuid,uuid,uuid,jsonb,text,uuid[])
  to authenticated;

-- New clients use the plan-aware function. Keep the historical function for
-- migration replay, but do not expose it to browser roles.
revoke all on function public.assistant_set_today_focus(uuid,uuid,uuid,uuid[],text,uuid[])
  from authenticated;
