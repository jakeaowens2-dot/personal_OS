-- A workspace has one active built-in housekeeping task. Historical account
-- merges can otherwise leave two rows behind and make attribution setup fail.
-- Preserve duplicate rows and their history as archived legacy tasks.

with ranked_housekeeping_tasks as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at asc, id asc
    ) as task_rank
  from public.tasks
  where source = 'system_housekeeping'
)
update public.tasks task
set
  source = 'system_housekeeping_legacy',
  status = 'archived',
  archived_at = coalesce(task.archived_at, timezone('utc', now())),
  updated_by_actor_type = 'system',
  updated_by_actor_label = 'Housekeeping task reconciliation',
  last_change_reason = 'Archived duplicate built-in housekeeping task after account merge'
from ranked_housekeeping_tasks ranked
where task.id = ranked.id
  and ranked.task_rank > 1;

create unique index if not exists tasks_one_system_housekeeping_per_user_idx
  on public.tasks (user_id)
  where source = 'system_housekeeping';
