-- Closed decisions belong to the most recent saved assistant response at resolution.
alter table public.assistant_task_proposals add column resolved_message_id uuid references public.assistant_messages(id);
create index assistant_proposals_resolved_message on public.assistant_task_proposals(user_id,resolved_message_id);

-- Reconstruct historical placement using the actual resolution timestamp, never
-- the current latest response (which would make old cards drift forward).
update public.assistant_task_proposals p set resolved_message_id=(
  select m.id from public.assistant_messages m
  where m.user_id=p.user_id and m.role='assistant' and m.created_at<=p.resolved_at
  order by m.created_at desc,m.id desc limit 1
) where p.status<>'pending';

create function public.assistant_anchor_task_decision() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='pending' and new.status in ('applied','rejected') then
    select id into new.resolved_message_id from assistant_messages
      where user_id=new.user_id and role='assistant'
      order by created_at desc,id desc limit 1;
    if new.resolved_message_id is null then
      raise exception 'Wait for a completed assistant response before resolving this change.';
    end if;
  elsif old.status<>'pending' and new.resolved_message_id is distinct from old.resolved_message_id then
    raise exception 'A closed task decision cannot move to another response.';
  end if;
  return new;
end $$;
revoke all on function public.assistant_anchor_task_decision() from public,anon,authenticated;
create trigger assistant_anchor_task_decision before update on public.assistant_task_proposals
for each row execute function public.assistant_anchor_task_decision();
