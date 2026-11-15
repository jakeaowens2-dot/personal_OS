-- Recover abandoned leases without deleting requests, receipts or checkpoints.
create or replace function public.assistant_reconcile_turns() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s assistant_sessions;
begin
  if not public.is_named_workspace_user() then raise exception 'Sign in to Personal OS first.'; end if;
  select * into s from assistant_sessions where user_id=auth.uid() for update;
  if not found then return; end if;
  update assistant_turns set status='failed',
    error='The reply was interrupted or its lease expired. Saved messages and writes are preserved.',updated_at=now()
    where user_id=auth.uid() and status='running'
      and not (id is not distinct from s.active_turn_id and coalesce(s.lease_until>now(),false));
  if s.lease_until is null or s.lease_until<=now() then
    update assistant_sessions set active_turn_id=null,lease_id=null,lease_until=null where user_id=auth.uid();
  end if;
end $$;
revoke all on function public.assistant_reconcile_turns() from public,anon;
grant execute on function public.assistant_reconcile_turns() to authenticated;

create or replace function public.assistant_begin_turn(p_id uuid,p_input jsonb,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s assistant_sessions; t assistant_turns; d date := (now() at time zone 'America/Chicago')::date; src uuid;
begin
  if not public.is_named_workspace_user() then raise exception 'Sign in to Personal OS first.'; end if;
  if jsonb_typeof(p_input)<>'object' or p_input->>'kind' not in ('message','closeout','catch_up') or coalesce(length(p_input->>'text'),0) not between 1 and 8000 then raise exception 'Invalid assistant input.'; end if;
  insert into assistant_sessions(user_id) values(auth.uid()) on conflict do nothing;
  select * into s from assistant_sessions where user_id=auth.uid() for update;
  select * into t from assistant_turns where id=p_id;
  if found then
    if t.user_id<>auth.uid() or t.input_json<>p_input then raise exception 'Operation ID already used for different input.'; end if;
    if t.status='completed' then return to_jsonb(t); end if;
  end if;
  if s.lease_until>now() then
    -- Foreground work may supersede only background carryover, never another
    -- live foreground chat. A replaced worker loses its lease before it can write.
    if p_input->>'kind'='catch_up' or not exists(
      select 1 from assistant_turns where id=s.active_turn_id and user_id=auth.uid()
        and input_json->>'kind'='catch_up'
    ) then raise exception 'Another reply is still running. Wait before retrying.'; end if;
    update assistant_turns set status='failed',
      error='Carryover review paused for foreground conversation. Saved work is preserved.',updated_at=now()
      where id=s.active_turn_id and user_id=auth.uid() and status='running';
  end if;
  perform assistant_reconcile_turns();
  src := (p_input->>'sourceMessageId')::uuid;
  if src is not null then perform assistant_require_sources(array[src]); end if;
  insert into assistant_turns(id,user_id,input_json,local_date,status) values(p_id,auth.uid(),p_input,d,'running')
    on conflict(id) do update set status='running',error=null,updated_at=now();
  insert into assistant_messages(user_id,turn_id,role,text,local_date,source_message_id)
    values(auth.uid(),p_id,case when p_input->>'kind'='catch_up' then 'system' else 'user' end,p_input->>'text',d,src)
    on conflict(turn_id,role) do nothing;
  update assistant_sessions set active_turn_id=p_id,lease_id=p_lease,lease_until=now()+interval '5 minutes' where user_id=auth.uid();
  select * into t from assistant_turns where id=p_id;
  return to_jsonb(t);
end $$;
