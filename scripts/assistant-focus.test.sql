-- Task approval does not imply today's schedule. Morning synthesis owns one
-- exact, ordered, retry-safe focus write; completion still settles present work.
do $$
declare
  src uuid;
  task_a uuid;
  task_b uuid;
  task_later uuid;
  focus_list uuid;
  stamp timestamptz;
  prop uuid := gen_random_uuid();
  planned_prop uuid := gen_random_uuid();
  planned_task uuid;
  planned_entries jsonb;
  receipt jsonb;
begin
  select id into src from assistant_messages
    where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role='user';

  insert into tasks(user_id,title,priority) values
    (auth.uid(),'Morning primary','critical'),
    (auth.uid(),'Morning support','high'),
    (auth.uid(),'Tomorrow task','medium');
  select id into task_a from tasks where title='Morning primary';
  select id into task_b from tasks where title='Morning support';
  select id,updated_at into task_later,stamp from tasks where title='Tomorrow task';

  -- Accepting an ordinary unfinished task change must not schedule it today.
  perform assistant_propose_task(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    prop,task_later,stamp,'{"human_summary":"Prepare tomorrow"}',
    'Task exists for tomorrow',array[src]
  );
  perform assistant_resolve_proposal(prop,true);
  if exists(
    select 1 from daily_focus_items i join daily_focus_lists l on l.id=i.daily_focus_list_id
    where l.user_id=auth.uid() and l.date=(now() at time zone 'America/Chicago')::date
      and i.task_id=task_later and i.focus_status in ('planned','active')
  ) then raise exception 'Task approval incorrectly scheduled future work today'; end if;

  -- Seed an unrelated active item to prove the morning plan replaces, rather
  -- than merely appends to, today's execution list.
  insert into daily_focus_lists(user_id,date)
    values(auth.uid(),(now() at time zone 'America/Chicago')::date)
    returning id into focus_list;
  insert into daily_focus_items(daily_focus_list_id,task_id,position,focus_status,note)
    values(focus_list,task_later,1,'active','Manual earlier choice');

  -- A selected new task is proposed first, then represented by an inert
  -- placeholder in the exact morning order.
  perform assistant_propose_task(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    planned_prop,null,null,
    '{"title":"New morning deliverable","priority":"high","human_summary":"Do this today"}',
    'The completed ritual selected new work',array[src]
  );
  planned_entries:=jsonb_build_array(
    jsonb_build_object('task_id',task_a),
    jsonb_build_object('proposal_id',planned_prop),
    jsonb_build_object('task_id',task_b)
  );
  receipt:=assistant_set_today_focus_plan(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'abababab-abab-4bab-8bab-abababababab',
    planned_entries,
    'Ordered morning agreement',array[src]
  );
  if receipt->'entries'<>planned_entries then
    raise exception 'Focus receipt lost requested order';
  end if;
  if (
    select array_agg(i.task_id order by i.position)
    from daily_focus_items i join daily_focus_lists l on l.id=i.daily_focus_list_id
    where l.user_id=auth.uid() and l.date=(now() at time zone 'America/Chicago')::date
      and i.focus_status in ('planned','active')
  )<>array[task_a,task_b] then raise exception 'Morning focus order was not applied'; end if;
  if not exists(
    select 1 from assistant_task_proposals
    where id=planned_prop
      and planned_focus_date=(now() at time zone 'America/Chicago')::date
      and planned_focus_position=2
  ) then raise exception 'Pending proposal lost its planned focus position'; end if;
  if not exists(
    select 1 from daily_focus_items where task_id=task_later and focus_status='deferred'
      and status_reason='Not selected in the completed morning plan'
  ) then raise exception 'Superseded focus was not auditable'; end if;

  -- Approval resolves only this planned placeholder into its exact position.
  perform assistant_resolve_proposal(planned_prop,true);
  select task_id into planned_task from assistant_task_proposals where id=planned_prop;
  if (
    select array_agg(i.task_id order by i.position)
    from daily_focus_items i join daily_focus_lists l on l.id=i.daily_focus_list_id
    where l.user_id=auth.uid() and l.date=(now() at time zone 'America/Chicago')::date
      and i.focus_status in ('planned','active')
  )<>array[task_a,planned_task,task_b] then
    raise exception 'Accepted planned proposal did not resolve into focus order';
  end if;

  -- Retry returns the original receipt even after the placeholder resolved and
  -- does not duplicate rows.
  receipt:=assistant_set_today_focus_plan(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'abababab-abab-4bab-8bab-abababababab',
    planned_entries,
    'Ordered morning agreement',array[src]
  );
  if (select count(*) from daily_focus_items where task_id in (task_a,planned_task,task_b))<>3 then
    raise exception 'Morning focus retry duplicated items';
  end if;

  -- Completing an already-present task still settles it without adding others.
  select updated_at into stamp from tasks where id=task_b;
  prop:=gen_random_uuid();
  perform assistant_propose_task(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    prop,task_b,stamp,'{"status":"completed"}',
    'Reported completion',array[src]
  );
  perform assistant_resolve_proposal(prop,true);
  if not exists(select 1 from daily_focus_items where task_id=task_b and focus_status='done') then
    raise exception 'Accepted completion did not settle existing focus';
  end if;

  if has_function_privilege('authenticated','assistant_focus_settle_completed_task(uuid)','execute') then
    raise exception 'Private completion helper exposed';
  end if;
end $$;
