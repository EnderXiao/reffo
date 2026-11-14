-- 历史填写文档升级使用完整旧快照做 CAS，避免覆盖不改变文档版本的后台行动复核。
-- 仅升级请求携带 processResult；既有提交协议继续兼容。
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
      or p_expected->>'resolvedDigest' is distinct from resolved
      or (p_expected ? 'processResult' and p_expected->'processResult' is distinct from old_record.process_result) then return jsonb_build_object('conflict','version'); end if;
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
