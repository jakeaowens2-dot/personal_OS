-- Unify the daily-focus status model.
--   focus_status: planned | active | done | deferred | dropped
-- and add a carried_forward flag (lingering-task marker) to daily_focus_items.
-- Task status vocabulary is unchanged: open | in_progress | blocked | completed | archived.

alter table public.daily_focus_items
  drop constraint if exists daily_focus_items_focus_status_check;

alter table public.daily_focus_items
  add constraint daily_focus_items_focus_status_check
  check (focus_status in ('planned', 'active', 'done', 'deferred', 'dropped'));

alter table public.daily_focus_items
  add column if not exists carried_forward boolean not null default false;
