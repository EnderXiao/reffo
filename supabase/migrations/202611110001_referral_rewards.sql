-- 分享注册邀请奖励：建表 + RPC
-- 由 release-tag 流程的 supabase db push 自动应用，无需手动执行。
-- 应用层对应实现：backend/src/repositories/referral-reward-repository.ts

create table if not exists public.resume_referral_rewards (
  invitee_user_id uuid primary key,
  inviter_user_id uuid not null,
  invitee_email text not null unique,
  share_link_id uuid not null unique,
  bonus_count integer not null default 3,
  created_at timestamptz not null default now()
);

create index if not exists referral_rewards_inviter_idx
  on public.resume_referral_rewards (inviter_user_id, created_at);

create table if not exists public.resume_bonus_quotas (
  user_id uuid primary key,
  bonus_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.claim_referral_reward(
  p_invitee_user_id uuid,
  p_inviter_user_id uuid,
  p_invitee_email text,
  p_share_link_id uuid,
  p_bonus_count integer
) returns table (outcome text)
language plpgsql security definer
as $$
declare
  v_email text := lower(trim(p_invitee_email));
begin
  if p_bonus_count is null or p_bonus_count <= 0 then
    raise exception 'invalid bonus count';
  end if;
  if exists (select 1 from public.resume_referral_rewards where invitee_user_id = p_invitee_user_id) then
    return query select 'invitee_duplicate'::text;
    return;
  end if;
  if exists (select 1 from public.resume_referral_rewards where invitee_email = v_email) then
    return query select 'email_duplicate'::text;
    return;
  end if;
  if exists (select 1 from public.resume_referral_rewards where share_link_id = p_share_link_id) then
    return query select 'token_duplicate'::text;
    return;
  end if;
  insert into public.resume_referral_rewards (invitee_user_id, inviter_user_id, invitee_email, share_link_id, bonus_count)
    values (p_invitee_user_id, p_inviter_user_id, v_email, p_share_link_id, p_bonus_count);
  insert into public.resume_bonus_quotas (user_id, bonus_count)
    values (p_invitee_user_id, p_bonus_count), (p_inviter_user_id, p_bonus_count)
    on conflict (user_id) do update
      set bonus_count = resume_bonus_quotas.bonus_count + excluded.bonus_count, updated_at = now();
  return query select 'claimed'::text;
end;
$$;

create or replace function public.consume_referral_bonus(
  p_user_id uuid
) returns table (consumed boolean)
language plpgsql security definer
as $$
begin
  update public.resume_bonus_quotas
    set bonus_count = bonus_count - 1, updated_at = now()
    where user_id = p_user_id and bonus_count > 0;
  if found then
    return query select true;
  else
    return query select false;
  end if;
end;
$$;

-- 已执行过旧版脚本的环境：为已存在的表补充 share_link_id 列（幂等）。
-- 旧记录（若有）该列为 null，不参与唯一校验；上线前表基本为空，无需回填。
alter table public.resume_referral_rewards add column if not exists share_link_id uuid;
create unique index if not exists referral_rewards_share_link_idx
  on public.resume_referral_rewards (share_link_id)
  where share_link_id is not null;

-- 仅服务端 service_role 可执行，杜绝客户端直接刷额度。
revoke execute on function public.claim_referral_reward(uuid, uuid, text, uuid, integer) from anon, authenticated;
revoke execute on function public.consume_referral_bonus(uuid) from anon, authenticated;
grant execute on function public.claim_referral_reward(uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.consume_referral_bonus(uuid) to service_role;
