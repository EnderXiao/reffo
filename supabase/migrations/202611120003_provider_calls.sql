-- One requested event and one terminal event per physical network request. Usage is nullable.
create table if not exists public.provider_calls (
  id text primary key,call_id text not null,event_kind text not null check(event_kind in ('requested','completed','failed')),
  run_id text,step_run_id text,attempt_id text,stage text,provider text not null,model text not null,retry_index integer not null,
  call_reason text,occurred_at timestamptz not null,latency_ms integer,input_tokens integer,output_tokens integer,reasoning_tokens integer,
  provider_request_id text,error_code text,expires_at timestamptz not null,unique(call_id,event_kind)
);
create index if not exists provider_calls_run on public.provider_calls(run_id,occurred_at);
create index if not exists provider_calls_expiry on public.provider_calls(expires_at);
alter table public.provider_calls enable row level security;
revoke all on public.provider_calls from anon,authenticated;
grant select,insert,delete on public.provider_calls to service_role;
