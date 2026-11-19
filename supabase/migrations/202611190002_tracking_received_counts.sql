-- 台账上报量使用本页事件的实际近七天计数，不使用被截断的前十排行。
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
  ), visible as (
    select * from page order by created_at desc,id desc limit p_limit
  ), counted as (
    select v.*, (select count(*) from public.analytics_events e
      where e.event_name=v.event_name
        and e.created_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '6 days'
    ) as received_count from visible v
  ) select jsonb_build_object('requirements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from counted x),'[]'::jsonb),'hasMore',(select count(*)>p_limit from page)) into result;
  return result;
end;
$$;
revoke all on function public.dashboard_tracking_requirements(text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.dashboard_tracking_requirements(text,text,integer,integer,text,text) to service_role;
