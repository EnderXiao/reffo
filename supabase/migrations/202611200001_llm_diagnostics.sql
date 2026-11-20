-- Harness/LLM 异常诊断：provider_calls 失败分类列 + 诊断看板 RPC
-- 风格对齐 202611180002_dashboard_security.sql：security invoker、statement_timeout、revoke all + grant service_role。
-- 时间过滤全部下推到数据库；参数全部校验；仅 service_role 可执行。

alter table public.provider_calls add column if not exists failure_class text;
alter table public.provider_calls add column if not exists provider_status integer;

create index if not exists idx_provider_calls_failure_class on public.provider_calls(failure_class, occurred_at);
create index if not exists idx_provider_calls_occurred on public.provider_calls(occurred_at desc);

-- 诊断 RPC 依赖的四张表只读权限（service_role 绕过 RLS，仍需表级授权兜底）。
grant select on public.harness_events to service_role;
grant select on public.harness_failure_samples to service_role;
grant select on public.provider_calls to service_role;
grant select on public.resume_generation_jobs to service_role;

-- 诊断汇总：失败 run/任务数、provider 尝试与失败数、失败率、Top 错误码/失败类/模型。
create or replace function public.dashboard_diagnostic_summary(p_days integer default 7)
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '4s'
as $$
declare
  cutoff timestamptz := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - make_interval(days => p_days - 1);
  failed_runs bigint;
  failed_jobs bigint;
  attempts bigint;
  failures bigint;
  top_errors jsonb;
  top_classes jsonb;
  top_models jsonb;
