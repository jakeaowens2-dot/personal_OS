-- Extend the disposable assistant fixture with the work tables needed by the
-- real activity function. No timer/ledger mutations are involved in this read.
reset role;
create table public.work_blocks(id uuid primary key,user_id uuid references auth.users(id),deleted_at timestamptz);
alter table public.work_blocks enable row level security;
create policy work_blocks_owner on public.work_blocks to authenticated using(user_id=auth.uid());
\ir ../supabase/migrations/20260528023000_add_work_block_attributions.sql
grant select on public.work_blocks,public.work_block_attributions to authenticated;
\ir ../supabase/migrations/20261027000000_task_library_activity.sql

insert into tasks(id,user_id,title) values
 ('71000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Used task'),
 ('71000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Unused task'),
 ('71000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Other owner task');
insert into work_blocks values
 ('72000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null),
 ('72000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',now()),
 ('72000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222',null);
insert into work_block_attributions(user_id,work_block_id,task_id,attribution_label,share_ratio,attributed_minutes,created_at) values
 ('11111111-1111-4111-8111-111111111111','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Used',1,25,'2026-10-01T12:00:00Z'),
 ('11111111-1111-4111-8111-111111111111','72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','Deleted work',1,25,'2026-10-27T12:00:00Z'),
 ('22222222-2222-4222-8222-222222222222','72000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003','Other owner',1,25,'2026-10-26T12:00:00Z');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ begin
 if (select last_used_at from task_library_activity() where task_id='71000000-0000-4000-8000-000000000001') is distinct from '2026-10-01T12:00:00Z'::timestamptz then raise exception 'Activity did not exclude deleted work'; end if;
 if (select last_used_at from task_library_activity() where task_id='71000000-0000-4000-8000-000000000002') is not null then raise exception 'Invented usage for unused task'; end if;
 if exists(select 1 from task_library_activity() where task_id='71000000-0000-4000-8000-000000000003') then raise exception 'Leaked other owner'; end if;
end $$;
update tasks set status='archived',archived_at=now() where id='71000000-0000-4000-8000-000000000001';
do $$ begin
 if exists(select 1 from task_library_activity() where task_id='71000000-0000-4000-8000-000000000001') then raise exception 'Archived task stayed in picker'; end if;
 if (select count(*) from work_block_attributions where task_id='71000000-0000-4000-8000-000000000001')<>2 then raise exception 'Archiving deleted attribution'; end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$ begin
 if exists(select 1 from task_library_activity()) then raise exception 'Anonymous activity exposed'; end if;
end $$;
set role anon;
select test_expect_error('select task_library_activity()','permission denied');
reset role;
select 'PASS: task-library activity ownership, deleted-work exclusion and archived history preservation' as result;
