-- Reviewed descriptions and canonical task-ID prerequisites; no data backfill.
alter table public.assistant_task_proposals add column prerequisite_snapshot_json jsonb;

-- Private helper: all referenced tasks must belong to the caller. Returning a
-- snapshot lets approval detect renamed/completed/edited prerequisites too.
create function public.assistant_prerequisite_snapshot(p_task uuid,p_ids jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[]; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if jsonb_typeof(p_ids) is distinct from 'array' then raise exception 'Prerequisites must be an array.'; end if;
  if jsonb_array_length(p_ids)>30 or exists(select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Invalid prerequisite task IDs.'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_ids);
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate prerequisites.'; end if;
  if p_task=any(ids) then raise exception 'A task cannot depend on itself.'; end if;
  -- Row locks preserve the checked title/status/version through the transaction.
  perform id from tasks where user_id=auth.uid() and id=any(ids) order by id for share;
  if (select count(*) from tasks where user_id=auth.uid() and id=any(ids) and status<>'archived')<>cardinality(ids) then raise exception 'Prerequisite unavailable or archived.'; end if;
  if p_task is not null and exists(
    with recursive reachable(id) as (
      select unnest(ids)
      union
      select dependency.value::uuid from reachable r join tasks t on t.id=r.id and t.user_id=auth.uid()
      cross join lateral jsonb_array_elements_text(coalesce(t.agent_payload_json->'prerequisite_task_ids','[]'::jsonb)) dependency
    ) select 1 from reachable where id=p_task
  ) then raise exception 'Prerequisites would create a dependency cycle.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'updated_at',updated_at) order by id),'[]'::jsonb)
    into result from tasks where user_id=auth.uid() and id=any(ids);
  return result;
end $$;
revoke all on function public.assistant_prerequisite_snapshot(uuid,jsonb) from public,anon,authenticated;

-- Serialize link changes even when a task is edited directly in the task vault.
-- Existing free-text dependencies remain untouched and are never cast to UUIDs.
create function public.validate_task_prerequisites() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if (new.agent_payload_json->'prerequisite_task_ids') is not distinct from (old.agent_payload_json->'prerequisite_task_ids') then return new; end if;
  elsif not (new.agent_payload_json ? 'prerequisite_task_ids') then return new;
  end if;
  if new.user_id is distinct from auth.uid() then raise exception 'Prerequisite ownership mismatch.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,207));
  perform assistant_prerequisite_snapshot(new.id,coalesce(new.agent_payload_json->'prerequisite_task_ids','[]'::jsonb));
  return new;
end $$;
revoke all on function public.validate_task_prerequisites() from public,anon,authenticated;
create trigger validate_task_prerequisites before insert or update of agent_payload_json on public.tasks
for each row execute function public.validate_task_prerequisites();

create or replace function public.assistant_propose_task(p_turn uuid,p_lease uuid,p_id uuid,p_task uuid,p_expected timestamptz,p_patch jsonb,p_reason text,p_sources uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks; p assistant_task_proposals; receipt jsonb; prereqs jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 207));
  perform assistant_require_turn(p_turn,p_lease); perform assistant_require_sources(p_sources);
  if jsonb_typeof(p_patch)<>'object' or p_patch='{}' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','status','priority','human_summary','description','prerequisite_task_ids')) or coalesce(length(p_reason),0) not between 1 and 2000 then raise exception 'Unsupported task proposal.'; end if;
  if exists(select 1 from jsonb_each(p_patch) where key <> 'prerequisite_task_ids' and jsonb_typeof(value)<>'string') then raise exception 'Task text fields must be strings.'; end if;
  if (p_patch ? 'description' and length(p_patch->>'description')>6000) then raise exception 'Description too long.'; end if;
  if (p_patch ? 'title' and coalesce(length(trim(p_patch->>'title')),0) not between 1 and 300) or
     (p_patch ? 'human_summary' and coalesce(length(p_patch->>'human_summary'),0)>6000) or
     (p_patch ? 'status' and coalesce(p_patch->>'status','') not in ('open','in_progress','blocked','completed')) or
     (p_patch ? 'priority' and coalesce(p_patch->>'priority','') not in ('low','medium','high','critical')) then raise exception 'Invalid task fields.'; end if;
  select * into p from assistant_task_proposals where id=p_id;
  if found then
    if p.user_id<>auth.uid() or p.turn_id<>p_turn or (case when p.before_json is null then null else p.task_id end) is distinct from p_task or p.patch_json<>p_patch or p.reason<>p_reason or p.expected_updated_at is distinct from p_expected or p.source_ids<>p_sources then raise exception 'Proposal operation reused with different content.'; end if;
    return jsonb_build_object('proposed',true,'proposal_id',p.id,'status',p.status);
  end if;
  if p_task is null then
    if coalesce(length(trim(p_patch->>'title')),0)=0 then raise exception 'New tasks need a title.'; end if;
  else
    select * into t from tasks where id=p_task and user_id=auth.uid();
    if not found or t.updated_at is distinct from p_expected then raise exception 'Task changed or is unavailable. Read its current state before proposing.'; end if;
    if t.status='archived' then raise exception 'Restore archived tasks in the task vault first.'; end if;
  end if;
  prereqs:=assistant_prerequisite_snapshot(p_task,coalesce(p_patch->'prerequisite_task_ids',t.agent_payload_json->'prerequisite_task_ids','[]'::jsonb));
  insert into assistant_task_proposals(id,user_id,turn_id,task_id,expected_updated_at,patch_json,before_json,reason,source_ids,prerequisite_snapshot_json)
    values(p_id,auth.uid(),p_turn,p_task,p_expected,p_patch,case when p_task is null then null else to_jsonb(t) end,p_reason,p_sources,prereqs);
  receipt:=jsonb_build_object('proposed',true,'proposal_id',p_id,'status','pending');
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json) values(p_id,auth.uid(),p_turn,'propose_task',receipt);
  return receipt;
