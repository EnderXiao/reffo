-- 管理后台权限与审计
create table if not exists public.dashboard_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  role text not null check (role in ('owner','viewer')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_role text not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_dashboard_members_user on public.dashboard_members(user_id, status);
create index if not exists idx_dashboard_audit_created on public.dashboard_audit_logs(created_at desc);

alter table public.dashboard_members enable row level security;
alter table public.dashboard_audit_logs enable row level security;
revoke all on public.dashboard_members from anon, authenticated;
revoke all on public.dashboard_audit_logs from anon, authenticated;
grant select, insert, update, delete on public.dashboard_members to service_role;
grant select, insert on public.dashboard_audit_logs to service_role;

-- 所有聚合只允许受控字段，时间过滤先下推；不把原始事件拉到 API 进程。
create or replace function public.dashboard_aggregate(
  p_source text, p_group text, p_days integer default 7, p_limit integer default 50,
  p_dimension text default 'event_name', p_top_n integer default 3
) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
declare
  tab text;
  expr text;
  ordering text;
  cutoff timestamptz := (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - make_interval(days => p_days - 1);
  result jsonb;
begin
  if p_source is null or p_group is null or p_days is null or p_limit is null or p_top_n is null or p_dimension is null or p_source not in ('errors','analytics') or p_days not between 1 and 90 or p_limit not between 1 and 100 or p_top_n not between 1 and 8 then
    raise exception 'invalid dashboard query';
  end if;
  tab := case when p_source = 'errors' then 'error_events' else 'analytics_events' end;
  if p_group = 'day_series' then
    if not ((p_source = 'errors' and p_dimension = 'fingerprint') or (p_source = 'analytics' and p_dimension = 'event_name')) then
      raise exception 'invalid dashboard dimension';
    end if;
    execute format($q$
      with counts as (
        select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as day, %I::text as key, count(*) as value
        from public.%I where created_at >= $1 group by 1, 2
      ), ranked as (
        select *, row_number() over (partition by day order by value desc, key asc) as rank from counts
      ), collapsed as (
        select day, case when rank <= $2 then key else '其他' end as key, sum(value) as value
        from ranked group by 1, 2
      ), days as (
        select to_char(d at time zone 'UTC','YYYY-MM-DD') as day
        from generate_series($1, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', interval '1 day') d
      ), points as (
        select days.day, coalesce(sum(c.value),0) as value,
          coalesce(jsonb_agg(jsonb_build_object('key',c.key,'value',c.value) order by (c.key = '其他'),c.value desc,c.key asc) filter (where c.key is not null),'[]'::jsonb) as series
        from days left join collapsed c on c.day = days.day group by days.day
      ) select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('key', day, 'value', value, 'series', series) order by day),'[]'::jsonb)) from points
    $q$, p_dimension, tab) into result using cutoff, p_top_n;
    return result;
  end if;
  if p_group = 'day' then expr := 'to_char(created_at at time zone ''UTC'',''YYYY-MM-DD'')';
  elsif p_group = 'hour' then expr := 'to_char(created_at at time zone ''UTC'',''YYYY-MM-DD"T"HH24'')';
  elsif p_source = 'errors' and p_group in ('fingerprint','path','status','method') then expr := format('%I::text',p_group);
  elsif p_source = 'analytics' and p_group = 'event_name' then expr := 'event_name';
  else raise exception 'invalid dashboard group';
  end if;
  ordering := case when p_group in ('day','hour') then 'key asc' else 'value desc,key asc' end;
  execute format($q$
    select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)) from (
      select %s as key, count(*) as value from public.%I where created_at >= $1 group by 1 order by %s limit $2
    ) r
  $q$,expr,tab,ordering) into result using cutoff,p_limit;
  return result;
end;
$$;

create or replace function public.dashboard_issues(p_days integer default 7, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
declare result jsonb;
begin
  if p_days is null or p_limit is null or p_offset is null or p_days not between 1 and 90 or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then raise exception 'invalid dashboard query'; end if;
  with grouped as (
    select fingerprint, count(*) as count from public.error_events
    where created_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - make_interval(days => p_days - 1)
    group by fingerprint
  ), page as (
    select * from grouped order by count desc, fingerprint asc limit p_limit + 1 offset p_offset
  ), expanded as (
    select p.*, e.error_message as "latestMessage", e.path as "latestPath", e.created_at as "latestAt"
    from page p cross join lateral (select error_message,path,created_at from public.error_events where fingerprint=p.fingerprint order by created_at desc,id desc limit 1) e
    order by p.count desc,p.fingerprint asc
  ) select jsonb_build_object('issues',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from expanded limit p_limit) x),'[]'::jsonb),'hasMore',(select count(*) > p_limit from page)) into result;
  return result;
end;
$$;

revoke all on function public.dashboard_aggregate(text,text,integer,integer,text,integer) from public, anon, authenticated;
revoke all on function public.dashboard_issues(integer,integer,integer) from public, anon, authenticated;
grant execute on function public.dashboard_aggregate(text,text,integer,integer,text,integer) to service_role;
grant execute on function public.dashboard_issues(integer,integer,integer) to service_role;
create index if not exists idx_analytics_events_trace_id on public.analytics_events(trace_id,created_at desc);

-- 台账分页/分类同样由数据库执行，避免浏览器拉全量。
create or replace function public.dashboard_tracking_pages()
returns jsonb language sql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
 select jsonb_build_object('pages', coalesce(jsonb_agg(page order by page),'[]'::jsonb)) from (
   select distinct case page when 'pages/auth' then '登录/注册页' when 'pages/create' then '创建页' when 'pages/result' then '结果页' when '首页任务卡片' then '首页' else page end as page
   from public.tracking_requirements order by page limit 100
 ) r;
$$;

create or replace function public.dashboard_tracking_requirements(
  p_status text default null,p_event text default null,p_limit integer default 100,p_offset integer default 0,p_page text default null,p_search text default null
) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
declare result jsonb;
begin
  if p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset not between 0 and 10000
     or (p_status is not null and p_status not in ('pending','implemented'))
     or length(p_page) > 100 or length(p_search) > 100 or length(p_event) > 100 then raise exception 'invalid dashboard query'; end if;
  with page as (
    select * from public.tracking_requirements r
    where (p_status is null or status=p_status) and (p_event is null or event_name=p_event)
      and (p_page is null or (case r.page when 'pages/auth' then '登录/注册页' when 'pages/create' then '创建页' when 'pages/result' then '结果页' when '首页任务卡片' then '首页' else r.page end)=p_page)
      and (p_search is null or strpos(lower(event_name),lower(p_search))>0 or strpos(description,p_search)>0)
    order by created_at desc,id desc limit p_limit+1 offset p_offset
  ) select jsonb_build_object('requirements',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from page limit p_limit) x),'[]'::jsonb),'hasMore',(select count(*)>p_limit from page)) into result;
  return result;
end;
$$;
revoke all on function public.dashboard_tracking_pages() from public,anon,authenticated;
revoke all on function public.dashboard_tracking_requirements(text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.dashboard_tracking_pages() to service_role;
grant execute on function public.dashboard_tracking_requirements(text,text,integer,integer,text,text) to service_role;
