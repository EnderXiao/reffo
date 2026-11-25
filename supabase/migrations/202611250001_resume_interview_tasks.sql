create table if not exists public.resume_interview_tasks (
  user_id uuid not null,
  history_id text not null,
  version text not null check (version ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','running','done','failed','stale')),
  lease_token text,
  available_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  result jsonb,
  primary key (user_id, history_id, version),
  foreign key (user_id, history_id) references public.resume_histories(user_id, id) on delete cascade
);
create index if not exists idx_resume_interview_tasks_pending on public.resume_interview_tasks(available_at)
  where status in ('pending','running');
alter table public.resume_interview_tasks enable row level security;
revoke all on public.resume_interview_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.resume_interview_tasks to service_role;

-- The history REST table has an owner-write policy. Managed snapshots must
-- still pass the application server's document replay and ownership checks.
create or replace function public.guard_managed_resume_interview()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'UPDATE' and old.process_result ? 'server_interview_task' then
      raise insufficient_privilege using message = 'Managed resume updates require the history commit endpoint';
    end if;
    new.process_result := new.process_result - 'server_interview_task';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_managed_resume_interview on public.resume_histories;
create trigger guard_managed_resume_interview before insert or update on public.resume_histories
  for each row execute function public.guard_managed_resume_interview();

-- This trigger runs as the history commit function's owner. SDK writes by an
-- authenticated user must never enqueue paid model work.
create or replace function public.enqueue_initial_resume_interview()
returns trigger language plpgsql security invoker set search_path = public as $$
declare initial_version text := new.process_result->>'server_interview_task';
begin
  if tg_op = 'UPDATE' and old.process_result->>'server_interview_task' is not null then
    return new;
  end if;
  if current_user not in ('anon', 'authenticated') and initial_version is not null then
    insert into public.resume_interview_tasks(user_id, history_id, version) values(new.user_id, new.id, initial_version);
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_resume_interview on public.resume_histories;
create trigger enqueue_resume_interview after insert or update of process_result on public.resume_histories
  for each row execute function public.enqueue_initial_resume_interview();

-- V5 checkpoints and the analysis cache use text owners (including guest).
-- A text/UUID comparison would roll back the history delete and its cascade.
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
    select p_owner,source_digest,now() from public.resume_stage_cache where owner_id=p_owner on conflict(owner_id,source_digest) do update set revoked_at=now();
  update public.resume_stage_cache set revoked_at=now(),payload='{}' where owner_id=p_owner;
  delete from public.v5_checkpoints where owner_id=p_owner::text;
  delete from public.v5_analysis_cache where owner_id=p_owner::text;
  update public.resume_exports set status='revoked',model=null,file_base64=null,lease_token=null where owner_id=p_owner;
end; $$;
