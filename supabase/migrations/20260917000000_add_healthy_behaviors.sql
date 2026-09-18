alter table public.behavior_events
  drop constraint if exists behavior_events_behavior_type_check;

alter table public.behavior_events
  add constraint behavior_events_behavior_type_check
  check (
    behavior_type in (
      'indulgence',
      'screen_time',
      'exercise',
      'waking_routine',
      'gallon_water'
    )
  );

create unique index if not exists behavior_events_unique_daily_healthy_idx
  on public.behavior_events (
    user_id,
    behavior_type,
    ((occurred_at at time zone 'utc')::date)
  )
  where deleted_at is null
    and behavior_type in ('waking_routine', 'gallon_water');
