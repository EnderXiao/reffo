create table if not exists public.resume_daily_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  daily_limit integer not null check (daily_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date)
);

alter table public.profiles
add column if not exists quota_unlimited boolean not null default false;

-- 迁移时已有账号属于内测白名单；之后注册账号使用默认 false。
insert into public.profiles(id, quota_unlimited)
select id, true from auth.users
on conflict (id) do update set quota_unlimited = true;

alter table public.resume_daily_quotas enable row level security;

drop policy if exists resume_daily_quotas_own on public.resume_daily_quotas;
create policy resume_daily_quotas_own on public.resume_daily_quotas for select using (auth.uid() = user_id);

create or replace function public.consume_resume_quota(
  p_user_id uuid,
  p_quota_date date,
  p_daily_limit integer,
  p_consume boolean default true
)
returns table(allowed boolean, daily_limit integer, used_count integer, unlimited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare current_limit integer; current_used integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'quota user mismatch' using errcode = '42501';
  end if;

  if exists(select 1 from public.profiles where id = p_user_id and quota_unlimited = true) then
    return query select true, null::integer, 0, true;
    return;
  end if;

  insert into public.resume_daily_quotas(user_id, quota_date, daily_limit)
  values (p_user_id, p_quota_date, p_daily_limit)
  on conflict (user_id, quota_date) do nothing;

  select r.daily_limit, r.used_count into current_limit, current_used
  from public.resume_daily_quotas r
  where r.user_id = p_user_id and r.quota_date = p_quota_date
  for update;

  if current_used >= current_limit then
    return query select false, current_limit, current_used, false;
  end if;

  if p_consume then
    update public.resume_daily_quotas
    set used_count = used_count + 1, updated_at = now()
    where user_id = p_user_id and quota_date = p_quota_date;
    current_used := current_used + 1;
  end if;
  return query select true, current_limit, current_used, false;
end;
$$;