end $$;

create or replace function public.assistant_resolve_proposal(p_id uuid,p_apply boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p assistant_task_proposals; t tasks; s text; new_task uuid; prereqs jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 207));
  select * into p from assistant_task_proposals where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Proposal unavailable.'; end if;
  if p.status<>'pending' then return to_jsonb(p); end if;
  if p_apply then
    -- Revalidate links at acceptance, not just at proposal time. Legacy proposals
    -- have no snapshot and remain valid under their original narrow contract.
    if p.prerequisite_snapshot_json is not null then
      prereqs:=assistant_prerequisite_snapshot(p.task_id,coalesce(p.patch_json->'prerequisite_task_ids',p.before_json->'agent_payload_json'->'prerequisite_task_ids','[]'::jsonb));
      if prereqs is distinct from p.prerequisite_snapshot_json then
        raise exception 'A prerequisite changed after the proposal. Ask the assistant to refresh it; nothing was applied.';
      end if;
    end if;
    if p.task_id is null then
      s:=coalesce(p.patch_json->>'status','open');
      insert into tasks(user_id,title,status,priority,human_summary,description,agent_payload_json,completed_at,source,updated_by_actor_type,updated_by_actor_label,last_change_reason)
        values(auth.uid(),p.patch_json->>'title',s,coalesce(p.patch_json->>'priority','medium'),p.patch_json->>'human_summary',nullif(trim(p.patch_json->>'description'),''),case when p.patch_json ? 'prerequisite_task_ids' then jsonb_build_object('prerequisite_task_ids',p.patch_json->'prerequisite_task_ids') else '{}'::jsonb end,case when s='completed' then now() else null end,'assistant','human','Approved assistant proposal',p.reason) returning id into new_task;
    else
      select * into t from tasks where id=p.task_id and user_id=auth.uid() for update;
      if not found or t.updated_at is distinct from p.expected_updated_at then raise exception 'This task changed after the proposal. Ask the assistant to refresh it; nothing was applied.'; end if;
      s:=coalesce(p.patch_json->>'status',t.status);
      update tasks set title=coalesce(p.patch_json->>'title',title),status=s,priority=coalesce(p.patch_json->>'priority',priority),
        human_summary=case when p.patch_json ? 'human_summary' then p.patch_json->>'human_summary' else human_summary end,
        description=case when p.patch_json ? 'description' then nullif(trim(p.patch_json->>'description'),'') else description end,
        agent_payload_json=case when p.patch_json ? 'prerequisite_task_ids' then agent_payload_json || jsonb_build_object('prerequisite_task_ids',p.patch_json->'prerequisite_task_ids') else agent_payload_json end,
        completed_at=case when s='completed' then coalesce(completed_at,now()) else null end,
        updated_by_actor_type='human',updated_by_actor_label='Approved assistant proposal',last_change_reason=p.reason
        where id=t.id and user_id=auth.uid();
      new_task:=t.id;
    end if;
  end if;
  update assistant_task_proposals set status=case when p_apply then 'applied' else 'rejected' end,
    task_id=coalesce(new_task,task_id),resolved_at=now() where id=p_id returning * into p;
  return to_jsonb(p);
end $$;