begin
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'invalid dashboard query';
  end if;
  select count(*) into failed_runs from public.harness_failure_samples where created_at >= cutoff;
  select count(*) into failed_jobs from public.resume_generation_jobs where status = 'failed' and updated_at >= cutoff;
  select count(*) filter (where event_kind in ('completed','failed')),
         count(*) filter (where event_kind = 'failed')
    into attempts, failures
    from public.provider_calls where occurred_at >= cutoff;
  select coalesce(jsonb_agg(x.item order by x.count desc, x.key asc), '[]'::jsonb) into top_errors from (
    select coalesce(nullif(error_code, ''), 'unknown') as key, count(*) as count,
           jsonb_build_object('code', coalesce(nullif(error_code, ''), 'unknown'), 'count', count(*)) as item
    from public.provider_calls
    where event_kind = 'failed' and occurred_at >= cutoff
    group by 1
    order by count desc, key asc
    limit 8
  ) x;
  select coalesce(jsonb_agg(x.item order by x.count desc, x.key asc), '[]'::jsonb) into top_classes from (
    select coalesce(failure_class, 'unclassified') as key, count(*) as count,
           jsonb_build_object('class', coalesce(failure_class, 'unclassified'), 'count', count(*)) as item
    from public.provider_calls
    where event_kind = 'failed' and occurred_at >= cutoff
    group by 1
    order by count desc, key asc
    limit 8
  ) x;
  select coalesce(jsonb_agg(x.item order by x.count desc, x.key asc), '[]'::jsonb) into top_models from (
    select model as key, count(*) as count,
           jsonb_build_object('model', model, 'count', count(*)) as item
    from public.provider_calls
    where occurred_at >= cutoff
    group by model
    order by count desc, key asc
    limit 8
  ) x;
  return jsonb_build_object(
    'days', p_days,
    'windowStart', to_char(cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'failedRuns', failed_runs,
    'failedJobs', failed_jobs,
    'providerAttempts', attempts,
    'providerFailures', failures,
    'failureRatePercent', case when attempts > 0 then round(100.0 * failures / attempts, 1) else null end,
    'topErrorCodes', top_errors,
    'topFailureClasses', top_classes,
    'topModels', top_models
  );
end;
$$;

-- 失败 run 分页：每 run 聚合 provider 统计（去重数组每类限 12 个）+ 关联失败任务（lateral limit 1）。
create or replace function public.dashboard_diagnostic_runs(
  p_days integer, p_limit integer, p_offset integer,
  p_model text default '', p_error text default ''
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '4s'
as $$
declare
  cutoff timestamptz := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - make_interval(days => p_days - 1);
  result jsonb;
begin
  -- p_error 只允许 [a-zA-Z0-9_./:-]：ilike 模式不含 %/_ 通配符，杜绝 LIKE 注入。
  if p_days is null or p_limit is null or p_offset is null
     or p_days not between 1 and 90 or p_limit not between 1 and 100 or p_offset not between 0 and 10000
     or length(p_model) > 120 or length(p_error) > 120
     or (p_model <> '' and p_model !~ '^[a-zA-Z0-9_./:-]+$')
     or (p_error <> '' and p_error !~ '^[a-zA-Z0-9_./:-]+$') then
    raise exception 'invalid dashboard query';
  end if;
  with page as (
    select fs.id, fs.run_id, fs.reason, fs.status, fs.event_count, fs.created_at
    from public.harness_failure_samples fs
    where fs.created_at >= cutoff
      and (p_model = '' or exists (select 1 from public.provider_calls pc where pc.run_id = fs.run_id and pc.model = p_model))
      and (p_error = '' or fs.reason ilike '%' || p_error || '%'
           or exists (select 1 from public.provider_calls pc
                      where pc.run_id = fs.run_id and pc.event_kind = 'failed'
                        and (coalesce(pc.error_code, '') ilike '%' || p_error || '%'
                             or coalesce(pc.failure_class, '') ilike '%' || p_error || '%')))
    order by fs.created_at desc, fs.id desc
    limit p_limit + 1 offset p_offset
  ), aggregates as (
    select fs.run_id,
      count(*) filter (where pc.event_kind = 'failed') as failed_calls,
      count(*) filter (where pc.event_kind in ('completed','failed')) as attempts,
      max(pc.latency_ms) as max_latency_ms,
      max(pc.occurred_at) as last_call_at,
      coalesce(array_agg(distinct pc.model order by pc.model) filter (where pc.model is not null), '{}'::text[]) as models,
      coalesce(array_agg(distinct pc.error_code order by pc.error_code) filter (where pc.error_code is not null and pc.error_code <> ''), '{}'::text[]) as error_codes,
      coalesce(array_agg(distinct pc.failure_class order by pc.failure_class) filter (where pc.failure_class is not null and pc.failure_class <> ''), '{}'::text[]) as failure_classes
    from page fs
    left join public.provider_calls pc on pc.run_id = fs.run_id
    group by fs.run_id
  ), runs as (
    select
      jsonb_build_object(
        'runId', fs.run_id,
        'failedAt', to_char(fs.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'reason', fs.reason,
        'status', fs.status,
        'eventCount', fs.event_count,
        'failedCalls', coalesce(agg.failed_calls, 0),
        'attempts', coalesce(agg.attempts, 0),
        'maxLatencyMs', agg.max_latency_ms,
        'lastCallAt', case when agg.last_call_at is null then null
                           else to_char(agg.last_call_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'models', coalesce(agg.models[1:12], '{}'::text[]),
        'errorCodes', coalesce(agg.error_codes[1:12], '{}'::text[]),
        'failureClasses', coalesce(agg.failure_classes[1:12], '{}'::text[]),
        'jobId', job.id,
        'jobStage', job.stage,
        'jobErrorCode', job.failure_code,
        'jobError', case when job.error is null then null else left(job.error, 500) end,
        'jobAction', job.failure_action,
        'retryable', job.retryable
      ) as run,
      fs.created_at, fs.id
    from page fs
    join aggregates agg on agg.run_id = fs.run_id
    left join lateral (
      select j.id, j.stage, j.error,
             j.payload->'failure'->>'code' as failure_code,
             j.payload->'failure'->>'action' as failure_action,
             (j.payload->'failure'->>'retryable')::boolean as retryable
      from public.resume_generation_jobs j
      where j.payload->'failure'->>'runId' = fs.run_id
      order by j.updated_at desc
      limit 1
    ) job on true
    order by fs.created_at desc, fs.id desc
    limit p_limit
  )
  select jsonb_build_object(
    'runs', coalesce((select jsonb_agg(x.run order by x.created_at desc, x.id desc) from (select run, created_at, id from runs) x), '[]'::jsonb),
    'hasMore', (select count(*) > p_limit from page)
  ) into result;
  return result;
end;
$$;

revoke all on function public.dashboard_diagnostic_summary(integer) from public, anon, authenticated;
revoke all on function public.dashboard_diagnostic_runs(integer,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.dashboard_diagnostic_summary(integer) to service_role;
grant execute on function public.dashboard_diagnostic_runs(integer,integer,integer,text,text) to service_role;
