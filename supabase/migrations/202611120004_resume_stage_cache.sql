create table if not exists public.resume_stage_cache (
  cache_key text primary key,owner_id uuid not null references auth.users(id) on delete cascade,
  stage text not null,fingerprint text not null,payload jsonb not null,source_digest text not null,
  expires_at timestamptz not null,revoked_at timestamptz
);
create table if not exists public.resume_stage_refs (
  owner_id uuid not null references auth.users(id) on delete cascade,history_id text not null,source_digest text not null,
  primary key(owner_id,history_id,source_digest)
);
create table if not exists public.resume_cache_revocations (
  owner_id uuid not null references auth.users(id) on delete cascade,source_digest text not null,revoked_at timestamptz not null,
  primary key(owner_id,source_digest)
);
create index if not exists resume_stage_source on public.resume_stage_cache(owner_id,source_digest);
alter table public.resume_stage_cache enable row level security;
alter table public.resume_stage_refs enable row level security;
alter table public.resume_cache_revocations enable row level security;
revoke all on public.resume_stage_cache,public.resume_stage_refs,public.resume_cache_revocations from anon,authenticated;
grant select,insert,update,delete on public.resume_stage_cache,public.resume_stage_refs,public.resume_cache_revocations to service_role;

create or replace function public.store_resume_stage_cache(p_row jsonb) returns void language plpgsql security definer set search_path=public as $$
declare item public.resume_stage_cache;
begin
  item := jsonb_populate_record(null::public.resume_stage_cache,p_row);
  perform pg_advisory_xact_lock(hashtextextended(item.owner_id::text||item.source_digest,0));
  if exists(select 1 from public.resume_cache_revocations where owner_id=item.owner_id and source_digest=item.source_digest) then return; end if;
  insert into public.resume_stage_cache select item.* on conflict(cache_key) do update set payload=excluded.payload,expires_at=excluded.expires_at,revoked_at=null;
end; $$;

create or replace function public.revoke_deleted_resume_stage() returns trigger language plpgsql security definer set search_path=public as $$
declare source_ref record;
begin
  for source_ref in select source_digest from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id order by source_digest loop
    perform pg_advisory_xact_lock(hashtextextended(old.user_id::text||source_ref.source_digest,0));
  end loop;
  insert into public.resume_cache_revocations(owner_id,source_digest,revoked_at)
    select old.user_id,source_digest,now() from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id
    on conflict(owner_id,source_digest) do update set revoked_at=now();
  update public.resume_stage_cache set revoked_at=now(),payload='{}' where owner_id=old.user_id and source_digest in
    (select source_digest from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id);
  delete from public.v5_checkpoints where owner_id=old.user_id and payload->>'sourceDigest' in
    (select source_digest from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id);
  delete from public.v5_analysis_cache where owner_id=old.user_id;
  delete from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id;
  return old;
end; $$;
create trigger revoke_deleted_resume_stage after delete on public.resume_histories for each row execute function public.revoke_deleted_resume_stage();
revoke all on function public.revoke_deleted_resume_stage() from public,anon,authenticated;
revoke all on function public.store_resume_stage_cache(jsonb) from public,anon,authenticated;
grant execute on function public.store_resume_stage_cache(jsonb) to service_role;
create or replace function public.revoke_resume_source_transients(p_owner uuid) returns void language plpgsql security definer set search_path=public as $$
declare source_ref record;
begin
  for source_ref in select distinct source_digest from public.resume_stage_cache where owner_id=p_owner order by source_digest loop
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text||source_ref.source_digest,0));
  end loop;
  insert into public.resume_cache_revocations(owner_id,source_digest,revoked_at)
    select p_owner,source_digest,now() from public.resume_stage_cache where owner_id=p_owner on conflict(owner_id,source_digest) do update set revoked_at=now();
  update public.resume_stage_cache set revoked_at=now(),payload='{}' where owner_id=p_owner;
  delete from public.v5_checkpoints where owner_id=p_owner;
  delete from public.v5_analysis_cache where owner_id=p_owner;
  update public.resume_exports set status='revoked',model=null,file_base64=null,lease_token=null where owner_id=p_owner;
end; $$;
revoke all on function public.revoke_resume_source_transients(uuid) from public,anon,authenticated;
grant execute on function public.revoke_resume_source_transients(uuid) to service_role;
