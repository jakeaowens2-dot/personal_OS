-- Runs only in the disposable PostgreSQL test container created by the runner.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key,email text,is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
\ir ../supabase/migrations/20260528001500_add_tasks_and_revisions.sql
\ir ../supabase/migrations/20260528011500_add_daily_focus.sql
\ir ../supabase/migrations/20260823000002_add_focus_status_dropped_and_carried_forward.sql
\ir ../supabase/migrations/20260823000003_add_focus_item_carry_forward_metadata.sql
\ir ../supabase/migrations/20260912000000_assistant_daily_planning.sql
\ir ../supabase/migrations/20260921000000_assistant_task_prerequisites.sql
\ir ../supabase/migrations/20260921010000_assistant_accepted_focus.sql
\ir ../supabase/migrations/20260921020000_assistant_chat_decisions.sql
\ir ../supabase/migrations/20260927000000_assistant_morning_focus.sql
\ir ../supabase/migrations/20260929000000_assistant_pending_focus_plan.sql
\ir ../supabase/migrations/20260925000000_add_paper_reading_log.sql
\ir ../supabase/migrations/20260925010000_require_named_workspace_users.sql
\ir ../supabase/migrations/20261020000000_assistant_turn_recovery.sql
grant select,insert,update on daily_focus_lists,daily_focus_items to authenticated;
-- Match Supabase's existing table grants, protected by the existing task RLS.
grant select,insert,update on public.tasks to authenticated;
grant select on public.task_revisions to authenticated;
insert into auth.users values
  ('11111111-1111-4111-8111-111111111111','owner@example.com',false),
  ('22222222-2222-4222-8222-222222222222','other@example.com',false),
  ('33333333-3333-4333-8333-333333333333',null,true);
-- Prior complete response for all normal approval tests.
insert into assistant_turns(id,user_id,input_json,local_date,status) values('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','{}',current_date-1,'completed');
insert into assistant_messages(id,user_id,turn_id,role,text,local_date,created_at) values('20202020-2020-4020-8020-202020202020','11111111-1111-4111-8111-111111111111','10101010-1010-4010-8010-101010101010','assistant','Prior completed response',current_date-1,now()-interval '1 day');

create function public.test_expect_error(statement text,expected text) returns void language plpgsql as $$
declare caught boolean:=false; begin
 begin execute statement; exception when others then
   if position(expected in sqlerrm)=0 then raise exception 'Wrong failure: %, expected %',sqlerrm,expected; end if;
   caught:=true;
 end;
 if not caught then raise exception 'Expected failure, but command succeeded: %',statement; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test_expect_error(
  $q$insert into paper_reading_entries(user_id,title,completed_on,notes) values(auth.uid(),'Anonymous write',current_date,'Must be rejected.')$q$,
  'row-level security'
);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into paper_reading_entries(user_id,title,completed_on,notes)
values(auth.uid(),'Durable knowledge test',current_date,'A sourced reading note.');
do $$ begin
 if (select count(*) from paper_reading_entries)<>1 then raise exception 'Owned paper log insert was not readable'; end if;
end $$;
select assistant_begin_turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"kind":"message","text":"My priority is the offline demo. Please mark it in progress."}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select test_expect_error($q$select assistant_begin_turn('cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"kind":"message","text":"Competing tab"}','dddddddd-dddd-4ddd-8ddd-dddddddddddd')$q$,'Another reply');
do $$
declare src uuid; entry jsonb; receipt jsonb; task uuid; stamp timestamptz; prop uuid:='33333333-3333-4333-8333-333333333333';
begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 entry:=jsonb_build_object('id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','text','Prepare the offline demo','source_ids',jsonb_build_array(src),'origin','user_stated','state','active','title','Offline demo','rationale','Connectivity is unreliable');
 receipt:=assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ffffffff-ffff-4fff-8fff-ffffffffffff','priorities','core',0,entry,'User named a continuing focus');
 if receipt->>'revision'<>'1' then raise exception 'Missing saved receipt'; end if;
 receipt:=assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ffffffff-ffff-4fff-8fff-ffffffffffff','priorities','core',0,entry,'User named a continuing focus');
 if (select count(*) from assistant_memory_revisions)<>1 then raise exception 'Duplicate memory revision'; end if;
 perform test_expect_error(format('select assistant_save_memory(%L,%L,%L,%L,%L,0,%L,%L)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12121212-1212-4212-8212-121212121212','priorities','core',entry::text,'stale overwrite'),'Memory changed');
 perform test_expect_error(format('select assistant_save_memory(%L,%L,%L,%L,%L,1,%L,%L)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12121212-1212-4212-8212-121212121212','priorities','core',(entry||'{"source_ids":["22222222-2222-4222-8222-222222222222"]}')::text,'forged source'),'persisted source');
 insert into tasks(user_id,title) values(auth.uid(),'Offline demo') returning id,updated_at into task,stamp;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,task,stamp,'{"status":"in_progress","human_summary":"Offline path ready; rehearsal remains."}','Explicit progress report',array[src]);
 if (select status from tasks where id=task)<>'open' then raise exception 'Proposal mutated a task'; end if;
 perform assistant_resolve_proposal(prop,true);
 perform assistant_resolve_proposal(prop,true);
 if (select status from tasks where id=task)<>'in_progress' or (select count(*) from task_revisions where task_id=task)<>2 then raise exception 'Approval was not exactly once'; end if;
 select updated_at into stamp from tasks where id=task;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444',task,stamp,'{"status":"completed"}','Completion proposal',array[src]);
 update tasks set status='blocked' where id=task;
 -- now() is transaction-stable, so explicitly move the timestamp after the trigger.
 -- The following competing update is tested outside this DO transaction below.
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','55555555-5555-4555-8555-555555555555',null,null,'{"title":"New pilot task"}','Create request',array[src]);
 perform assistant_resolve_proposal('55555555-5555-4555-8555-555555555555',true);
 perform assistant_resolve_proposal('55555555-5555-4555-8555-555555555555',true);
 if (select count(*) from tasks where title='New pilot task')<>1 then raise exception 'Duplicate task creation'; end if;
