-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

create or replace function public.approve_payment_submission(
  p_payment_id uuid,
  p_reviewer_id uuid default null,
  p_review_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payment_submissions%rowtype;
  v_plan public.plan_definitions%rowtype;
  v_addon public.addon_definitions%rowtype;
  v_now timestamptz := now();
begin
  select * into v_payment from public.payment_submissions where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.status <> 'pending' then raise exception 'Payment already reviewed'; end if;

  if v_payment.purchase_type = 'subscription' then
    select * into v_plan from public.plan_definitions where code = v_payment.item_code and active = true;
    if not found then raise exception 'Unknown plan'; end if;
    if v_payment.method='redotpay' then
      if v_payment.amount_usdt is null or v_payment.amount_usdt < v_plan.redotpay_usdt then raise exception 'Payment amount below plan price'; end if;
    else
      if v_payment.amount_dzd is null or v_payment.amount_dzd < v_plan.monthly_dzd then raise exception 'Payment amount below plan price'; end if;
    end if;

    insert into public.organization_subscriptions(organization_id,plan_code,status,started_at,renews_at,source_payment_id,updated_at)
    values(v_payment.organization_id,v_plan.code,'active',v_now,v_now + interval '30 days',v_payment.id,v_now)
    on conflict (organization_id) do update set
      plan_code=excluded.plan_code,status='active',started_at=excluded.started_at,renews_at=excluded.renews_at,
      source_payment_id=excluded.source_payment_id,updated_at=v_now;

    insert into public.usage_balances(
      organization_id,cycle_start,cycle_end,
      base_video_slots,extra_video_slots,used_video_slots,
      base_posts,extra_posts,used_posts,
      base_images,extra_images,used_images,
      base_facebook_pages,extra_facebook_pages,used_facebook_pages,updated_at)
    values(v_payment.organization_id,v_now,v_now + interval '30 days',
      v_plan.video_slots,0,0,v_plan.posts,0,0,v_plan.ai_images,0,0,v_plan.facebook_pages,0,0,v_now)
    on conflict (organization_id) do update set
      cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,
      base_video_slots=excluded.base_video_slots,extra_video_slots=0,used_video_slots=0,
      base_posts=excluded.base_posts,extra_posts=0,used_posts=0,
      base_images=excluded.base_images,extra_images=0,used_images=0,
      base_facebook_pages=excluded.base_facebook_pages,extra_facebook_pages=0,
      used_facebook_pages=least(public.usage_balances.used_facebook_pages,excluded.base_facebook_pages),
      updated_at=v_now;

  elsif v_payment.purchase_type = 'addon' then
    select * into v_addon from public.addon_definitions where code = v_payment.item_code and active = true;
    if not found then raise exception 'Unknown add-on'; end if;
    if v_payment.method='redotpay' then
      if v_payment.amount_usdt is null or v_payment.amount_usdt < v_addon.price_usdt then raise exception 'Payment amount below add-on price'; end if;
    else
      if v_payment.amount_dzd is null or v_payment.amount_dzd < v_addon.price_dzd then raise exception 'Payment amount below add-on price'; end if;
    end if;

    perform 1 from public.usage_balances where organization_id=v_payment.organization_id and cycle_end > v_now for update;
    if not found then raise exception 'No active billing cycle'; end if;

    if v_addon.resource='video' then
      update public.usage_balances set extra_video_slots=extra_video_slots+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='post' then
      update public.usage_balances set extra_posts=extra_posts+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='image' then
      update public.usage_balances set extra_images=extra_images+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='facebook_page' then
      update public.usage_balances set extra_facebook_pages=extra_facebook_pages+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    end if;

    insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
    values(v_payment.organization_id,v_addon.resource,v_addon.units,'addon_purchase','payment',v_payment.id,p_reviewer_id);
  else
    raise exception 'Unsupported purchase type';
  end if;

  update public.payment_submissions
  set status='approved',reviewed_by=p_reviewer_id,reviewed_at=v_now,review_note=left(coalesce(p_review_note,''),1000),updated_at=v_now
  where id=v_payment.id;

  return 'approved';
end;
$$;
revoke all on function public.approve_payment_submission(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.approve_payment_submission(uuid,uuid,text) to service_role;

create or replace function public.enqueue_content_job(
  p_organization_id uuid,
  p_idempotency_key text,
  p_resource text,
  p_units integer,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_usage public.usage_balances%rowtype;
  v_job_id uuid;
  v_remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key)='' or char_length(p_idempotency_key)>160 then raise exception 'Invalid idempotency key'; end if;
  if p_resource not in ('video','post','image') then raise exception 'Unsupported resource'; end if;
  if p_units < 1 or p_units > 10 then raise exception 'Invalid units'; end if;

  select id into v_existing from public.content_jobs
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  perform 1 from public.organization_subscriptions
  where organization_id=p_organization_id and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  select * into v_usage from public.usage_balances
  where organization_id=p_organization_id for update;
  if not found or v_usage.cycle_end<=now() then raise exception 'Billing cycle unavailable'; end if;

  if p_resource='video' then
    v_remaining := (v_usage.base_video_slots + v_usage.extra_video_slots) - v_usage.used_video_slots;
    if v_remaining < p_units then raise exception 'Video slot limit reached'; end if;
    update public.usage_balances
      set used_video_slots=used_video_slots+p_units,updated_at=now()
      where organization_id=p_organization_id;
  elsif p_resource='post' then
    v_remaining := (v_usage.base_posts + v_usage.extra_posts) - v_usage.used_posts;
    if v_remaining < p_units then raise exception 'Post limit reached'; end if;
    update public.usage_balances
      set used_posts=used_posts+p_units,updated_at=now()
      where organization_id=p_organization_id;
  else
    v_remaining := (v_usage.base_images + v_usage.extra_images) - v_usage.used_images;
    if v_remaining < p_units then raise exception 'Image limit reached'; end if;
    update public.usage_balances
      set used_images=used_images+p_units,updated_at=now()
      where organization_id=p_organization_id;
  end if;

  insert into public.content_jobs(organization_id,requested_by,idempotency_key,resource,units,job_type,payload)
  values(p_organization_id,auth.uid(),p_idempotency_key,p_resource,p_units,left(p_job_type,100),coalesce(p_payload,'{}'::jsonb))
  returning id into v_job_id;

  insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
  values(p_organization_id,p_resource,-p_units,'job_reserved','content_job',v_job_id,auth.uid());

  return v_job_id;
exception when unique_violation then
  select id into v_existing from public.content_jobs
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  raise;
end;
$$;
revoke all on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) from public, anon;
grant execute on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) to authenticated, service_role;

