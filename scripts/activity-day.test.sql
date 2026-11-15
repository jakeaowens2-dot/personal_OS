-- Run against a fresh disposable PostgreSQL database, never production.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text,is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
\ir ../supabase/migrations/20260520233500_initial_schema.sql
\ir ../supabase/migrations/20260528001500_add_tasks_and_revisions.sql
\ir ../supabase/migrations/20260528011500_add_daily_focus.sql
\ir ../supabase/migrations/20260823000002_add_focus_status_dropped_and_carried_forward.sql
\ir ../supabase/migrations/20260823000003_add_focus_item_carry_forward_metadata.sql
\ir ../supabase/migrations/20260528023000_add_work_block_attributions.sql
\ir ../supabase/migrations/20260528103000_add_ledger_event_correction_fields.sql
\ir ../supabase/migrations/20260823000001_add_behavior_events.sql
\ir ../supabase/migrations/20260917000000_add_healthy_behaviors.sql
\ir ../supabase/migrations/20260921000001_add_healthy_behavior_outcomes.sql
\ir ../supabase/migrations/20260912000000_assistant_daily_planning.sql
\ir ../supabase/migrations/20260921000000_assistant_task_prerequisites.sql
\ir ../supabase/migrations/20260921010000_assistant_accepted_focus.sql
\ir ../supabase/migrations/20260921020000_assistant_chat_decisions.sql
\ir ../supabase/migrations/20260927000000_assistant_morning_focus.sql
\ir ../supabase/migrations/20260929000000_assistant_pending_focus_plan.sql
\ir ../supabase/migrations/20260925010000_require_named_workspace_users.sql
\ir ../supabase/migrations/20261020000000_assistant_turn_recovery.sql

insert into auth.users values('11111111-1111-4111-8111-111111111111','owner@example.com',false);
insert into timer_sessions(id,user_id,mode,planned_minutes) values('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','work',50);
insert into tasks(id,user_id,title) values('20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Preserved attribution');
insert into work_blocks(id,user_id,timer_session_id,earned_at,duration_minutes) values('30000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','2026-11-15T10:30:00Z',50);
insert into ledger_events(id,user_id,event_type,delta_work_blocks,delta_reward_blocks,source,metadata,created_at) values('40000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','work_earned',1,0,'test','{"work_block_id":"30000000-0000-4000-8000-000000000001"}','2026-11-15T10:30:00Z');
insert into work_block_attributions(user_id,work_block_id,task_id,attribution_label,share_ratio,attributed_minutes) values('11111111-1111-4111-8111-111111111111','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Preserved attribution',1,50);
create temporary table before_work as select to_jsonb(w) as row from work_blocks w;
create temporary table before_ledger as select to_jsonb(l) as row from ledger_events l;
create temporary table before_attributions as select to_jsonb(a) as row from work_block_attributions a;

\ir ../supabase/migrations/20261115000000_waking_day_policy.sql
do $$ begin
 if exists(select row from before_work except select to_jsonb(w)-'activity_date' from work_blocks w) then raise exception 'Legacy work changed'; end if;
 if exists(select row from before_ledger except select to_jsonb(l)-'activity_date' from ledger_events l) then raise exception 'Legacy ledger changed'; end if;
 if exists(select row from before_attributions except select to_jsonb(a) from work_block_attributions a) then raise exception 'Attribution changed'; end if;
 if exists(select 1 from work_blocks where activity_date is not null) then raise exception 'Historical dates were backfilled'; end if;
 if productivity_day('2026-11-16T11:59:59Z')<>date '2026-11-15' or productivity_day('2026-11-16T12:00:00Z')<>date '2026-11-16' then raise exception '4am winter boundary failed'; end if;
 if productivity_day('2026-03-08T10:59:59Z')<>date '2026-03-07' or productivity_day('2026-03-08T11:00:00Z')<>date '2026-03-08' then raise exception 'Spring DST failed'; end if;
 if productivity_day('2026-11-01T11:59:59Z')<>date '2026-10-31' or productivity_day('2026-11-01T12:00:00Z')<>date '2026-11-01' then raise exception 'Fall DST failed'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'assistant_%' and position('(now() at time zone ''America/Chicago'')::date' in p.prosrc)>0) then raise exception 'Assistant date policy diverged'; end if;
end $$;
-- Same-timestamp legacy edits cannot move a day; new records and explicit date
-- moves must agree across work, ledger, and task attribution timestamps.
update work_blocks set earned_at=earned_at,duration_minutes=75 where id='30000000-0000-4000-8000-000000000001';
do $$ begin if (select activity_date from work_blocks where id='30000000-0000-4000-8000-000000000001') is not null then raise exception 'Non-date edit relabeled history'; end if; end $$;
insert into work_blocks(id,user_id,timer_session_id,earned_at,duration_minutes) values('30000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','2026-11-16T10:30:00Z',50);
insert into ledger_events(id,user_id,event_type,delta_work_blocks,delta_reward_blocks,source,metadata,created_at) values('40000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','work_earned',1,0,'test','{"work_block_id":"30000000-0000-4000-8000-000000000002"}','2026-11-16T10:30:00Z');
do $$ begin
 if (select activity_date from work_blocks where id='30000000-0000-4000-8000-000000000002')<>date '2026-11-15' then raise exception 'New work assigned wrong day'; end if;
 if (select activity_date from ledger_events where id='40000000-0000-4000-8000-000000000002')<>date '2026-11-15' then raise exception 'Ledger disagrees with work'; end if;
end $$;
update work_blocks set earned_at='2026-11-16T12:30:00Z' where id='30000000-0000-4000-8000-000000000002';
update ledger_events set created_at='2026-11-16T12:30:00Z' where id='40000000-0000-4000-8000-000000000002';
do $$ begin if (select activity_date from ledger_events where id='40000000-0000-4000-8000-000000000002')<>date '2026-11-16' then raise exception 'Explicit date move failed'; end if; end $$;
insert into behavior_events(user_id,behavior_type,occurred_at,healthy_behavior_succeeded) values('11111111-1111-4111-8111-111111111111','gallon_water','2026-11-16T10:30:00Z',true);
do $$ declare caught boolean:=false; begin
 begin insert into behavior_events(user_id,behavior_type,occurred_at,healthy_behavior_succeeded) values('11111111-1111-4111-8111-111111111111','gallon_water','2026-11-15T20:30:00Z',true); exception when unique_violation then caught:=true; end;
 if not caught then raise exception 'Duplicate healthy entry within one waking day accepted'; end if;
end $$;
select 'PASS: forward-only day labels, timestamps, attribution links, DST, edits, healthy uniqueness and assistant routing' as result;
