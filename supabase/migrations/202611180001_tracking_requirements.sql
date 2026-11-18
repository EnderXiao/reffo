-- 埋点需求台账：记录待实现/已上线的埋点需求
-- Agent 通过 MCP 读取需求，去前端实现埋点；实现后标记 implemented。

create table if not exists public.tracking_requirements (
  id uuid primary key default gen_random_uuid(),
  event_name text not null unique,
  params jsonb not null default '[]',
  page text not null,
  description text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tracking_requirements_status on public.tracking_requirements(status, created_at desc);

alter table public.tracking_requirements enable row level security;
revoke all on public.tracking_requirements from anon, authenticated;
grant select, insert, update, delete on public.tracking_requirements to service_role;
