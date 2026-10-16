-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.mark_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.organization_subscriptions
  set status='past_due',
      updated_at=now()
  where status='active'
    and renews_at is not null
    and renews_at<=now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_expired_subscriptions() from public,anon,authenticated;
grant execute on function public.mark_expired_subscriptions() to service_role;

create or replace function public.cleanup_expired_social_oauth_states()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.social_oauth_states
  where expires_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.cleanup_expired_social_oauth_states() from public,anon,authenticated;
grant execute on function public.cleanup_expired_social_oauth_states() to service_role;

do $$
declare
  v_id bigint;
begin
  select jobid into v_id from cron.job where jobname='limo-expire-subscriptions' limit 1;
  if v_id is not null then perform cron.unschedule(v_id); end if;
  select jobid into v_id from cron.job where jobname='limo-clean-oauth-states' limit 1;
  if v_id is not null then perform cron.unschedule(v_id); end if;
end $$;

select cron.schedule(
  'limo-expire-subscriptions',
  '15 * * * *',
  'select public.mark_expired_subscriptions();'
);

select cron.schedule(
  'limo-clean-oauth-states',
  '37 3 * * *',
  'select public.cleanup_expired_social_oauth_states();'
);
