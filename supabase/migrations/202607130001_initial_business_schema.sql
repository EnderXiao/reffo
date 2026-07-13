create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  resume_markdown text not null,
  source_type text not null check (source_type in ('manual', 'file')),
  original_file_name text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_source_resumes_user_updated_at
on public.source_resumes(user_id, updated_at desc);

create table if not exists public.resume_histories (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position text not null,
  company text not null,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  quality_score integer not null,
  match_score integer not null,
  tags jsonb not null default '[]'::jsonb,
  resume_content text not null,
  jd_content text not null,
  optimized_content text not null,
  optimization_suggestions jsonb,
  changes_summary jsonb,
  process_result jsonb,
  result_context jsonb,
  progress jsonb,
  card_color text,
  card_pattern text,
  primary key (user_id, id)
);

create index if not exists idx_resume_histories_user_created_at
on public.resume_histories(user_id, created_at desc);

create index if not exists idx_resume_histories_user_updated_at
on public.resume_histories(user_id, updated_at desc);

create table if not exists public.user_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('resume', 'jobDescription', 'export')),
  bucket text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_files_user_created_at
on public.user_files(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.source_resumes enable row level security;
alter table public.resume_histories enable row level security;
alter table public.user_files enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists source_resumes_own on public.source_resumes;
create policy source_resumes_own
on public.source_resumes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists resume_histories_own on public.resume_histories;
create policy resume_histories_own
on public.resume_histories for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_files_own on public.user_files;
create policy user_files_own
on public.user_files for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
