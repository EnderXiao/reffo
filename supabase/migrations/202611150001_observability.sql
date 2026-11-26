-- 可观测性：异常表 + 埋点表
-- error_events 由后端 onError 写入；analytics_events 由后端 /telemetry 路由写入。
-- 两张表共享 session_id / trace_id 做跨表关联。仅 service_role 可写。

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  session_id text,
  user_id uuid,
  fingerprint text not null,
  path text not null,
  method text not null,
  status integer,
  error_code text,
  error_message text not null,
  error_stack text,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_error_events_trace_id on public.error_events(trace_id);
create index if not exists idx_error_events_fingerprint on public.error_events(fingerprint, created_at desc);
create index if not exists idx_error_events_created_at on public.error_events(created_at desc);

alter table public.error_events enable row level security;
revoke all on public.error_events from anon, authenticated;
grant select, insert, update, delete on public.error_events to service_role;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  trace_id text,
  user_id uuid,
  event_name text not null,
  properties jsonb not null default '{}',
  page text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_session on public.analytics_events(session_id, created_at);
create index if not exists idx_analytics_events_name on public.analytics_events(event_name, created_at);
create index if not exists idx_analytics_events_created_at on public.analytics_events(created_at desc);

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant select, insert, update, delete on public.analytics_events to service_role;
