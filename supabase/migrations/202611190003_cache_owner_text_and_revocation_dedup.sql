-- 前向修复：业务 UUID 与 V5 文本 owner 比较时，仅把 UUID 一侧转为 text。
-- 同一源的不同 stage 只插入一条撤销记录，避免 ON CONFLICT 二次命中。
-- 不改变数据列类型、不回写业务行、不修改已经执行过的迁移。

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
  delete from public.v5_checkpoints where owner_id=old.user_id::text and payload->>'sourceDigest' in
    (select source_digest from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id);
  delete from public.v5_analysis_cache where owner_id=old.user_id::text;
  delete from public.resume_stage_refs where owner_id=old.user_id and history_id=old.id;
  return old;
end; $$;

create or replace function public.revoke_resume_source_transients(p_owner uuid) returns void language plpgsql security definer set search_path=public as $$
declare source_ref record;
begin
  for source_ref in select distinct source_digest from public.resume_stage_cache where owner_id=p_owner order by source_digest loop
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text||source_ref.source_digest,0));
  end loop;
  insert into public.resume_cache_revocations(owner_id,source_digest,revoked_at)
    select distinct p_owner,source_digest,now() from public.resume_stage_cache where owner_id=p_owner on conflict(owner_id,source_digest) do update set revoked_at=now();
  update public.resume_stage_cache set revoked_at=now(),payload='{}' where owner_id=p_owner;
  delete from public.v5_checkpoints where owner_id=p_owner::text;
  delete from public.v5_analysis_cache where owner_id=p_owner::text;
  update public.resume_exports set status='revoked',model=null,file_base64=null,lease_token=null where owner_id=p_owner;
end; $$;

revoke all on function public.revoke_deleted_resume_stage(), public.revoke_resume_source_transients(uuid) from public,anon,authenticated;
grant execute on function public.revoke_resume_source_transients(uuid) to service_role;
