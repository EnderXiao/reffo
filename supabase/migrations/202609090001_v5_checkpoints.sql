-- 单步接口的服务端可信证据检查点；客户端只能透传随机句柄。
create table if not exists public.v5_checkpoints (
  id text primary key,
  owner_id text not null,
  fingerprint text not null,
  expires_at timestamptz not null,
  payload jsonb not null
);
create index if not exists idx_v5_checkpoints_expiry on public.v5_checkpoints(expires_at);
alter table public.v5_checkpoints enable row level security;
revoke all on public.v5_checkpoints from anon, authenticated;
grant select, insert, update, delete on public.v5_checkpoints to service_role;
comment on table public.v5_checkpoints is '服务端 V5 单步检查点，24 小时过期；仅 service_role 可访问。';
