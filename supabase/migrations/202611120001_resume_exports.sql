-- 短期、私有、固定文档版本的导出快照。正文与文件一同过期，仅服务端可访问。
create table if not exists public.resume_exports (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  history_id text not null,
  request_id text not null,
  request_digest text not null,
  document_id text not null,
  revision integer not null check (revision >= 0),
  template_version text not null,
  eligibility_digest text,
  lease_token text,
  lease_expires_at timestamptz,
  omitted_gap_ids jsonb,
  omitted_claim_ids jsonb,
  delivery_state jsonb,
  status text not null check (status in ('pending','ready','failed','revoked')),
  disposition text not null check (disposition in ('application_ready','draft_only')),
  file_name text not null,
  reason_codes jsonb not null,
  omitted_count integer not null check (omitted_count >= 0),
  omitted_claim_count integer not null check (omitted_claim_count >= 0),
  model jsonb,
  file_base64 text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  unique(owner_id, request_id)
);
create index if not exists resume_exports_expiry on public.resume_exports(expires_at);
create index if not exists resume_exports_owner_history on public.resume_exports(owner_id, history_id);
alter table public.resume_exports enable row level security;
revoke all on public.resume_exports from anon, authenticated;
grant select, insert, update, delete on public.resume_exports to service_role;

-- A history deletion revokes already-rendering snapshots inside the same transaction.
create or replace function public.revoke_deleted_resume_exports()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.resume_exports set status = 'revoked', model = null, file_base64 = null
    where owner_id = old.user_id and history_id = old.id;
  return old;
end;
$$;
drop trigger if exists revoke_deleted_resume_exports on public.resume_histories;
create trigger revoke_deleted_resume_exports after delete on public.resume_histories
  for each row execute function public.revoke_deleted_resume_exports();
revoke all on function public.revoke_deleted_resume_exports() from public, anon, authenticated;
