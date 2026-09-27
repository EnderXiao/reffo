-- 认证用户的 V5 analyze 成功结果缓存与跨实例幂等租约。
create table if not exists public.v5_analysis_cache (
  cache_key text primary key,
  owner_id text not null,
  fingerprint text not null,
  status text not null check (status in ('pending', 'ready')),
  lease_token text not null default '',
  lease_expires_at timestamptz not null,
  payload jsonb,
  expires_at timestamptz not null,
  hit_count integer not null default 0 check (hit_count >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_v5_analysis_cache_expiry
on public.v5_analysis_cache(expires_at);

create index if not exists idx_v5_analysis_cache_owner
on public.v5_analysis_cache(owner_id, fingerprint, expires_at);

alter table public.v5_analysis_cache enable row level security;
revoke all on public.v5_analysis_cache from anon, authenticated;
grant select, insert, update, delete on public.v5_analysis_cache to service_role;

comment on table public.v5_analysis_cache is 'V5 analyze 成功结果缓存；缓存键绑定用户、规范化简历和发布指纹，仅 service_role 可访问。';
