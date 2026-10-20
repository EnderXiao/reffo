create table if not exists public.resume_generation_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  stage text not null check (stage in ('analysis','matching','optimized','interview','saving')),
  background boolean not null default false,
  read_at timestamptz,
  confirmed_at timestamptz,
  history_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_token text,
  lease_expires_at timestamptz not null default now(),
  quota_charged boolean not null default false,
  payload jsonb not null
);
create index if not exists generation_jobs_owner on public.resume_generation_jobs(user_id, created_at desc);
create index if not exists generation_jobs_pending on public.resume_generation_jobs(status, lease_expires_at);
alter table public.resume_generation_jobs enable row level security;
revoke all on public.resume_generation_jobs from anon, authenticated;
grant select, insert, update, delete on public.resume_generation_jobs to service_role;

create or replace function public.consume_generation_job_quota(
  p_job_id text, p_lease_token text, p_quota_date date, p_daily_limit integer, p_consume boolean
) returns table(allowed boolean, daily_limit integer, used_count integer)
language plpgsql security definer set search_path = public as $$
declare job public.resume_generation_jobs; current_limit integer; current_used integer;
begin
  select * into job from public.resume_generation_jobs where id = p_job_id for update;
  if not found or job.status <> 'running' or job.lease_token is distinct from p_lease_token then
    raise exception 'job lease unavailable';
  end if;
  if job.quota_charged or exists(select 1 from public.profiles where id = job.user_id and quota_unlimited) then
    return query select true, p_daily_limit, 0; return;
  end if;
  insert into public.resume_daily_quotas(user_id, quota_date, daily_limit)
    values (job.user_id, p_quota_date, p_daily_limit) on conflict (user_id, quota_date) do nothing;
  select quota.daily_limit, quota.used_count into current_limit, current_used from public.resume_daily_quotas quota
    where quota.user_id = job.user_id and quota.quota_date = p_quota_date for update;
  if current_used >= current_limit then
    return query select false, current_limit, current_used; return;
  end if;
  if p_consume then
    update public.resume_daily_quotas set used_count = used_count + 1, updated_at = now()
      where user_id = job.user_id and quota_date = p_quota_date;
    update public.resume_generation_jobs set quota_charged = true where id = job.id;
    current_used := current_used + 1;
  end if;
  return query select true, current_limit, current_used;
end;
$$;
revoke all on function public.consume_generation_job_quota(text,text,date,integer,boolean) from public, anon, authenticated;
grant execute on function public.consume_generation_job_quota(text,text,date,integer,boolean) to service_role;
