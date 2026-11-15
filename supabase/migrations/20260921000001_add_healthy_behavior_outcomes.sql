alter table public.behavior_events
  add column if not exists healthy_behavior_succeeded boolean;

-- Healthy behaviors were success-only before daily check-ins existed.
update public.behavior_events
set healthy_behavior_succeeded = true
where behavior_type in ('waking_routine', 'gallon_water')
  and healthy_behavior_succeeded is null;
