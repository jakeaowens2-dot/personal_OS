-- Accepted tasks enter today's focus atomically; rejection and retry cannot add duplicates.
do $$ declare src uuid; task uuid; stamp timestamptz; prop uuid:=gen_random_uuid(); focus_id uuid; before_count integer; begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 select count(*) into before_count from daily_focus_items;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,null,null,'{"title":"Focus acceptance test"}','User agreed',array[src]);
 if (select count(*) from daily_focus_items)<>before_count then raise exception 'Proposal added focus before acceptance'; end if;
 perform assistant_resolve_proposal(prop,true);
 perform assistant_resolve_proposal(prop,true);
 select id,updated_at into task,stamp from tasks where title='Focus acceptance test';
 select i.id into focus_id from daily_focus_items i join daily_focus_lists l on l.id=i.daily_focus_list_id where i.task_id=task and l.user_id=auth.uid() and l.date=(now() at time zone 'America/Chicago')::date and i.focus_status='active';
 if focus_id is null or (select count(*) from daily_focus_items where task_id=task)<>1 then raise exception 'Accepted task missing or duplicated in today focus'; end if;
 update daily_focus_items set focus_status='deferred',note='User choice',position=99 where id=focus_id;
 prop:=gen_random_uuid();
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,task,stamp,'{"priority":"high"}','Update task',array[src]);
 perform assistant_resolve_proposal(prop,true);
 if not exists(select 1 from daily_focus_items where id=focus_id and focus_status='deferred' and position=99 and note='User choice') then raise exception 'Acceptance overrode focus choices'; end if;
 prop:=gen_random_uuid();
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,null,null,'{"title":"Rejected focus test"}','Review only',array[src]);
 perform assistant_resolve_proposal(prop,false);
 if exists(select 1 from tasks where title='Rejected focus test') then raise exception 'Rejected proposal created focus task'; end if;
 update daily_focus_items set focus_status='active' where id=focus_id;
 select updated_at into stamp from tasks where id=task;
 prop:=gen_random_uuid();
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,task,stamp,'{"status":"completed"}','Reported completion',array[src]);
 perform assistant_resolve_proposal(prop,true);
 if not exists(select 1 from daily_focus_items where id=focus_id and focus_status='done') then raise exception 'Completion did not settle focus'; end if;
 if has_function_privilege('authenticated','assistant_focus_accepted_task(uuid)','execute') then raise exception 'Private focus helper exposed'; end if;
end $$;
