-- Existing accepted/rejected decisions must all be anchored to the prior response.
do $$ begin
 if exists(select 1 from assistant_task_proposals where status<>'pending' and resolved_message_id is distinct from '20202020-2020-4020-8020-202020202020'::uuid) then raise exception 'Missing decision anchor'; end if;
end $$;
reset role;
insert into assistant_turns(id,user_id,input_json,local_date,status) values('30303030-3030-4030-8030-303030303030','11111111-1111-4111-8111-111111111111','{}',current_date,'completed');
insert into assistant_messages(id,user_id,turn_id,role,text,local_date) values('40404040-4040-4040-8040-404040404040','11111111-1111-4111-8111-111111111111','30303030-3030-4030-8030-303030303030','assistant','Latest completed response',current_date);
-- A different user's newer answer must not be selected.
insert into assistant_turns(id,user_id,input_json,local_date,status) values('50505050-5050-4050-8050-505050505050','22222222-2222-4222-8222-222222222222','{}',current_date,'completed');
insert into assistant_messages(user_id,turn_id,role,text,local_date,created_at) values('22222222-2222-4222-8222-222222222222','50505050-5050-4050-8050-505050505050','assistant','Other owner',current_date,now()+interval '1 second');
set role authenticated;
do $$ declare src uuid; prop uuid:=gen_random_uuid(); begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,null,null,'{"title":"Conversation anchored task"}','Test latest response',array[src]);
 if (select resolved_message_id from assistant_task_proposals where id=prop) is not null then raise exception 'Pending proposal anchored too early'; end if;
 perform assistant_resolve_proposal(prop,false);
 if (select resolved_message_id from assistant_task_proposals where id=prop)<>'40404040-4040-4040-8040-404040404040'::uuid then raise exception 'Did not anchor to most recent owned response'; end if;
 -- Retry an older accepted item after a newer response: its location must not drift.
 perform assistant_resolve_proposal('55555555-5555-4555-8555-555555555555',true);
 if (select resolved_message_id from assistant_task_proposals where id='55555555-5555-4555-8555-555555555555')<>'20202020-2020-4020-8020-202020202020'::uuid then raise exception 'Historical anchor moved on retry'; end if;
end $$;
reset role;
select test_expect_error($q$update assistant_task_proposals set resolved_message_id='40404040-4040-4040-8040-404040404040' where id='55555555-5555-4555-8555-555555555555'$q$,'cannot move');
set role authenticated;