create or replace function public.claim_content_jobs(p_worker_id text, p_limit integer default 5)
returns setof public.content_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
  if p_limit < 1 or p_limit > 25 then raise exception 'Invalid claim limit'; end if;

  return query
  with picked as (
    select j.id
    from public.content_jobs j
    where j.status='queued' and j.available_at<=now()
    order by j.created_at
    for update skip locked
    limit p_limit
  )
  update public.content_jobs j
  set status='processing',
      locked_at=now(),
      locked_by=left(p_worker_id,120),
      attempt_count=j.attempt_count+1,
      updated_at=now()
  from picked
  where j.id=picked.id
  returning j.*;
end;
$$;
revoke all on function public.claim_content_jobs(text,integer) from public, anon, authenticated;
grant execute on function public.claim_content_jobs(text,integer) to service_role;

create or replace function public.complete_content_job(
  p_job_id uuid,
  p_provider text,
  p_provider_job_id text,
  p_provider_cost_cents integer default 0
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider_cost_cents < 0 then raise exception 'Invalid provider cost'; end if;

  update public.content_jobs
  set status='completed',
      provider=left(p_provider,80),
      provider_job_id=left(p_provider_job_id,200),
      provider_cost_cents=p_provider_cost_cents,
      completed_at=now(),
      updated_at=now()
  where id=p_job_id and status='processing';

  if not found then raise exception 'Job not processing'; end if;
  return 'completed';
end;
$$;
revoke all on function public.complete_content_job(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.complete_content_job(uuid,text,text,integer) to service_role;

create or replace function public.fail_content_job(
  p_job_id uuid,
  p_error_code text,
  p_provider_cost_cents integer default 0,
  p_refund_usage boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.content_jobs%rowtype;
begin
  if p_provider_cost_cents < 0 then raise exception 'Invalid provider cost'; end if;

  select * into v_job from public.content_jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status not in ('queued','processing') then raise exception 'Job already settled'; end if;
  if p_refund_usage and p_provider_cost_cents > 0 then raise exception 'Cannot refund usage after provider cost'; end if;

  update public.content_jobs
  set status='failed',
      error_code=left(coalesce(p_error_code,'provider_failure'),120),
      provider_cost_cents=p_provider_cost_cents,
      updated_at=now()
  where id=p_job_id;

  if p_refund_usage then
    perform 1 from public.usage_balances where organization_id=v_job.organization_id for update;
    if v_job.resource='video' then
      update public.usage_balances
      set used_video_slots=greatest(0,used_video_slots-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    elsif v_job.resource='post' then
      update public.usage_balances
      set used_posts=greatest(0,used_posts-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    else
      update public.usage_balances
      set used_images=greatest(0,used_images-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    end if;

    insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
    values(v_job.organization_id,v_job.resource,v_job.units,'job_refund','content_job',v_job.id,null);
  end if;

  return 'failed';
end;
$$;
revoke all on function public.fail_content_job(uuid,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.fail_content_job(uuid,text,integer,boolean) to service_role;
