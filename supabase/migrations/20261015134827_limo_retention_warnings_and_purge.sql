-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.schedule_retention_for_org(p_organization_id uuid, p_past_due_since timestamptz)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_purge timestamptz := p_past_due_since + interval '30 days';
begin
  insert into public.workspace_retention(organization_id,status,past_due_since,purge_after,purged_at,updated_at)
  values(p_organization_id,'grace',p_past_due_since,v_purge,null,now())
  on conflict (organization_id) do update set
    status='grace',
    past_due_since=excluded.past_due_since,
    purge_after=excluded.purge_after,
    purged_at=null,
    updated_at=now();

  for v_owner in
    select m.user_id
    from public.organization_members m
    where m.organization_id=p_organization_id and m.role='owner'
  loop
    insert into public.notification_outbox(organization_id,user_id,template_key,scheduled_for,payload,dedupe_key)
    values
      (p_organization_id,v_owner,'subscription_expired',p_past_due_since,
       jsonb_build_object('purge_after',v_purge),
       p_organization_id::text||':'||v_owner::text||':subscription_expired:'||extract(epoch from p_past_due_since)::bigint),
      (p_organization_id,v_owner,'renewal_reminder_7d',p_past_due_since+interval '7 days',
       jsonb_build_object('purge_after',v_purge,'days_remaining',23),
       p_organization_id::text||':'||v_owner::text||':renewal_reminder_7d:'||extract(epoch from p_past_due_since)::bigint),
      (p_organization_id,v_owner,'renewal_reminder_21d',p_past_due_since+interval '21 days',
       jsonb_build_object('purge_after',v_purge,'days_remaining',9),
       p_organization_id::text||':'||v_owner::text||':renewal_reminder_21d:'||extract(epoch from p_past_due_since)::bigint),
      (p_organization_id,v_owner,'final_deletion_warning',p_past_due_since+interval '27 days',
       jsonb_build_object('purge_after',v_purge,'days_remaining',3),
       p_organization_id::text||':'||v_owner::text||':final_deletion_warning:'||extract(epoch from p_past_due_since)::bigint)
    on conflict (dedupe_key) do nothing;
  end loop;
end;
$$;
revoke all on function public.schedule_retention_for_org(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.schedule_retention_for_org(uuid,timestamptz) to service_role;

create or replace function public.cancel_retention_for_org(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.workspace_retention(organization_id,status,past_due_since,purge_after,purged_at,updated_at)
  values(p_organization_id,'active',null,null,null,now())
  on conflict (organization_id) do update set
    status='active',
    past_due_since=null,
    purge_after=null,
    purged_at=null,
    updated_at=now();

  update public.notification_outbox
  set status='canceled'
  where organization_id=p_organization_id
    and status='pending'
    and template_key in ('subscription_expired','renewal_reminder_7d','renewal_reminder_21d','final_deletion_warning');
end;
$$;
revoke all on function public.cancel_retention_for_org(uuid) from public,anon,authenticated;
grant execute on function public.cancel_retention_for_org(uuid) to service_role;

create or replace function public.sync_subscription_retention()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='active' and new.renews_at is not null and new.renews_at>now() then
    perform public.cancel_retention_for_org(new.organization_id);
  elsif new.status='past_due' then
    perform public.schedule_retention_for_org(new.organization_id,coalesce(new.renews_at,now()));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_subscription_retention on public.organization_subscriptions;
create trigger trg_subscription_retention
after insert or update of status,renews_at on public.organization_subscriptions
for each row execute function public.sync_subscription_retention();

create or replace function public.mark_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
begin
  update public.organization_subscriptions
  set status='past_due',updated_at=now()
  where status='active'
    and renews_at is not null
    and renews_at<=now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_expired_subscriptions() from public,anon,authenticated;
grant execute on function public.mark_expired_subscriptions() to service_role;

create or replace function public.mark_retention_purge_due()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
begin
  update public.workspace_retention
  set status='purge_due',updated_at=now()
  where status='grace'
    and purge_after is not null
    and purge_after<=now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_retention_purge_due() from public,anon,authenticated;
grant execute on function public.mark_retention_purge_due() to service_role;

create or replace function public.purge_workspace_database_content(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_projects integer:=0;
  v_jobs integer:=0;
  v_series integer:=0;
  v_media integer:=0;
begin
  if not exists(
    select 1 from public.workspace_retention r
    where r.organization_id=p_organization_id
      and r.status='purge_due'
      and r.purge_after<=now()
  ) then
    raise exception 'Workspace is not due for purge';
  end if;

  delete from public.publishing_approvals where organization_id=p_organization_id;
  delete from public.video_jobs where organization_id=p_organization_id;
  delete from public.content_projects where organization_id=p_organization_id;
  get diagnostics v_projects=row_count;

  delete from public.content_jobs where organization_id=p_organization_id;
  get diagnostics v_jobs=row_count;

  delete from public.content_series where organization_id=p_organization_id;
  get diagnostics v_series=row_count;

  delete from public.media_assets where organization_id=p_organization_id;
  get diagnostics v_media=row_count;

  update public.workspace_retention
  set status='purged',purged_at=now(),updated_at=now()
  where organization_id=p_organization_id;

  insert into public.notification_outbox(
    organization_id,user_id,template_key,scheduled_for,payload,dedupe_key
  )
  select p_organization_id,m.user_id,'content_deleted_after_nonpayment',now(),
    jsonb_build_object('purged_at',now()),
    p_organization_id::text||':'||m.user_id::text||':content_deleted_after_nonpayment'
  from public.organization_members m
  where m.organization_id=p_organization_id and m.role='owner'
  on conflict(dedupe_key) do nothing;

  return jsonb_build_object(
    'content_projects',v_projects,
    'content_jobs',v_jobs,
    'content_series',v_series,
    'media_asset_rows',v_media
  );
end;
$$;
revoke all on function public.purge_workspace_database_content(uuid) from public,anon,authenticated;
grant execute on function public.purge_workspace_database_content(uuid) to service_role;

do $$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname='limo-mark-retention-purge-due' limit 1;
  if v_id is not null then perform cron.unschedule(v_id); end if;
end $$;

select cron.schedule(
  'limo-mark-retention-purge-due',
  '45 * * * *',
  'select public.mark_retention_purge_due();'
);
