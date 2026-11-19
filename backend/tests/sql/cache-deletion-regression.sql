-- 独立 PostgreSQL 测试库加载业务父表和全部迁移后执行；全部测试写入回滚。
begin;
do $$
declare
  u uuid := gen_random_uuid(); v uuid := gen_random_uuid(); sid uuid := gen_random_uuid();
  tag text := gen_random_uuid()::text; d text; n integer;
begin
  d := 'digest-'||tag;
  insert into auth.users(id) values(u),(v);
  insert into public.resume_histories(id,user_id,position,company,name,created_at,quality_score,match_score,resume_content,jd_content,optimized_content)
  values(tag,u,'test','test','test',now(),0,0,'test','test','test');
  insert into public.resume_exports(id,owner_id,history_id,request_id,request_digest,document_id,revision,template_version,status,disposition,file_name,reason_codes,omitted_count,omitted_claim_count,model,file_base64,created_at,expires_at)
  values(tag,u,tag,tag,'d','doc',0,'test','ready','draft_only','test.pdf','[]',0,0,'{}','test',now(),now()+interval '1 hour');
  delete from public.resume_histories where user_id=u and id=tag;
  if exists(select 1 from public.resume_histories where user_id=u and id=tag) then raise exception 'history retained'; end if;
  if not exists(select 1 from public.resume_exports where id=tag and status='revoked' and model is null and file_base64 is null) then raise exception 'export not revoked'; end if;
  insert into public.source_resumes(id,user_id,title,resume_markdown,source_type) values(sid,u,'test','test','manual');
  insert into public.resume_stage_cache(cache_key,owner_id,stage,fingerprint,payload,source_digest,expires_at)
  values('a'||tag,u,'analysis','fp',jsonb_build_object('private',true),d,now()+interval '1 hour'),('b'||tag,u,'matching','fp',jsonb_build_object('private',true),d,now()+interval '1 hour');
  insert into public.resume_stage_cache_locks(cache_key,owner_id,source_digest,lease_token,lease_expires_at,revocation_epoch)
  values('a'||tag,u,d,'lease',now()+interval '1 hour','00000000-0000-0000-0000-000000000000');
  insert into public.v5_checkpoints(id,owner_id,fingerprint,expires_at,payload)
  values('u'||tag,u::text,'fp',now()+interval '1 hour',jsonb_build_object('sourceDigest',d)),('v'||tag,v::text,'fp',now()+interval '1 hour','{}'),('g'||tag,'guest-'||tag,'fp',now()+interval '1 hour','{}');
  insert into public.v5_analysis_cache(cache_key,owner_id,fingerprint,status,lease_expires_at,expires_at,created_at,updated_at)
  values('u'||tag,u::text,'fp','ready',now()+interval '1 hour',now()+interval '1 hour',now(),now()),('v'||tag,v::text,'fp','ready',now()+interval '1 hour',now()+interval '1 hour',now(),now()),('g'||tag,'guest-'||tag,'fp','ready',now()+interval '1 hour',now()+interval '1 hour',now(),now());
  if public.delete_resume_source(u,sid) is distinct from true then raise exception 'delete source returned false'; end if;
  if exists(select 1 from public.source_resumes where id=sid) then raise exception 'source retained'; end if;
  select count(*) into n from public.resume_cache_revocations where owner_id=u and source_digest=d;
  if n<>1 then raise exception 'expected one revocation, got %',n; end if;
  select count(*) into n from public.resume_stage_cache where owner_id=u and source_digest=d and payload='{}' and revoked_at is not null;
  if n<>2 then raise exception 'expected two revoked stages, got %',n; end if;
  if exists(select 1 from public.resume_stage_cache_locks where owner_id=u) then raise exception 'lease retained'; end if;
  if exists(select 1 from public.v5_checkpoints where owner_id=u::text) or exists(select 1 from public.v5_analysis_cache where owner_id=u::text) then raise exception 'owner cache retained'; end if;
  select count(*) into n from public.v5_checkpoints where id in ('v'||tag,'g'||tag);
  if n<>2 then raise exception 'unrelated checkpoints deleted'; end if;
  select count(*) into n from public.v5_analysis_cache where cache_key in ('v'||tag,'g'||tag);
  if n<>2 then raise exception 'unrelated analysis cache deleted'; end if;
end $$;
rollback;
