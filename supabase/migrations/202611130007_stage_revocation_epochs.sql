-- A deletion invalidates existing leases; a fresh request may recompute the
-- same source without deleting the revocation or reviving its old payload.
alter table public.resume_cache_revocations add column if not exists revocation_epoch uuid not null default gen_random_uuid();
alter table public.resume_stage_cache_locks add column if not exists revocation_epoch uuid;
delete from public.resume_stage_cache_locks where revocation_epoch is null;

create or replace function public.advance_resume_cache_revocation_epoch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text||new.source_digest,0));
  new.revocation_epoch:=gen_random_uuid();
  update public.resume_stage_cache set revoked_at=new.revoked_at,payload='{}'
    where owner_id=new.owner_id and source_digest=new.source_digest;
  delete from public.resume_stage_cache_locks where owner_id=new.owner_id and source_digest=new.source_digest;
  return new;
end; $$;
drop trigger if exists advance_resume_cache_revocation_epoch on public.resume_cache_revocations;
create trigger advance_resume_cache_revocation_epoch before insert or update of revoked_at on public.resume_cache_revocations
  for each row execute function public.advance_resume_cache_revocation_epoch();

create or replace function public.claim_resume_stage_cache(p_key text,p_owner uuid,p_source_digest text,p_token text,p_expiry timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare claimed text; current_epoch uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_source_digest,0));
  select revocation_epoch into current_epoch from public.resume_cache_revocations where owner_id=p_owner and source_digest=p_source_digest;
  insert into public.resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at,revocation_epoch)
    values(p_key,p_owner,p_source_digest,p_token,least(p_expiry,now()+interval '4 minutes'),
      coalesce(current_epoch,'00000000-0000-0000-0000-000000000000'::uuid))
    on conflict(cache_key) do update set lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,
      source_digest=excluded.source_digest,revocation_epoch=excluded.revocation_epoch
    where resume_stage_cache_locks.owner_id=excluded.owner_id and resume_stage_cache_locks.lease_expires_at<=now()
    returning lease_token into claimed;
  return coalesce(claimed=p_token,false);
end; $$;

create or replace function public.store_resume_stage_cache(p_row jsonb,p_lease_token text)
returns void language plpgsql security definer set search_path=public as $$
declare item public.resume_stage_cache;
begin
  item:=jsonb_populate_record(null::public.resume_stage_cache,p_row);
  perform pg_advisory_xact_lock(hashtextextended(item.owner_id::text||item.source_digest,0));
  if not exists(select 1 from public.resume_stage_cache_locks lease
    where lease.cache_key=item.cache_key and lease.owner_id=item.owner_id and lease.source_digest=item.source_digest
      and lease.lease_token=p_lease_token and lease.lease_expires_at>now()
      and lease.revocation_epoch=coalesce((select revocation_epoch from public.resume_cache_revocations
        where owner_id=item.owner_id and source_digest=item.source_digest),'00000000-0000-0000-0000-000000000000'::uuid)) then return; end if;
  insert into public.resume_stage_cache select item.* on conflict(cache_key) do update
    set payload=excluded.payload,expires_at=excluded.expires_at,revoked_at=null;
end; $$;

revoke all on function public.advance_resume_cache_revocation_epoch(),
  public.claim_resume_stage_cache(text,uuid,text,text,timestamptz),public.store_resume_stage_cache(jsonb,text) from public,anon,authenticated;
revoke execute on function public.store_resume_stage_cache(jsonb) from service_role;
grant execute on function public.claim_resume_stage_cache(text,uuid,text,text,timestamptz),public.store_resume_stage_cache(jsonb,text) to service_role;