end $$;
update tasks set human_summary='Changed in the task vault' where title='Offline demo';
select test_expect_error($q$select assistant_resolve_proposal('44444444-4444-4444-8444-444444444444',true)$q$,'changed after the proposal');
\ir assistant-prerequisites.test.sql
\ir assistant-focus.test.sql
\ir assistant-chat-decisions.test.sql
-- More than three items and an uncertain item survive a published handoff.
do $$ declare src uuid; i integer; entry jsonb; begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for i in 1..5 loop
  entry:=jsonb_build_object('id',gen_random_uuid(),'text','Carry item '||i,'source_ids',jsonb_build_array(src),'disposition',case when i=5 then 'uncertain' else 'relevant_next_day' end,'rationale',case when i=5 then 'Need Jake to confirm the timing' else 'Still needed for the demo' end);
  perform assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),'daily',(now() at time zone 'America/Chicago')::date::text,i-1,entry,'Daily continuity');
 end loop;
 entry:=jsonb_build_object('id','99999999-9999-4999-8999-999999999999','text','Earlier unresolved commitment','source_ids',jsonb_build_array(src),'disposition','relevant_next_day','rationale','It still matters tomorrow');
 perform assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),'daily',((now() at time zone 'America/Chicago')::date-1)::text,0,entry,'Earlier-day fixture');
 perform assistant_publish_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','77777777-7777-4777-8777-777777777777',(now() at time zone 'America/Chicago')::date-1,1,'closeout');
 perform test_expect_error(format('select assistant_publish_review(%L,%L,%L,%L,5,%L)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','66666666-6666-4666-8666-666666666666',(now() at time zone 'America/Chicago')::date,'closeout'),'Prior carry items missing');
 entry:=entry||'{"disposition":"not_relevant_next_day","rationale":"User explicitly reports it is done today"}'::jsonb;
 perform assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),'daily',(now() at time zone 'America/Chicago')::date::text,5,entry,'Accounted for previous carry item');
 perform assistant_publish_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','66666666-6666-4666-8666-666666666666',(now() at time zone 'America/Chicago')::date,6,'closeout');
 perform assistant_present_review('66666666-6666-4666-8666-666666666666');
 perform assistant_present_review('66666666-6666-4666-8666-666666666666');
 if (select jsonb_array_length(entries_json) from assistant_daily_reviews where id='66666666-6666-4666-8666-666666666666')<>6 then raise exception 'Carry items were pruned'; end if;
 if (select count(*) from assistant_review_presentations)<>1 then raise exception 'Duplicate presentation receipt'; end if;
end $$;
-- Simulate an accepted request just before midnight and its reply after midnight.
reset role;
update assistant_messages set local_date=(now() at time zone 'America/Chicago')::date-1 where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role='user';
set role authenticated;
select assistant_finish_turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Saved planning work.',null,true);
do $$ begin
 if not exists(select 1 from assistant_messages answer join assistant_messages request on answer.source_message_id=request.id where answer.role='assistant' and request.role='user' and answer.local_date<>request.local_date) then raise exception 'Midnight response lost its request link'; end if;
end $$;
select assistant_begin_turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"kind":"message","text":"My priority is the offline demo. Please mark it in progress."}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select test_expect_error($q$select assistant_save_memory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),'daily','2026-09-12',5,'{}','Old worker')$q$,'no longer owns');
select test_expect_error($q$insert into assistant_memory_documents(user_id,kind,document_key) values(auth.uid(),'preferences','core')$q$,'permission denied');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$ begin
 if exists(select 1 from assistant_messages where user_id<>auth.uid()) or (select count(*) from assistant_memory_documents)>0 then raise exception 'Cross-user data leak'; end if;
 if (select count(*) from assistant_messages)<>1 then raise exception 'Owned history unexpectedly hidden'; end if;
 if (select count(*) from paper_reading_entries)<>0 then raise exception 'Cross-user paper log leak'; end if;
end $$;
select test_expect_error($q$select assistant_resolve_proposal('44444444-4444-4444-8444-444444444444',true)$q$,'unavailable');
select test_expect_error($q$select assistant_begin_turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"kind":"message","text":"My priority is the offline demo. Please mark it in progress."}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'different input');
select 'PASS: ownership, concurrency, retries, memory revisions, reviewed task writes, carry-forward and presentation receipts' as result;
\ir assistant-turn-recovery.test.sql
\ir task-library.test.sql
