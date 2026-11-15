-- Use the disposable owner. No synthetic messages enter the live workspace.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select assistant_begin_turn('61000000-0000-4000-8000-000000000001','{"kind":"catch_up","text":"Carryover"}','62000000-0000-4000-8000-000000000001');
-- A refresh must not expire a valid lease, and two background workers cannot run.
select assistant_reconcile_turns();
select test_expect_error($q$select assistant_begin_turn('61000000-0000-4000-8000-000000000002','{"kind":"catch_up","text":"Another review"}','62000000-0000-4000-8000-000000000002')$q$,'Another reply');
select assistant_begin_turn('61000000-0000-4000-8000-000000000003','{"kind":"message","text":"Let us begin","morningAction":"begin"}','62000000-0000-4000-8000-000000000003');
select test_expect_error($q$select assistant_finish_turn('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Late background answer',null,true)$q$,'no longer owns');
select assistant_reconcile_turns();
do $$ begin
  if (select status from assistant_turns where id='61000000-0000-4000-8000-000000000001')<>'failed' then raise exception 'Superseded review not marked interrupted'; end if;
  if (select status from assistant_turns where id='61000000-0000-4000-8000-000000000003')<>'running' then raise exception 'Live foreground was expired'; end if;
end $$;
select test_expect_error($q$select assistant_begin_turn('61000000-0000-4000-8000-000000000004','{"kind":"message","text":"Other chat"}','62000000-0000-4000-8000-000000000004')$q$,'Another reply');
-- Simulate a killed local server. Recovery is owner-scoped and preserves sources.
reset role;
update assistant_sessions set lease_until=now()-interval '1 second' where user_id='11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select assistant_reconcile_turns();
reset role;
do $$ begin
  if (select status from assistant_turns where id='61000000-0000-4000-8000-000000000003')<>'running' then raise exception 'Other user altered the lease'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select assistant_reconcile_turns();
select assistant_reconcile_turns();
do $$ begin
  if exists(select 1 from assistant_turns where status='running') then raise exception 'Abandoned running turn survived'; end if;
  if exists(select 1 from assistant_sessions where active_turn_id is not null) then raise exception 'Expired lease not released'; end if;
  if (select count(*) from assistant_messages where turn_id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003'))<>2 then raise exception 'Recovery removed source messages'; end if;
end $$;
-- Retry has the same request identity and never inserts a duplicate source.
select assistant_begin_turn('61000000-0000-4000-8000-000000000003','{"kind":"message","text":"Let us begin","morningAction":"begin"}','62000000-0000-4000-8000-000000000005');
select test_expect_error($q$select assistant_finish_turn('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000003','Stale answer',null,true)$q$,'no longer owns');
select assistant_finish_turn('61000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000005','First morning question',null,true);
do $$ begin
  if (select count(*) from assistant_messages where turn_id='61000000-0000-4000-8000-000000000003' and role='user')<>1 then raise exception 'Retry duplicated source'; end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test_expect_error('select assistant_reconcile_turns()','Sign in');
select 'PASS: foreground precedence, expired-lease recovery, worker fencing, retry identity and ownership' as result;
