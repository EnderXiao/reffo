-- Document CAS, idempotent acknowledgement and review outbox share one transaction.
alter table public.resume_histories alter column match_score drop not null;
create table if not exists public.resume_history_commits (
  owner_id uuid not null references auth.users(id) on delete cascade,
  commit_id text not null, request_digest text not null, history_id text not null,
  acknowledgement jsonb not null, created_at timestamptz not null default now(),
  primary key(owner_id, commit_id)
);
create table if not exists public.resume_review_tasks (
  id text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  history_id text not null, document_id text not null, revision integer not null,
  resolved_digest text not null, action_id text not null, input_digest text not null,
  task_generation integer not null, status text not null default 'pending'
    check (status in ('pending','running','completed','superseded','failed')),
  lease_token text, lease_expires_at timestamptz, attempts integer not null default 0,
  available_at timestamptz not null default now(), created_at timestamptz not null default now(), expires_at timestamptz not null,
  unique(owner_id,history_id,document_id,revision,resolved_digest,action_id,input_digest)
);
create index if not exists resume_review_pending on public.resume_review_tasks(status,available_at);
alter table public.resume_history_commits enable row level security;
alter table public.resume_review_tasks enable row level security;
revoke all on public.resume_history_commits, public.resume_review_tasks from anon,authenticated;
grant select,insert,update,delete on public.resume_history_commits, public.resume_review_tasks to service_role;

