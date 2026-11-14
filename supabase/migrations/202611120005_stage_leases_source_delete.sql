create table if not exists public.resume_stage_cache_locks (
  cache_key text primary key,owner_id uuid not null references auth.users(id) on delete cascade,
  source_digest text not null,lease_token text not null,lease_expires_at timestamptz not null
);
alter table public.resume_stage_cache_locks enable row level security;
revoke all on public.resume_stage_cache_locks from anon,authenticated;
grant select,insert,update,delete on public.resume_stage_cache_locks to service_role;
create or replace function public.claim_resume_stage_cache(p_key text,p_owner uuid,p_source_digest text,p_token text,p_expiry timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed text;
begin
  insert into public.resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at)
    values(p_key,p_owner,p_source_digest,p_token,least(p_expiry,now()+interval '4 minutes'))
    on conflict(cache_key) do update set lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
    where resume_stage_cache_locks.owner_id=excluded.owner_id and resume_stage_cache_locks.lease_expires_at<=now()
    returning lease_token into claimed;
  return claimed=p_token;
end; $$;
create or replace function public.store_resume_stage_cache(p_row jsonb,p_lease_token text)
returns void language plpgsql security definer set search_path=public as $$
declare item public.resume_stage_cache;
begin
  item:=jsonb_populate_record(null::public.resume_stage_cache,p_row);
  perform pg_advisory_xact_lock(hashtextextended(item.owner_id::text||item.source_digest,0));
  if not exists(select 1 from public.resume_stage_cache_locks where cache_key=item.cache_key and owner_id=item.owner_id
    and lease_token=p_lease_token and lease_expires_at>now()) then return; end if;
  if exists(select 1 from public.resume_cache_revocations where owner_id=item.owner_id and source_digest=item.source_digest) then return; end if;
  insert into public.resume_stage_cache select item.* on conflict(cache_key) do update set payload=excluded.payload,expires_at=excluded.expires_at,revoked_at=null;
end; $$;

create or replace function public.delete_resume_source(p_owner uuid,p_source_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.source_resumes where user_id=p_owner and id=p_source_id for update;
  if not found then return false; end if;
  perform public.revoke_resume_source_transients(p_owner);
  delete from public.resume_stage_cache_locks where owner_id=p_owner;
  delete from public.source_resumes where user_id=p_owner and id=p_source_id;
  return true;
end; $$;
revoke all on function public.claim_resume_stage_cache(text,uuid,text,text,timestamptz),
  public.store_resume_stage_cache(jsonb,text),public.delete_resume_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_resume_stage_cache(text,uuid,text,text,timestamptz),
  public.store_resume_stage_cache(jsonb,text),public.delete_resume_source(uuid,uuid) to service_role;
