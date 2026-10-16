-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.purge_workspace_database_content(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_studio_projects integer:=0;
  v_legacy_projects integer:=0;
  v_jobs integer:=0;
  v_series integer:=0;
  v_safety_reviews integer:=0;
  v_media integer:=0;
  v_preferences integer:=0;
  v_generation_runs integer:=0;
  v_generation_stages integer:=0;
  v_run record;
  v_known_cost integer;
  v_has_provider_task boolean;
  v_reservation_status text;
  v_job_status text;
begin
  if not exists(
    select 1
    from public.workspace_retention r
    where r.organization_id=p_organization_id
      and r.status='purge_due'
      and r.purge_after<=now()
  ) then
    raise exception 'Workspace is not due for purge';
  end if;

  select count(*) into v_generation_runs
  from public.generation_runs
  where organization_id=p_organization_id;

  select count(*) into v_generation_stages
  from public.generation_run_stages
  where organization_id=p_organization_id;

  for v_run in
    select id,ai_reservation_id,root_job_id,status
    from public.generation_runs
    where organization_id=p_organization_id
    for update
  loop
    select coalesce(sum(actual_cost_cents),0)::integer,
           bool_or(provider_job_id is not null)
    into v_known_cost,v_has_provider_task
    from public.generation_run_stages
    where run_id=v_run.id;

    if v_run.root_job_id is not null then
      select status into v_job_status
      from public.content_jobs
      where id=v_run.root_job_id
      for update;

      if v_job_status in ('queued','processing') then
        perform public.fail_content_job(
          v_run.root_job_id,
          'workspace_purged_after_nonpayment',
          v_known_cost,
          false
        );
      end if;

      perform public.refund_generation_usage_once(v_run.root_job_id);
    end if;

    if v_run.ai_reservation_id is not null then
      select status into v_reservation_status
      from public.ai_cost_reservations
      where id=v_run.ai_reservation_id
      for update;

      if v_reservation_status='reserved' then
        if coalesce(v_known_cost,0)=0 and not coalesce(v_has_provider_task,false) then
          perform public.settle_ai_budget(
            v_run.ai_reservation_id,
            'released',
            0
          );
        else
          perform public.settle_ai_budget(
            v_run.ai_reservation_id,
            'needs_reconciliation',
            coalesce(v_known_cost,0)
          );
        end if;
      end if;
    end if;
  end loop;

  insert into public.media_deletion_queue(
    organization_id,bucket_id,object_path
  )
  select organization_id,bucket_id,object_path
  from public.media_assets
  where organization_id=p_organization_id
  on conflict(bucket_id,object_path) do nothing;

  delete from public.publishing_approvals
  where organization_id=p_organization_id;

  delete from public.video_jobs
  where organization_id=p_organization_id;

  delete from public.studio_projects
  where organization_id=p_organization_id;
  get diagnostics v_studio_projects=row_count;

  delete from public.content_projects
  where organization_id=p_organization_id;
  get diagnostics v_legacy_projects=row_count;

  delete from public.content_jobs
  where organization_id=p_organization_id;
  get diagnostics v_jobs=row_count;

  delete from public.content_safety_reviews
  where organization_id=p_organization_id;
  get diagnostics v_safety_reviews=row_count;

  delete from public.content_series
  where organization_id=p_organization_id;
  get diagnostics v_series=row_count;

  delete from public.organization_content_preferences
  where organization_id=p_organization_id;
  get diagnostics v_preferences=row_count;

  delete from public.media_assets
  where organization_id=p_organization_id;
  get diagnostics v_media=row_count;

  delete from public.generation_rate_windows
  where organization_id=p_organization_id;

  update public.workspace_retention
  set status='purged',
      purged_at=now(),
      updated_at=now()
  where organization_id=p_organization_id;

  update public.notification_outbox
  set status='canceled'
  where organization_id=p_organization_id
    and status='pending'
    and template_key in (
      'subscription_expired',
      'renewal_reminder_7d',
      'renewal_reminder_21d',
      'final_deletion_warning'
    );

  insert into public.notification_outbox(
    organization_id,user_id,template_key,scheduled_for,payload,dedupe_key
  )
  select
    p_organization_id,
    m.user_id,
    'content_deleted_after_nonpayment',
    now(),
    jsonb_build_object('purged_at',now()),
    p_organization_id::text||':'||m.user_id::text||':content_deleted_after_nonpayment'
  from public.organization_members m
  where m.organization_id=p_organization_id
    and m.role='owner'
  on conflict(dedupe_key) do nothing;

  insert into public.platform_audit_events(
    organization_id,actor_user_id,event_type,entity_type,entity_id,metadata
  )
  values(
    p_organization_id,
    null,
    'retention.content_purged',
    'organization',
    p_organization_id,
    jsonb_build_object(
      'studio_projects',v_studio_projects,
      'legacy_content_projects',v_legacy_projects,
      'generation_runs',v_generation_runs,
      'generation_stages',v_generation_stages,
      'content_jobs',v_jobs,
      'content_series',v_series,
      'content_safety_reviews',v_safety_reviews,
      'content_preferences',v_preferences,
      'media_assets',v_media
    )
  );

  return jsonb_build_object(
    'studio_projects',v_studio_projects,
    'legacy_content_projects',v_legacy_projects,
    'generation_runs',v_generation_runs,
    'generation_stages',v_generation_stages,
    'content_jobs',v_jobs,
    'content_series',v_series,
    'content_safety_reviews',v_safety_reviews,
    'content_preferences',v_preferences,
    'media_asset_rows',v_media
  );
end;
$$;

revoke all on function public.purge_workspace_database_content(uuid)
from public,anon,authenticated;
grant execute on function public.purge_workspace_database_content(uuid)
to service_role;
