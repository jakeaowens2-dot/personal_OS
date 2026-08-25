-- Index for parent_task_id lookups on the tasks table.

create index if not exists tasks_user_id_parent_task_id_idx
  on public.tasks (user_id, parent_task_id)
  where parent_task_id is not null;