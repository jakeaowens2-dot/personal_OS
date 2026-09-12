-- Additive, authenticated daily-planning pilot. Existing tasks remain canonical.
create table public.assistant_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  runtime_session_id uuid not null default gen_random_uuid(),
  active_turn_id uuid,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.assistant_turns (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  input_json jsonb not null,
  local_date date not null,
  status text not null check (status in ('running','completed','failed')),
  memory_status text not null default 'pending' check (memory_status in ('pending','reviewed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null references public.assistant_turns(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  text text not null check (char_length(text) between 1 and 32000),
  local_date date not null,
  source_message_id uuid references public.assistant_messages(id),
  created_at timestamptz not null default now(),
  unique(turn_id, role)
);
create index assistant_messages_user_date on public.assistant_messages(user_id,local_date,created_at,id);

create table public.assistant_memory_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('preferences','daily','priorities')),
  document_key text not null,
  schema_version integer not null default 1 check (schema_version=1),
  revision integer not null default 0,
  content_json jsonb not null default '{"entries":[]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,kind,document_key),
  check ((kind='daily' and document_key ~ '^\d{4}-\d{2}-\d{2}$') or (kind<>'daily' and document_key='core'))
);

create table public.assistant_memory_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.assistant_memory_documents(id) on delete cascade,
  revision integer not null,
  operation_id uuid not null,
  turn_id uuid not null references public.assistant_turns(id),
  request_json jsonb not null,
  content_json jsonb not null,
  reason text not null,
  source_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique(user_id,operation_id), unique(document_id,revision)
);

create table public.assistant_task_proposals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null references public.assistant_turns(id),
  task_id uuid references public.tasks(id),
  expected_updated_at timestamptz,
  patch_json jsonb not null,
  before_json jsonb,
  reason text not null,
  source_ids uuid[] not null,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.assistant_daily_reviews (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.assistant_memory_documents(id),
  local_date date not null,
  revision integer not null,
  origin text not null check (origin in ('closeout','catch_up')),
  entries_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,local_date,revision)
);
create table public.assistant_review_presentations (
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null references public.assistant_daily_reviews(id) on delete cascade,
  view_date date not null,
  presented_at timestamptz not null default now(),
  primary key(user_id,review_id,view_date)
);
create table public.assistant_tool_receipts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null references public.assistant_turns(id),
  tool text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);

