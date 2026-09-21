-- Included by the disposable database harness while its test turn is active.
reset role;
insert into tasks(user_id,title) values('22222222-2222-4222-8222-222222222222','Other owner prerequisite');
set role authenticated;
do $$
declare src uuid; report uuid; case_study uuid; stamp timestamptz; prop uuid:=gen_random_uuid(); foreign_task uuid; begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 insert into tasks(user_id,title,agent_payload_json) values(auth.uid(),'Prerequisite report','{"tags":["keep"],"dependencies":["Legacy prose note"]}') returning id into report;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,null,null,
   jsonb_build_object('title','Dependent case study','description','Turn the report into a sales asset.','prerequisite_task_ids',jsonb_build_array(report)), 'Requested sequence',array[src]);
 if exists(select 1 from tasks where title='Dependent case study') then raise exception 'Creation happened before approval'; end if;
 if (select prerequisite_snapshot_json->0->>'title' from assistant_task_proposals where id=prop)<>'Prerequisite report' then raise exception 'Missing review labels'; end if;
 perform assistant_resolve_proposal(prop,true);
 perform assistant_resolve_proposal(prop,true);
 select id,updated_at into case_study,stamp from tasks where title='Dependent case study';
 if not exists(select 1 from tasks where id=case_study and description='Turn the report into a sales asset.' and agent_payload_json->'prerequisite_task_ids'=jsonb_build_array(report)) then raise exception 'Description/prerequisite not applied'; end if;
 if (select count(*) from task_revisions where task_id=case_study)<>1 then raise exception 'Duplicate creation'; end if;
 -- Direct JSON editing cannot sneak in a reverse edge or self-link.
 perform test_expect_error(format('update tasks set agent_payload_json=agent_payload_json || %L::jsonb where id=%L',jsonb_build_object('prerequisite_task_ids',jsonb_build_array(case_study)),report),'dependency cycle');
 perform test_expect_error(format('update tasks set agent_payload_json=%L::jsonb where id=%L',jsonb_build_object('prerequisite_task_ids',jsonb_build_array(case_study)),case_study),'itself');
 perform test_expect_error(format('select assistant_propose_task(%L,%L,%L,%L,%L,%L,%L,%L::uuid[])','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),case_study,stamp,'{"prerequisite_task_ids":["33333333-3333-4333-8333-333333333333"]}','Missing reference',array[src]),'unavailable');
 perform test_expect_error(format('select assistant_propose_task(%L,%L,%L,%L,%L,%L,%L,%L::uuid[])','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),case_study,stamp,jsonb_build_object('prerequisite_task_ids',jsonb_build_array(report,report)),'Duplicate reference',array[src]),'Duplicate');
 perform test_expect_error(format('select assistant_propose_task(%L,%L,%L,%L,%L,%L,%L,%L::uuid[])','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),case_study,stamp,'{"description":{"bad":"shape"}}','Bad description',array[src]),'must be strings');
 -- Reject leaves data unchanged; clearing has explicit semantics and preserves other keys.
 prop:=gen_random_uuid();
 select updated_at into stamp from tasks where id=report;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,report,stamp,'{"description":"Discard me"}','Rejected change',array[src]);
 perform assistant_resolve_proposal(prop,false);
 if (select description from tasks where id=report) is not null then raise exception 'Reject mutated task'; end if;
 prop:=gen_random_uuid();
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,report,stamp,'{"description":"Client deliverable","prerequisite_task_ids":[],"human_summary":"Draft underway"}','Description and progress',array[src]);
 perform assistant_resolve_proposal(prop,true);
 if not exists(select 1 from tasks where id=report and description='Client deliverable' and human_summary='Draft underway' and agent_payload_json->'tags'='["keep"]' and agent_payload_json->'dependencies'='["Legacy prose note"]') then raise exception 'Payload lost or fields conflated'; end if;
 select updated_at into stamp from tasks where id=case_study;
 prop:=gen_random_uuid();
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prop,case_study,stamp,'{"description":"","prerequisite_task_ids":[]}','Explicit removal',array[src]);
 perform assistant_resolve_proposal(prop,true);
 if not exists(select 1 from tasks where id=case_study and description is null and agent_payload_json->'prerequisite_task_ids'='[]') then raise exception 'Clearing failed'; end if;
 -- Save one more proposal; change its prerequisite in the next transaction.
 select updated_at into stamp from tasks where id=case_study;
 perform assistant_propose_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','98989898-9898-4989-8989-989898989898',case_study,stamp,jsonb_build_object('prerequisite_task_ids',jsonb_build_array(report)),'Stale reference check',array[src]);
end $$;
update tasks set title='Renamed prerequisite report' where title='Prerequisite report';
select test_expect_error($q$select assistant_resolve_proposal('98989898-9898-4989-8989-989898989898',true)$q$,'prerequisite changed');
do $$ begin
 if not exists(select 1 from assistant_task_proposals where id='98989898-9898-4989-8989-989898989898' and status='pending') then raise exception 'Failed approval settled'; end if;
end $$;
-- Use the real foreign task UUID without exposing it through the authenticated reader.
reset role;
select set_config('test.foreign_task',(select id::text from tasks where title='Other owner prerequisite'),false);
set role authenticated;
do $$ declare src uuid; begin
 select id into src from assistant_messages where turn_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 perform test_expect_error(format('select assistant_propose_task(%L,%L,%L,null,null,%L,%L,%L::uuid[])','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gen_random_uuid(),jsonb_build_object('title','Should fail','prerequisite_task_ids',jsonb_build_array(current_setting('test.foreign_task'))),'Foreign reference',array[src]),'unavailable');
end $$;
