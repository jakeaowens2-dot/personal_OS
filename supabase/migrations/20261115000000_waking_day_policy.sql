-- Forward-only: no UPDATE/backfill. NULL activity_date retains legacy calendar
-- attribution; only new rows (or explicit effective-timestamp edits) get a label.
create or replace function public.productivity_day(p_at timestamptz default now())
returns date language sql stable set search_path='' as $$
  select ((p_at at time zone 'America/Los_Angeles') - interval '4 hours')::date
$$;
revoke all on function public.productivity_day(timestamptz) from public,anon;
grant execute on function public.productivity_day(timestamptz) to authenticated;

alter table public.work_blocks add column if not exists activity_date date;
alter table public.ledger_events add column if not exists activity_date date;
alter table public.behavior_events add column if not exists activity_date date;

create or replace function public.stamp_activity_date() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare effective_at timestamptz; previous_at timestamptz; linked_day date;
begin
  if tg_table_name='work_blocks' then
    effective_at:=new.earned_at;
    if tg_op='UPDATE' then previous_at:=old.earned_at; end if;
  elsif tg_table_name='ledger_events' then
    effective_at:=new.created_at;
    if tg_op='UPDATE' then previous_at:=old.created_at; end if;
  else
    effective_at:=new.occurred_at;
    if tg_op='UPDATE' then previous_at:=old.occurred_at; end if;
  end if;
  if tg_op='INSERT' or effective_at is distinct from previous_at then
    if tg_table_name='ledger_events' then
      if new.event_type='work_earned' then
        select activity_date into linked_day from work_blocks
          where id=nullif(new.metadata->>'work_block_id','')::uuid and user_id=new.user_id;
      end if;
    end if;
    if tg_op='INSERT' then
      new.activity_date:=coalesce(new.activity_date,linked_day,productivity_day(effective_at));
    else
      new.activity_date:=coalesce(linked_day,productivity_day(effective_at));
    end if;
  end if;
  return new;
end $$;
revoke all on function public.stamp_activity_date() from public,anon;

create trigger work_blocks_activity_day before insert or update of earned_at on public.work_blocks
  for each row execute function public.stamp_activity_date();
create trigger ledger_events_activity_day before insert or update of created_at on public.ledger_events
  for each row execute function public.stamp_activity_date();
create trigger behavior_events_activity_day before insert or update of occurred_at on public.behavior_events
  for each row execute function public.stamp_activity_date();

-- Legacy uniqueness keeps its prior UTC-calendar interpretation; new healthy
-- check-ins use their persisted waking day, including the midnight–4am window.
drop index if exists public.behavior_events_unique_daily_healthy_idx;
create unique index behavior_events_unique_daily_healthy_idx
  on public.behavior_events(user_id,behavior_type,(coalesce(activity_date,(occurred_at at time zone 'utc')::date)))
  where deleted_at is null and behavior_type in ('waking_routine','gallon_water');

-- Keep existing audited implementations/permissions, replacing only their
-- definition of "today". Historical messages, focus dates and graph threads
-- are never re-keyed. Functions not present on a given deployment are skipped.
do $$
declare fn record; definition text; needle constant text := '(now() at time zone ''America/Chicago'')::date';
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'assistant_begin_turn','assistant_finish_turn','assistant_save_memory',
      'assistant_publish_review','assistant_present_review','assistant_set_today_focus',
      'assistant_set_today_focus_plan','assistant_focus_on_task_acceptance','assistant_focus_settle_completed_task'
    ) and position(needle in p.prosrc)>0
  loop
    definition:=pg_get_functiondef(fn.oid);
    execute replace(definition,needle,'public.productivity_day()');
  end loop;
end $$;