create or replace function public.commit_resume_history(p_owner_id uuid, p_record jsonb, p_commit_id text,
  p_request_digest text, p_expected jsonb, p_tasks jsonb, p_task_ttl_ms bigint default 259200000, p_source_digest text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old_record public.resume_histories; new_record public.resume_histories; prior public.resume_history_commits;
  doc jsonb; resolved text; ack jsonb; task jsonb;
begin
  if p_owner_id is null or p_record->>'user_id' is distinct from p_owner_id::text then raise exception 'owner mismatch'; end if;
  -- Serialize same idempotency key even when the history has not been inserted yet.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || coalesce(p_commit_id,p_record->>'id'), 0));
  if p_commit_id is not null then
    select * into prior from public.resume_history_commits where owner_id=p_owner_id and commit_id=p_commit_id;
    if found then
      if prior.request_digest <> p_request_digest then return jsonb_build_object('conflict','commit'); end if;
      return jsonb_build_object('record',prior.acknowledgement-'commit_ack','commit_ack',prior.acknowledgement->'commit_ack');
    end if;
  end if;
  select * into old_record from public.resume_histories where user_id=p_owner_id and id=p_record->>'id' for update;
  if found then
    doc := old_record.process_result#>'{optimized,completion_document}';
    resolved := old_record.process_result#>>'{optimized,resolved_action_plan,resolvedDigest}';
    if p_expected is null or (p_expected->>'updatedAt')::timestamptz is distinct from old_record.updated_at
      or p_expected->>'documentId' is distinct from doc->>'documentId'
      or p_expected->>'revision' is distinct from doc->>'revision'
      or p_expected->>'resolvedDigest' is distinct from resolved then return jsonb_build_object('conflict','version'); end if;
  elsif p_expected is not null then return jsonb_build_object('conflict','version');
  end if;
  new_record := jsonb_populate_record(null::public.resume_histories,p_record);
  insert into public.resume_histories select new_record.* on conflict(user_id,id) do update set
    position=excluded.position,company=excluded.company,name=excluded.name,created_at=excluded.created_at,updated_at=excluded.updated_at,
    quality_score=excluded.quality_score,match_score=excluded.match_score,tags=excluded.tags,resume_content=excluded.resume_content,
    jd_content=excluded.jd_content,optimized_content=excluded.optimized_content,optimization_suggestions=excluded.optimization_suggestions,
    changes_summary=excluded.changes_summary,process_result=excluded.process_result,result_context=excluded.result_context,
    progress=excluded.progress,card_color=excluded.card_color,card_pattern=excluded.card_pattern returning * into new_record;
  if p_source_digest is not null then insert into public.resume_stage_refs(owner_id,history_id,source_digest) values(p_owner_id,new_record.id,p_source_digest) on conflict do nothing; end if;
  update public.resume_review_tasks set status='superseded',lease_token=null where owner_id=p_owner_id
    and history_id=new_record.id and status in ('pending','running');
  for task in select value from jsonb_array_elements(coalesce(p_tasks,'[]')) loop
    if task->>'owner_id' is distinct from p_owner_id::text or task->>'history_id' is distinct from new_record.id then raise exception 'task owner mismatch'; end if;
    insert into public.resume_review_tasks(id,owner_id,history_id,document_id,revision,resolved_digest,action_id,input_digest,
      task_generation,status,available_at,expires_at) values(task->>'id',p_owner_id,new_record.id,task->>'document_id',
      (task->>'revision')::integer,task->>'resolved_digest',task->>'action_id',task->>'input_digest',(task->>'task_generation')::integer,
      'pending',now(),now()+make_interval(secs=>least(p_task_ttl_ms,259200000)::double precision/1000))
    on conflict(owner_id,history_id,document_id,revision,resolved_digest,action_id,input_digest) do update set
      status='pending',lease_token=null,lease_expires_at=null,available_at=now();
  end loop;
  doc := new_record.process_result#>'{optimized,completion_document}';
  ack := jsonb_build_object('commit_id',p_commit_id,'document_id',doc->'documentId','revision',doc->'revision',
    'resolved_digest',new_record.process_result#>'{optimized,resolved_action_plan,resolvedDigest}');
  if p_commit_id is not null then insert into public.resume_history_commits(owner_id,commit_id,request_digest,history_id,acknowledgement)
    values(p_owner_id,p_commit_id,p_request_digest,new_record.id,to_jsonb(new_record)||jsonb_build_object('commit_ack',ack)); end if;
  return jsonb_build_object('record',to_jsonb(new_record),'commit_ack',case when p_commit_id is null then null else ack end);
end; $$;

create or replace function public.claim_resume_review_task(p_lease_token text,p_lease_expires_at timestamptz)
returns setof public.resume_review_tasks language sql security definer set search_path = public as $$
  update public.resume_review_tasks set status='running',lease_token=p_lease_token,
    lease_expires_at=least(p_lease_expires_at,now()+interval '60 seconds'),attempts=attempts+1
    where id=(select id from public.resume_review_tasks where expires_at>now() and available_at<=now() and attempts<3
      and (status='pending' or (status='running' and lease_expires_at<=now())) order by created_at for update skip locked limit 1) returning *;
$$;

create or replace function public.finish_resume_review_task(p_task_id text,p_lease_token text,p_input_digest text,
  p_task_generation integer,p_outcome jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare task public.resume_review_tasks; hist public.resume_histories; review jsonb; outcomes jsonb; manifest jsonb;
begin
  select * into task from public.resume_review_tasks where id=p_task_id and status='running'
    and lease_token=p_lease_token and lease_expires_at>now() and input_digest=p_input_digest and task_generation=p_task_generation for update;
  if not found or p_outcome->>'actionId' is distinct from task.action_id or p_outcome->>'state'='pending_review' then return false; end if;
  select * into hist from public.resume_histories where user_id=task.owner_id and id=task.history_id for update;
  if not found or hist.process_result#>>'{optimized,completion_document,documentId}' is distinct from task.document_id
    or (hist.process_result#>>'{optimized,completion_document,revision}')::integer is distinct from task.revision
    or hist.process_result#>>'{optimized,resolved_action_plan,resolvedDigest}' is distinct from task.resolved_digest then return false; end if;
  review := hist.process_result#>'{optimized,action_review}';
  if not exists(select 1 from jsonb_array_elements(review->'outcomes') x where x->>'actionId'=task.action_id and x->>'state'='pending_review') then return false; end if;
  select jsonb_agg(case when x->>'actionId'=task.action_id then p_outcome else x end) into outcomes from jsonb_array_elements(review->'outcomes') x;
  review := jsonb_set(jsonb_set(review,'{outcomes}',outcomes),'{reviewRevision}',to_jsonb(coalesce((review->>'reviewRevision')::integer,0)+1));
  manifest := hist.process_result#>'{optimized,change_manifest}';
  if manifest is not null then
    manifest := jsonb_set(manifest,'{items}',coalesce((select jsonb_agg(case when x->>'actionId'=task.action_id then x||jsonb_build_object(
      'description',p_outcome->>'explanation','anchors',p_outcome->'anchors','category',case p_outcome->>'state'
      when 'adopted' then 'adopted' when 'partially_adopted' then 'partial' when 'needs_material' then 'awaiting_material' else 'omitted' end) else x end)
      from jsonb_array_elements(manifest->'items') x),'[]'));
  end if;
  update public.resume_histories set process_result=jsonb_set(jsonb_set(process_result,'{optimized,action_review}',review),
    '{optimized,change_manifest}',coalesce(manifest,'null')) where user_id=task.owner_id and id=task.history_id;
  update public.resume_review_tasks set status='completed',lease_token=null,lease_expires_at=null where id=task.id;
  return true;
end; $$;

create or replace function public.revoke_deleted_resume_reviews() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.resume_review_tasks set status='superseded',lease_token=null where owner_id=old.user_id and history_id=old.id;
  delete from public.resume_history_commits where owner_id=old.user_id and history_id=old.id;
  return old;
end; $$;
create trigger revoke_deleted_resume_reviews after delete on public.resume_histories for each row execute function public.revoke_deleted_resume_reviews();
revoke all on function public.commit_resume_history(uuid,jsonb,text,text,jsonb,jsonb,bigint,text),
  public.claim_resume_review_task(text,timestamptz),public.finish_resume_review_task(text,text,text,integer,jsonb),
  public.revoke_deleted_resume_reviews() from public,anon,authenticated;
grant execute on function public.commit_resume_history(uuid,jsonb,text,text,jsonb,jsonb,bigint,text),
  public.claim_resume_review_task(text,timestamptz),public.finish_resume_review_task(text,text,text,integer,jsonb) to service_role;
