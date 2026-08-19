create or replace function public.is_auth_email_registered(check_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where lower(auth.users.email) = lower(trim(check_email))
  );
$$;

revoke all on function public.is_auth_email_registered(text) from public;
revoke all on function public.is_auth_email_registered(text) from anon;
revoke all on function public.is_auth_email_registered(text) from authenticated;
grant execute on function public.is_auth_email_registered(text) to service_role;
