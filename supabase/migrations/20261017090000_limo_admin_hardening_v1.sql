-- LIMO AI Studio — platform admin hardening v1
-- Status: PENDING OWNER APPROVAL for production. Additive. Depends on 20261016150000 (is_platform_admin_mfa).
--
-- 1. feature_flags: readable by signed-in users, changed only by MFA platform admins (audited).
-- 2. admin_list_workspaces(p_search): workspace overview (owner email, members, plan, usage, projects, pending payments),
--    newest 500, searchable by workspace name, owner email or id so every workspace can be found.
-- 3. admin_set_subscription(): audited manual subscription changes with a mandatory reason.
-- 4. provider registry read access for MFA admins (enabling providers stays an owner decision).

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  enabled boolean not null default false,
  description text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select to authenticated using (true);

insert into public.feature_flags(key, enabled, description) values
  ('paid_generation', false, 'Real (paid) AI generation providers. Owner approval required.'),
  ('facebook_live_publishing', false, 'Real Facebook Graph API publishing. Owner approval and Meta review required.'),
  ('auto_publishing', false, 'Customer-authorised automated publishing (simulated until live publishing is approved).'),
  ('custom_characters', true, 'Workspace-private reusable characters.')
on conflict (key) do nothing;

create or replace function public.admin_set_feature_flag(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized: platform admin with two-factor authentication required'; end if;
  update public.feature_flags set enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown feature flag'; end if;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'feature_flag.updated', 'feature_flag', null, jsonb_build_object('key', p_key, 'enabled', p_enabled));
end;
$function$;

drop function if exists public.admin_list_workspaces();
create or replace function public.admin_list_workspaces(p_search text default null)
returns table (
  id uuid, name text, created_at timestamptz, owner_email text, members integer,
  plan_code text, subscription_status text, renews_at timestamptz,
  video_slots_used integer, video_slots_total integer, projects integer, pending_payments integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  -- LIKE pattern with the user's text escaped (% and _ are literal).
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized: platform admin with two-factor authentication required'; end if;
  if v_q is not null and char_length(v_q) > 200 then raise exception 'Search text is too long'; end if;
  return query
    select o.id, o.name, o.created_at,
      (select u.email::text from public.organization_members m join auth.users u on u.id = m.user_id
        where m.organization_id = o.id and m.role = 'owner' order by m.created_at limit 1),
      (select count(*)::integer from public.organization_members m where m.organization_id = o.id),
      s.plan_code, s.status, s.renews_at,
      b.used_video_slots, (b.base_video_slots + b.extra_video_slots),
      (select count(*)::integer from public.studio_projects p where p.organization_id = o.id),
      (select count(*)::integer from public.payment_submissions ps where ps.organization_id = o.id and ps.status = 'pending')
    from public.organizations o
    left join public.organization_subscriptions s on s.organization_id = o.id
    left join public.usage_balances b on b.organization_id = o.id
    where v_q is null
       or o.name ilike v_like
       or o.id::text ilike v_like
       or exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
                  where m.organization_id = o.id and u.email ilike v_like)
    order by o.created_at desc
    limit 500;
end;
$function$;

create or replace function public.admin_set_subscription(
  p_organization_id uuid, p_plan_code text, p_status text, p_days integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan public.plan_definitions%rowtype;
  v_now timestamptz := now();
  v_before jsonb;
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized: platform admin with two-factor authentication required'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason of at least 5 characters is required'; end if;
  if p_status not in ('active', 'past_due', 'canceled') then raise exception 'Invalid subscription status'; end if;
  if p_days is not null and (p_days < 1 or p_days > 366) then raise exception 'Days must be between 1 and 366'; end if;
  select * into v_plan from public.plan_definitions where code = p_plan_code and active = true;
  if not found then raise exception 'Unknown plan'; end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then raise exception 'Workspace not found'; end if;

  select to_jsonb(s) into v_before from public.organization_subscriptions s where organization_id = p_organization_id;

  insert into public.organization_subscriptions(organization_id, plan_code, status, started_at, renews_at, updated_at)
  values (p_organization_id, v_plan.code, p_status, v_now, v_now + make_interval(days => coalesce(p_days, 30)), v_now)
  on conflict (organization_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    renews_at = case when p_days is null then public.organization_subscriptions.renews_at else excluded.renews_at end,
    updated_at = v_now;

  if p_status = 'active' then
    insert into public.usage_balances(
      organization_id, cycle_start, cycle_end,
      base_video_slots, extra_video_slots, used_video_slots,
      base_posts, extra_posts, used_posts,
      base_images, extra_images, used_images,
      base_facebook_pages, extra_facebook_pages, used_facebook_pages, updated_at)
    values (p_organization_id, v_now, v_now + make_interval(days => coalesce(p_days, 30)),
      v_plan.video_slots, 0, 0, v_plan.posts, 0, 0, v_plan.ai_images, 0, 0, v_plan.facebook_pages, 0, 0, v_now)
    on conflict (organization_id) do update set
      base_video_slots = excluded.base_video_slots,
      base_posts = excluded.base_posts,
      base_images = excluded.base_images,
      base_facebook_pages = excluded.base_facebook_pages,
      cycle_end = greatest(public.usage_balances.cycle_end, excluded.cycle_end),
      updated_at = v_now;
  end if;

  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'subscription.admin_set', 'organization', p_organization_id,
          jsonb_build_object('plan', v_plan.code, 'status', p_status, 'days', p_days, 'reason', left(btrim(p_reason), 500), 'before', v_before));
end;
$function$;

drop policy if exists provider_registry_admin_read on public.ai_provider_registry;
create policy provider_registry_admin_read on public.ai_provider_registry for select to authenticated using (public.is_platform_admin_mfa());

revoke all on function public.admin_set_feature_flag(text, boolean) from public, anon;
revoke all on function public.admin_list_workspaces(text) from public, anon;
revoke all on function public.admin_set_subscription(uuid, text, text, integer, text) from public, anon;
grant execute on function public.admin_set_feature_flag(text, boolean) to authenticated;
grant execute on function public.admin_list_workspaces(text) to authenticated;
grant execute on function public.admin_set_subscription(uuid, text, text, integer, text) to authenticated;

-- Least privilege (Milestone 9 audit): signed-in users read flags; changes go through admin_set_feature_flag.
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;
grant all on public.feature_flags to service_role;
