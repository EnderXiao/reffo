-- 看板低代码平台：页面与图表配置
-- dashboard_pages 存子页面；dashboard_charts 存页面内的图表卡片（类型 + 数据查询 + 位置）。

create table if not exists public.dashboard_pages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_charts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.dashboard_pages(id) on delete cascade,
  chart_type text not null,
  title text not null,
  data_query jsonb not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_dashboard_charts_page on public.dashboard_charts(page_id, position);

alter table public.dashboard_pages enable row level security;
alter table public.dashboard_charts enable row level security;
revoke all on public.dashboard_pages from anon, authenticated;
revoke all on public.dashboard_charts from anon, authenticated;
grant select, insert, update, delete on public.dashboard_pages to service_role;
grant select, insert, update, delete on public.dashboard_charts to service_role;
