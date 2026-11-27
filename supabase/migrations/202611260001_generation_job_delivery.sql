create function public.commit_resume_generation_job(
  p_owner_id uuid, p_job_id text, p_lease text, p_stage text, p_next jsonb, p_history jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  job public.resume_generation_jobs;
  history_key text;
  saved jsonb;
begin
  select * into job from public.resume_generation_jobs where user_id = p_owner_id and id = p_job_id for update;
  if not found then return '{}'::jsonb; end if;
  history_key := coalesce(job.history_id, 'JD-' || job.id);
  if p_next->>'history_id' is distinct from history_key then return '{}'::jsonb; end if;

  if job.status = 'completed' and p_next->>'status' = 'completed' and exists (
    select 1 from public.resume_history_commits where owner_id = p_owner_id and history_id = history_key
      and commit_id = p_history->>'p_commit_id' and request_digest = p_history->>'p_request_digest'
  ) then return jsonb_build_object('job', to_jsonb(job)); end if;

  if job.status <> 'running' or job.stage is distinct from p_stage or p_lease is null
    or job.lease_token is distinct from p_lease or job.lease_expires_at <= clock_timestamp() then return '{}'::jsonb; end if;
  if p_next->>'status' not in ('running', 'completed') then raise exception 'invalid generation transition'; end if;
  if p_history is not null then
    if p_history#>>'{p_record,id}' is distinct from history_key then raise exception 'generation history mismatch'; end if;
    if exists (select 1 from public.resume_histories where user_id = p_owner_id and id = history_key and btrim(optimized_content) <> '') then
      return jsonb_build_object('conflict', 'version');
    end if;
    saved := public.commit_resume_history(p_owner_id, p_history->'p_record', p_history->>'p_commit_id',
      p_history->>'p_request_digest', nullif(p_history->'p_expected', 'null'::jsonb), p_history->'p_tasks',
      p_source_digest => p_history->>'p_source_digest');
    if saved ? 'conflict' then return saved; end if;
    if saved#>>'{record,id}' is distinct from history_key then raise exception 'generation history commit missing'; end if;
  elsif not exists (select 1 from public.resume_histories where user_id = p_owner_id and id = history_key) then
    return '{}'::jsonb;
  end if;

  if p_next ? 'interviewRecovery' then
    update public.resume_histories set process_result = jsonb_set(process_result, '{server_interview_task}',
      to_jsonb(p_next#>>'{interviewRecovery,version}')),
      updated_at = clock_timestamp()
    where user_id = p_owner_id and id = history_key and updated_at = (p_next#>>'{interviewRecovery,expectedUpdatedAt}')::timestamptz
      and process_result#>>'{server_interview_basis,version}' = 'interview-generation-basis-v1'
      and process_result->>'server_interview_task' is null and process_result->'interview' is null;
    if not found then return jsonb_build_object('conflict', 'version'); end if;
  end if;

  update public.resume_generation_jobs set stage = p_next->>'stage', status = p_next->>'status',
    payload = p_next->'payload', history_id = history_key, error = null,
    lease_token = case when p_next->>'status' = 'completed' then null else job.lease_token end,
    updated_at = clock_timestamp()
  where user_id = p_owner_id and id = p_job_id returning * into job;
  return jsonb_build_object('job', to_jsonb(job));
end;
$$;

create function public.stop_resume_generation_job(p_owner_id uuid, p_job_id text, p_failure jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare job public.resume_generation_jobs;
begin
  select * into job from public.resume_generation_jobs where user_id = p_owner_id and id = p_job_id for update;
  if not found or job.status = 'completed' then return '{}'::jsonb; end if;
  if p_failure is not null and (job.status <> 'running' or p_failure->>'lease' is null
    or job.lease_token is distinct from p_failure->>'lease' or job.stage is distinct from p_failure->>'stage'
    or job.lease_expires_at <= clock_timestamp()) then return '{}'::jsonb; end if;
  if job.status = 'cancelled' then return jsonb_build_object('job', to_jsonb(job)); end if;

  update public.resume_histories h set progress = (
    select jsonb_object_agg(key, case value when 'generating' then 'failed' else value end)
    from jsonb_each_text(h.progress)
  ), updated_at = clock_timestamp()
  where user_id = p_owner_id and id = coalesce(job.history_id, 'JD-' || job.id)
    and btrim(optimized_content) = '' and exists (select 1 from jsonb_each_text(h.progress) where value = 'generating');

  update public.resume_generation_jobs set status = case when p_failure is null then 'cancelled' else 'failed' end,
    payload = coalesce(p_failure->'payload', job.payload), error = coalesce(p_failure->>'error', job.error),
    lease_token = null, updated_at = clock_timestamp()
  where user_id = p_owner_id and id = p_job_id returning * into job;
  return jsonb_build_object('job', to_jsonb(job));
end;
$$;

revoke all on function public.commit_resume_generation_job(uuid,text,text,text,jsonb,jsonb),
  public.stop_resume_generation_job(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.commit_resume_generation_job(uuid,text,text,text,jsonb,jsonb),
  public.stop_resume_generation_job(uuid,text,jsonb) to service_role;
