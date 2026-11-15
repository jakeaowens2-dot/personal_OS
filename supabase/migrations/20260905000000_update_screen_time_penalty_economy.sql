-- Penalty accounting supports precise minutes. Policy calculations remain
-- effective-dated in application code so historical events are not repriced.

alter table public.behavior_events
  alter column penalty_minutes type numeric(8, 1)
  using penalty_minutes::numeric(8, 1);
