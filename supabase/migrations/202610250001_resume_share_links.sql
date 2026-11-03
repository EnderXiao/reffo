create extension if not exists pgcrypto;

create table if not exists public.resume_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_history_id text not null,
  mode text not null check (mode in ('job', 'blank')),
  token_hash text not null unique,
  idempotency_key_hash text not null,
  snapshot jsonb not null,
  schema_version integer not null default 1,
  created_via text not null check (created_via in ('image', 'link')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  view_count bigint not null default 0,
  constraint resume_share_links_expiry_valid check (expires_at > created_at),
  constraint resume_share_links_user_idempotency unique (user_id, idempotency_key_hash)
);

create index if not exists idx_resume_share_links_user_created_at
on public.resume_share_links(user_id, created_at desc);

create index if not exists idx_resume_share_links_source_mode
on public.resume_share_links(user_id, source_history_id, mode);

alter table public.resume_share_links enable row level security;

drop policy if exists resume_share_links_owner_select on public.resume_share_links;
create policy resume_share_links_owner_select
on public.resume_share_links for select
using (auth.uid() = user_id);

drop policy if exists resume_share_links_owner_insert on public.resume_share_links;
create policy resume_share_links_owner_insert
on public.resume_share_links for insert
with check (auth.uid() = user_id);

drop policy if exists resume_share_links_owner_update on public.resume_share_links;
create policy resume_share_links_owner_update
on public.resume_share_links for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists resume_share_links_owner_delete on public.resume_share_links;
create policy resume_share_links_owner_delete
on public.resume_share_links for delete
using (auth.uid() = user_id);
