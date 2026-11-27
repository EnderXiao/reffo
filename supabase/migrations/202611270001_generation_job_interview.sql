alter table public.resume_generation_jobs
  add column if not exists interview_status text check (interview_status in ('pending','running','done','failed','unavailable')),
  add column if not exists interview_available_at timestamptz,
  add column if not exists interview_lease_token text;

create index if not exists generation_jobs_interview_pending on public.resume_generation_jobs(interview_available_at)
  where interview_status in ('pending','running');
create index if not exists generation_jobs_history on public.resume_generation_jobs(user_id, history_id)
  where interview_status is not null;

-- Serialize the transfer with delivery and legacy lease writes. The old table
-- stays readable during rollout and continues to cascade history deletions.
lock table public.resume_generation_jobs, public.resume_histories, public.resume_interview_tasks in share row exclusive mode;
drop trigger if exists enqueue_resume_interview on public.resume_histories;
revoke insert, update on public.resume_interview_tasks from service_role;

do $$
declare item record; next_status text; next_available timestamptz; job_key text;
begin
  for item in
    select h.user_id, h.id, h.created_at, h.company, h.position, h.process_result->'interview' as saved_result,
      initial.status as legacy_status, initial.available_at, latest.result
    from public.resume_histories h
    left join public.resume_interview_tasks initial on initial.user_id=h.user_id and initial.history_id=h.id
      and initial.version=h.process_result->>'server_interview_task'
    left join lateral (
      select t.result from public.resume_interview_tasks t
      where t.user_id=h.user_id and t.history_id=h.id and t.status='done'
        and jsonb_typeof(t.result->'questions')='array' and jsonb_typeof(t.result->'story_recommendations')='array'
      order by t.updated_at desc, t.version desc limit 1
    ) latest on true
    where h.process_result->>'server_interview_task' ~ '^[a-f0-9]{64}$'
      and not exists (select 1 from public.resume_generation_jobs j where j.user_id=h.user_id and j.history_id=h.id
        and j.interview_status is not null)
  loop
    next_status := case when item.result is not null or jsonb_typeof(item.saved_result)='object' then 'done'
      when item.legacy_status in ('pending','running') then 'pending' else 'failed' end;
    next_available := case when next_status='pending' then coalesce(item.available_at, clock_timestamp()) end;
    update public.resume_histories h
      set process_result=case when item.result is null or jsonb_typeof(item.saved_result)='object' then h.process_result
        else jsonb_set(h.process_result, '{interview}', item.result) end,
        progress=jsonb_set(coalesce(h.progress, '{}'::jsonb), '{interview}', to_jsonb(next_status)),
        updated_at=clock_timestamp()
      where h.user_id=item.user_id and h.id=item.id;

    select j.id into job_key from public.resume_generation_jobs j
      where j.user_id=item.user_id and j.history_id=item.id and j.status='completed'
      order by j.created_at desc, j.id desc limit 1;
    if job_key is not null then
      update public.resume_generation_jobs set interview_status=next_status,
        interview_available_at=next_available, updated_at=clock_timestamp()
        where id=job_key and user_id=item.user_id;
    elsif next_status<>'done' then
      insert into public.resume_generation_jobs(id,user_id,status,stage,history_id,created_at,read_at,confirmed_at,
        payload,interview_status,interview_available_at)
      values(md5(item.user_id::text || ':' || item.id)::uuid::text,item.user_id,'completed','saving',
        item.id,item.created_at,clock_timestamp(),clock_timestamp(),
        jsonb_build_object('input',jsonb_build_object('resume_markdown','','jd_text','','location','',
          'company',item.company,'position',item.position)),next_status,next_available);
    end if;
  end loop;
end;
$$;

-- A concurrent save from a service instance still on the old release may omit
-- the result. Once written, managed interview advice belongs to the history.
create or replace function public.preserve_managed_interview_result()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if old.process_result ? 'server_interview_task' and jsonb_typeof(old.process_result->'interview')='object' then
    new.process_result := jsonb_set(coalesce(new.process_result, old.process_result), '{interview}', old.process_result->'interview');
    new.process_result := jsonb_set(new.process_result, '{server_interview_task}', old.process_result->'server_interview_task');
    new.progress := jsonb_set(coalesce(new.progress, '{}'::jsonb), '{interview}', '"done"'::jsonb);
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_managed_interview_result on public.resume_histories;
create trigger preserve_managed_interview_result before update of process_result,progress on public.resume_histories
  for each row execute function public.preserve_managed_interview_result();