-- No direct client writes: all mutations below derive ownership from auth.uid().
do $$ declare n text; begin
  foreach n in array array['assistant_sessions','assistant_turns','assistant_messages','assistant_memory_documents','assistant_memory_revisions','assistant_task_proposals','assistant_daily_reviews','assistant_review_presentations','assistant_tool_receipts'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('create policy select_own on public.%I for select to authenticated using (user_id=auth.uid())',n);
    execute format('revoke all on public.%I from anon, authenticated',n);
    execute format('grant select on public.%I to authenticated',n);
  end loop;
end $$;

create function public.assistant_require_turn(p_turn uuid,p_lease uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not exists(select 1 from assistant_sessions where user_id=auth.uid() and active_turn_id=p_turn and lease_id=p_lease and lease_until>now()) then
    raise exception 'This turn no longer owns the assistant. Reload before retrying.';
  end if;
end $$;

create function public.assistant_require_sources(p_sources uuid[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(cardinality(p_sources),0)=0 or exists(select 1 from unnest(p_sources) s where not exists(select 1 from assistant_messages m where m.id=s and m.user_id=auth.uid())) then
    raise exception 'Every memory or proposal needs owned, persisted source messages.';
  end if;
end $$;

create function public.assistant_begin_turn(p_id uuid,p_input jsonb,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s assistant_sessions; t assistant_turns; d date := (now() at time zone 'America/Chicago')::date; src uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to Personal OS first.'; end if;
  if jsonb_typeof(p_input)<>'object' or p_input->>'kind' not in ('message','closeout','catch_up') or coalesce(length(p_input->>'text'),0) not between 1 and 8000 then raise exception 'Invalid assistant input.'; end if;
  insert into assistant_sessions(user_id) values(auth.uid()) on conflict do nothing;
  select * into s from assistant_sessions where user_id=auth.uid() for update;
  select * into t from assistant_turns where id=p_id;
  if found then
    if t.user_id<>auth.uid() or t.input_json<>p_input then raise exception 'Operation ID already used for different input.'; end if;
    if t.status='completed' then return to_jsonb(t); end if;
  end if;
  if s.lease_until>now() then raise exception 'Another reply is still running. Wait before retrying.'; end if;
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

create function public.assistant_finish_turn(p_turn uuid,p_lease uuid,p_answer text,p_error text,p_reviewed boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform assistant_require_turn(p_turn,p_lease);
  if p_error is null then
    if coalesce(length(trim(p_answer)),0)=0 then raise exception 'Empty assistant answer.'; end if;
    insert into assistant_messages(user_id,turn_id,role,text,local_date,source_message_id)
      values(auth.uid(),p_turn,'assistant',p_answer,(now() at time zone 'America/Chicago')::date,
        (select id from assistant_messages where turn_id=p_turn and user_id=auth.uid() and role in ('user','system') and local_date<>(now() at time zone 'America/Chicago')::date limit 1)) on conflict(turn_id,role) do nothing;
  end if;
  update assistant_turns set status=case when p_error is null then 'completed' else 'failed' end,
    memory_status=case when p_reviewed then 'reviewed' else 'pending' end,error=p_error,updated_at=now() where id=p_turn and user_id=auth.uid();
  update assistant_sessions set lease_until=null,lease_id=null,active_turn_id=null where user_id=auth.uid();
end $$;

create function public.assistant_save_memory(p_turn uuid,p_lease uuid,p_operation uuid,p_kind text,p_key text,p_expected integer,p_entry jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d assistant_memory_documents; r assistant_memory_revisions; src uuid[]; req jsonb; next_entries jsonb; receipt jsonb;
begin
  perform assistant_require_turn(p_turn,p_lease);
  req := jsonb_build_object('kind',p_kind,'key',p_key,'expected',p_expected,'entry',p_entry,'reason',p_reason);
  select * into r from assistant_memory_revisions where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if r.request_json<>req then raise exception 'Memory operation reused with different content.'; end if;
    return jsonb_build_object('saved',true,'home',p_kind,'document_id',r.document_id,'entry_id',p_entry->>'id','revision',r.revision);
  end if;
  if coalesce(p_kind,'') not in ('preferences','daily','priorities') or jsonb_typeof(p_entry)<>'object' or coalesce(length(p_entry->>'text'),0) not between 1 and 6000 or coalesce(length(p_reason),0) not between 1 and 2000 then raise exception 'Invalid memory entry.'; end if;
  if exists(select 1 from jsonb_object_keys(p_entry) k where not (k=any(case p_kind
    when 'daily' then array['id','text','source_ids','disposition','rationale']
    when 'preferences' then array['id','text','source_ids','origin','state','scope']
    else array['id','text','source_ids','origin','state','title','rationale'] end))) then raise exception 'Unknown memory fields.'; end if;
  if jsonb_typeof(p_entry->'id') is distinct from 'string' or jsonb_typeof(p_entry->'text') is distinct from 'string' or jsonb_typeof(p_entry->'source_ids') is distinct from 'array' then raise exception 'Invalid memory field types.'; end if;
  perform (p_entry->>'id')::uuid;
  if p_entry->>'id' is null then raise exception 'Entry ID required.'; end if;
  select array_agg(value::uuid) into src from jsonb_array_elements_text(p_entry->'source_ids');
  perform assistant_require_sources(src);
  if p_kind='daily' then
    if p_key !~ '^\d{4}-\d{2}-\d{2}$' or p_key::date>(now() at time zone 'America/Chicago')::date or coalesce(p_entry->>'disposition','') not in ('relevant_next_day','not_relevant_next_day','uncertain') or coalesce(length(p_entry->>'rationale'),0)=0 then raise exception 'Daily notes require dated carry-forward reasoning.'; end if;
  else
    if p_key<>'core' or coalesce(p_entry->>'state','') not in ('active','superseded','paused','resolved') or coalesce(p_entry->>'origin','') not in ('user_stated','inferred') then raise exception 'Invalid core memory state.'; end if;
    if p_kind='preferences' and coalesce(length(trim(p_entry->>'scope')),0) not between 1 and 300 then raise exception 'Preference scope required.'; end if;
    if p_entry->>'origin'='user_stated' and not exists(select 1 from assistant_messages where id=any(src) and user_id=auth.uid() and role='user') then raise exception 'User-stated core memory needs a user-message source.'; end if;
    if p_kind='priorities' and (coalesce(length(p_entry->>'rationale'),0)=0 or coalesce(length(p_entry->>'title'),0)=0) then raise exception 'Priorities need a title and rationale.'; end if;
  end if;
  insert into assistant_memory_documents(user_id,kind,document_key) values(auth.uid(),p_kind,p_key) on conflict do nothing;
  select * into d from assistant_memory_documents where user_id=auth.uid() and kind=p_kind and document_key=p_key for update;
  if d.revision<>p_expected then raise exception 'Memory changed since it was read. Reload and reconcile; no overwrite was made.'; end if;
  select coalesce(jsonb_agg(e),'[]') into next_entries from jsonb_array_elements(d.content_json->'entries') e where e->>'id'<>p_entry->>'id';
  -- Upsert one entry, preserving every other entry. No top-N carry-forward pruning.
  next_entries := next_entries || jsonb_build_array(p_entry || jsonb_build_object('updated_at',now()) ||
    case when p_kind<>'daily' then jsonb_build_object('last_confirmed_at',case when p_entry->>'origin'='user_stated' then (select max(created_at) from assistant_messages where id=any(src) and user_id=auth.uid() and role='user') else null end) else '{}'::jsonb end);
  if octet_length(next_entries::text)>200000 then raise exception 'Memory home is too large; review it with the user. Nothing was dropped.'; end if;
  update assistant_memory_documents set content_json=jsonb_build_object('entries',next_entries),revision=revision+1,updated_at=now() where id=d.id returning * into d;
  insert into assistant_memory_revisions(user_id,document_id,revision,operation_id,turn_id,request_json,content_json,reason,source_ids)
    values(auth.uid(),d.id,d.revision,p_operation,p_turn,req,d.content_json,p_reason,src);
  receipt := jsonb_build_object('saved',true,'home',p_kind,'document_id',d.id,'entry_id',p_entry->>'id','revision',d.revision);
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json) values(p_operation,auth.uid(),p_turn,'save_'||p_kind,receipt);
  return receipt;
end $$;

create function public.assistant_propose_task(p_turn uuid,p_lease uuid,p_id uuid,p_task uuid,p_expected timestamptz,p_patch jsonb,p_reason text,p_sources uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks; p assistant_task_proposals; receipt jsonb;
begin
  perform assistant_require_turn(p_turn,p_lease); perform assistant_require_sources(p_sources);
  if jsonb_typeof(p_patch)<>'object' or p_patch='{}' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','status','priority','human_summary')) or coalesce(length(p_reason),0) not between 1 and 2000 then raise exception 'Unsupported task proposal.'; end if;
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
  insert into assistant_task_proposals(id,user_id,turn_id,task_id,expected_updated_at,patch_json,before_json,reason,source_ids)
    values(p_id,auth.uid(),p_turn,p_task,p_expected,p_patch,case when p_task is null then null else to_jsonb(t) end,p_reason,p_sources);
  receipt:=jsonb_build_object('proposed',true,'proposal_id',p_id,'status','pending');
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json) values(p_id,auth.uid(),p_turn,'propose_task',receipt);
  return receipt;
end $$;

create function public.assistant_resolve_proposal(p_id uuid,p_apply boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p assistant_task_proposals; t tasks; s text; new_task uuid;
begin
  select * into p from assistant_task_proposals where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Proposal unavailable.'; end if;
  if p.status<>'pending' then return to_jsonb(p); end if;
  if p_apply then
    if p.task_id is null then
      s:=coalesce(p.patch_json->>'status','open');
      insert into tasks(user_id,title,status,priority,human_summary,completed_at,source,updated_by_actor_type,updated_by_actor_label,last_change_reason)
        values(auth.uid(),p.patch_json->>'title',s,coalesce(p.patch_json->>'priority','medium'),p.patch_json->>'human_summary',case when s='completed' then now() else null end,'assistant','human','Approved assistant proposal',p.reason) returning id into new_task;
    else
      select * into t from tasks where id=p.task_id and user_id=auth.uid() for update;
      if not found or t.updated_at is distinct from p.expected_updated_at then raise exception 'This task changed after the proposal. Ask the assistant to refresh it; nothing was applied.'; end if;
      s:=coalesce(p.patch_json->>'status',t.status);
      update tasks set title=coalesce(p.patch_json->>'title',title),status=s,priority=coalesce(p.patch_json->>'priority',priority),
        human_summary=case when p.patch_json ? 'human_summary' then p.patch_json->>'human_summary' else human_summary end,
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

create function public.assistant_publish_review(p_turn uuid,p_lease uuid,p_id uuid,p_date date,p_expected integer,p_origin text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d assistant_memory_documents; r assistant_daily_reviews; prior assistant_daily_reviews; missing_ids text; receipt jsonb;
begin
  perform assistant_require_turn(p_turn,p_lease);
  if p_origin not in ('closeout','catch_up') or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Invalid review date/origin.'; end if;
  insert into assistant_memory_documents(user_id,kind,document_key) values(auth.uid(),'daily',p_date::text) on conflict do nothing;
  select * into d from assistant_memory_documents where user_id=auth.uid() and kind='daily' and document_key=p_date::text for update;
  if not found or d.revision<>p_expected then raise exception 'Daily notes changed or are missing. Review the current notes first.'; end if;
  select * into prior from assistant_daily_reviews where user_id=auth.uid() and local_date<p_date order by local_date desc,revision desc limit 1;
  if found then
    select string_agg(e->>'id',', ') into missing_ids from jsonb_array_elements(prior.entries_json) e
      where e->>'disposition' in ('relevant_next_day','uncertain') and not exists
      (select 1 from jsonb_array_elements(d.content_json->'entries') current_entry where current_entry->>'id'=e->>'id');
    if missing_ids is not null then raise exception 'Prior carry items missing from this review: %. Reassess each using its existing ID; exclusions need a reason too.',missing_ids; end if;
  end if;
  insert into assistant_daily_reviews(id,user_id,document_id,local_date,revision,origin,entries_json)
    values(p_id,auth.uid(),d.id,p_date,d.revision,p_origin,d.content_json->'entries') on conflict(user_id,local_date,revision) do nothing;
  select * into r from assistant_daily_reviews where user_id=auth.uid() and local_date=p_date and revision=p_expected;
  receipt:=jsonb_build_object('saved',true,'review_id',r.id,'date',p_date,'revision',p_expected,'origin',r.origin);
  insert into assistant_tool_receipts(id,user_id,turn_id,tool,result_json) values(p_id,auth.uid(),p_turn,'publish_review',receipt) on conflict do nothing;
  return receipt;
end $$;

create function public.assistant_present_review(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from assistant_daily_reviews where id=p_id and user_id=auth.uid()) then raise exception 'Review unavailable.'; end if;
  insert into assistant_review_presentations(user_id,review_id,view_date) values(auth.uid(),p_id,(now() at time zone 'America/Chicago')::date) on conflict do nothing;
end $$;

-- Private helpers are not callable through PostgREST. Public writes require a session.
revoke all on function public.assistant_require_turn(uuid,uuid), public.assistant_require_sources(uuid[]) from public,anon,authenticated;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('assistant_begin_turn','assistant_finish_turn','assistant_save_memory','assistant_propose_task','assistant_resolve_proposal','assistant_publish_review','assistant_present_review') loop
    execute format('revoke all on function %s from public,anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;

-- A compact date index, without scanning or truncating source messages in the UI.
create function public.assistant_active_dates() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(d order by d desc),'[]') from
    (select distinct local_date d from assistant_messages where user_id=auth.uid()) dates;
$$;
revoke all on function public.assistant_active_dates() from public,anon;
grant execute on function public.assistant_active_dates() to authenticated;
