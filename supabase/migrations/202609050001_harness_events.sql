create table if not exists public.harness_events (
  id text primary key,
  type text not null,
  version integer not null default 1,
  run_id text not null,
  request_id text not null,
  step_run_id text,
  attempt_id text,
  occurred_at timestamptz not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_harness_events_run_occurred_at
on public.harness_events(run_id, occurred_at asc);

create index if not exists idx_harness_events_occurred_at
on public.harness_events(occurred_at desc);

create table if not exists public.harness_failure_samples (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  reason text,
  status text not null,
  event_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_harness_failure_samples_created_at
on public.harness_failure_samples(created_at desc);

alter table public.harness_events enable row level security;
alter table public.harness_failure_samples enable row level security;

comment on table public.harness_events is 'Server-side Harness telemetry. Access only through service role.';
comment on table public.harness_failure_samples is 'Server-side Harness regression samples. Access only through service role.';