create or replace function public.commit_resume_generation_job(
  p_owner_id uuid, p_job_id text, p_lease text, p_stage text, p_next jsonb, p_history jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.resume_generation_jobs; history_key text; saved jsonb; enqueue_interview boolean := false;
begin
  select * into job from public.resume_generation_jobs where user_id=p_owner_id and id=p_job_id for update;
  if not found then return '{}'::jsonb; end if;
  history_key := coalesce(job.history_id, 'JD-' || job.id);
  if p_next->>'history_id' is distinct from history_key then return '{}'::jsonb; end if;
  if job.status='completed' and p_next->>'status'='completed' and exists (
    select 1 from public.resume_history_commits where owner_id=p_owner_id and history_id=history_key
      and commit_id=p_history->>'p_commit_id' and request_digest=p_history->>'p_request_digest'
  ) then return jsonb_build_object('job',to_jsonb(job)); end if;
  if job.status<>'running' or job.stage is distinct from p_stage or p_lease is null
    or job.lease_token is distinct from p_lease or job.lease_expires_at <= clock_timestamp() then return '{}'::jsonb; end if;
  if p_next->>'status' not in ('running','completed') then raise exception 'invalid generation transition'; end if;
  if p_history is not null then
    if p_history#>>'{p_record,id}' is distinct from history_key then raise exception 'generation history mismatch'; end if;
    if exists (select 1 from public.resume_histories where user_id=p_owner_id and id=history_key and btrim(optimized_content)<>'') then
      return jsonb_build_object('conflict','version');
    end if;
    saved := public.commit_resume_history(p_owner_id,p_history->'p_record',p_history->>'p_commit_id',
      p_history->>'p_request_digest',nullif(p_history->'p_expected','null'::jsonb),p_history->'p_tasks',
      p_source_digest => p_history->>'p_source_digest');
    if saved ? 'conflict' then return saved; end if;
    if saved#>>'{record,id}' is distinct from history_key then raise exception 'generation history commit missing'; end if;
    enqueue_interview := coalesce(saved#>>'{record,process_result,server_interview_task}' ~ '^[a-f0-9]{64}$', false);
  elsif not exists (select 1 from public.resume_histories where user_id=p_owner_id and id=history_key) then
    return '{}'::jsonb;
  end if;
  if p_next ? 'interviewRecovery' then
    update public.resume_histories set process_result=jsonb_set(process_result,'{server_interview_task}',
      to_jsonb(p_next#>>'{interviewRecovery,version}')),
      progress=jsonb_set(coalesce(progress,'{}'::jsonb),'{interview}','"pending"'::jsonb), updated_at=clock_timestamp()
    where user_id=p_owner_id and id=history_key and updated_at=(p_next#>>'{interviewRecovery,expectedUpdatedAt}')::timestamptz
      and process_result#>>'{server_interview_basis,version}'='interview-generation-basis-v1'
      and process_result->>'server_interview_task' is null and process_result->'interview' is null;
    if not found then return jsonb_build_object('conflict','version'); end if;
    enqueue_interview := true;
  end if;
  update public.resume_generation_jobs set stage=p_next->>'stage', status=p_next->>'status',
    payload=p_next->'payload', history_id=history_key, error=null,
    lease_token=case when p_next->>'status'='completed' then null else job.lease_token end,
    interview_status=case when enqueue_interview then coalesce(job.interview_status,'pending') else job.interview_status end,
    interview_available_at=case when enqueue_interview and job.interview_status is null
      then clock_timestamp() else job.interview_available_at end,
    updated_at=clock_timestamp()
    where user_id=p_owner_id and id=p_job_id returning * into job;
  return jsonb_build_object('job',to_jsonb(job));
end;
$$;

-- Some environments registered the previous delivery migration version without
-- installing its RPCs. Reinstall the matching stop contract under this version.
create or replace function public.stop_resume_generation_job(p_owner_id uuid, p_job_id text, p_failure jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.resume_generation_jobs;
begin
  select * into job from public.resume_generation_jobs where user_id=p_owner_id and id=p_job_id for update;
  if not found or job.status='completed' then return '{}'::jsonb; end if;
  if p_failure is not null and (job.status<>'running' or p_failure->>'lease' is null
    or job.lease_token is distinct from p_failure->>'lease' or job.stage is distinct from p_failure->>'stage'
    or job.lease_expires_at<=clock_timestamp()) then return '{}'::jsonb; end if;
  if job.status='cancelled' then return jsonb_build_object('job',to_jsonb(job)); end if;
  update public.resume_histories h set progress=(
    select jsonb_object_agg(key,case value when 'generating' then 'failed' else value end) from jsonb_each_text(h.progress)
  ), updated_at=clock_timestamp()
  where user_id=p_owner_id and id=coalesce(job.history_id,'JD-'||job.id)
    and btrim(optimized_content)='' and exists (select 1 from jsonb_each_text(h.progress) where value='generating');
  update public.resume_generation_jobs set status=case when p_failure is null then 'cancelled' else 'failed' end,
    payload=coalesce(p_failure->'payload',job.payload), error=p_failure->>'error', lease_token=null, updated_at=clock_timestamp()
    where user_id=p_owner_id and id=p_job_id returning * into job;
  return jsonb_build_object('job',to_jsonb(job));
end;
$$;

create or replace function public.finish_resume_generation_interview(
  p_owner_id uuid, p_job_id text, p_lease text, p_status text, p_result jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.resume_generation_jobs; history public.resume_histories;
begin
  if p_status not in ('done','failed','unavailable') or (p_status='done' and jsonb_typeof(p_result) is distinct from 'object')
    then raise exception 'invalid interview transition'; end if;
  select * into job from public.resume_generation_jobs where user_id=p_owner_id and id=p_job_id
    and status='completed' and interview_status='running' and interview_lease_token=p_lease
    and interview_available_at>clock_timestamp() for update;
  if not found then return '{}'::jsonb; end if;
  select * into history from public.resume_histories where user_id=p_owner_id and id=job.history_id for update;
  if job.interview_available_at<=clock_timestamp() then return '{}'::jsonb; end if;
  if not found or history.process_result->>'server_interview_task' is null then
    p_status := 'unavailable';
  elsif jsonb_typeof(history.process_result->'interview')='object' then
    p_status := 'done';
  else
    update public.resume_histories set
      process_result=case when p_status='done' then jsonb_set(process_result,'{interview}',p_result) else process_result end,
      progress=jsonb_set(coalesce(progress,'{}'::jsonb),'{interview}',to_jsonb(case when p_status='done' then 'done' else 'failed' end)),
      updated_at=case when p_status='done' then updated_at else clock_timestamp() end
      where user_id=p_owner_id and id=job.history_id;
  end if;
  update public.resume_generation_jobs set interview_status=p_status,interview_lease_token=null,interview_available_at=null,
    updated_at=clock_timestamp() where user_id=p_owner_id and id=p_job_id returning * into job;
  return jsonb_build_object('job',to_jsonb(job));
end;
$$;

create or replace function public.retry_resume_generation_interview(p_owner_id uuid, p_history_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.resume_generation_jobs;
begin
  select * into job from public.resume_generation_jobs where user_id=p_owner_id and history_id=p_history_id
    and status='completed' and interview_status is not null order by created_at desc,id desc limit 1 for update;
  if not found then return '{}'::jsonb; end if;
  if job.interview_status<>'failed' then return jsonb_build_object('job',to_jsonb(job)); end if;
  update public.resume_histories set progress=jsonb_set(coalesce(progress,'{}'::jsonb),'{interview}','"pending"'::jsonb),
    updated_at=clock_timestamp() where user_id=p_owner_id and id=p_history_id and process_result ? 'server_interview_task'
    and nullif(process_result->'interview','null'::jsonb) is null;
  if not found then return '{}'::jsonb; end if;
  update public.resume_generation_jobs set interview_status='pending',interview_lease_token=null,
    interview_available_at=clock_timestamp(),updated_at=clock_timestamp()
    where user_id=p_owner_id and id=job.id returning * into job;
  return jsonb_build_object('job',to_jsonb(job));
end;
$$;

revoke all on function public.commit_resume_generation_job(uuid,text,text,text,jsonb,jsonb),
  public.stop_resume_generation_job(uuid,text,jsonb),
  public.finish_resume_generation_interview(uuid,text,text,text,jsonb),
  public.retry_resume_generation_interview(uuid,text) from public, anon, authenticated;
grant execute on function public.commit_resume_generation_job(uuid,text,text,text,jsonb,jsonb),
  public.stop_resume_generation_job(uuid,text,jsonb),
  public.finish_resume_generation_interview(uuid,text,text,text,jsonb),
  public.retry_resume_generation_interview(uuid,text) to service_role;
