-- LIMO Milestone 8: Facebook composer, approval, scheduling and safe automation.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Depends on 20261017180000 (social_posts, image projects), 20261017200000 (render_jobs),
-- 20261017090000 (feature_flags: facebook_live_publishing / auto_publishing) and the production
-- social foundation (social_connections, facebook_pages, vault-backed token functions).
--
-- Reuses: social_posts (extended), social_connections + facebook_pages (extended; tokens stay in Vault,
-- readable by the service role only), usage_balances.used_posts (one post per scheduled publication,
-- refunded when it does not happen), platform_audit_events (every workflow step).
-- New: social_post_revisions, publish_jobs (durable queue, one live job per post), publishing_controls
-- (workspace emergency pause), automation_policies + automation_policy_versions (versioned rules,
-- explicit authorisation), mock_facebook_publications (the simulated "Facebook" used by the mock
-- adapter; idempotent by key) and social_webhook_events.
-- Nothing here talks to Facebook. Live publishing stays behind the locked facebook_live_publishing flag.

-- 1. Posts: full workflow --------------------------------------------------------------------------------
alter table public.social_posts drop constraint if exists social_posts_status_check;
alter table public.social_posts
  add column if not exists headline text not null default '' check (char_length(headline) <= 200),
  add column if not exists cta text not null default '' check (char_length(cta) <= 120),
  add column if not exists language_code text not null default 'en' check (language_code in ('en', 'fr', 'ar', 'de')),
  add column if not exists tone text not null default 'friendly' check (char_length(tone) <= 40),
  add column if not exists media_kind text not null default 'image' check (media_kind in ('image', 'video')),
  add column if not exists render_job_id uuid references public.render_jobs(id) on delete set null,
  add column if not exists source_project_id uuid references public.studio_projects(id) on delete set null,
  add column if not exists origin text not null default 'manual' check (origin in ('manual', 'ai', 'automation')),
  add column if not exists automation_policy_id uuid,
  add column if not exists automation_policy_version integer,
  add column if not exists page_id uuid references public.facebook_pages(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists timezone text,
  add column if not exists published_at timestamptz,
  add column if not exists external_post_id text,
  add column if not exists simulated boolean not null default false,
  add column if not exists last_error text,
  add column if not exists review_note text,
  add column if not exists revision_number integer not null default 0,
  add column if not exists approved_fingerprint text,
  add column if not exists quota_charged boolean not null default false;
alter table public.social_posts add constraint social_posts_status_check
  check (status in ('draft', 'awaiting_review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));
create index if not exists social_posts_schedule_idx on public.social_posts(organization_id, scheduled_at) where scheduled_at is not null;

create table if not exists public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  revision_number integer not null,
  source text not null check (source in ('created', 'manual', 'autosave', 'ai_suggestion', 'restore', 'approval', 'automation')),
  label text,
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, revision_number)
);

-- 2. Connections and Pages (existing tables, extended) ----------------------------------------------------
alter table public.social_connections
  add column if not exists is_mock boolean not null default false,
  add column if not exists scopes text[] not null default '{}',
  add column if not exists last_error text,
  add column if not exists disconnected_at timestamptz;
alter table public.facebook_pages
  add column if not exists is_mock boolean not null default false,
  add column if not exists status text not null default 'active',
  add column if not exists max_posts_per_hour integer not null default 6;
alter table public.facebook_pages drop constraint if exists facebook_pages_status_check;
alter table public.facebook_pages add constraint facebook_pages_status_check check (status in ('active', 'disconnected'));
alter table public.facebook_pages drop constraint if exists facebook_pages_rate_check;
alter table public.facebook_pages add constraint facebook_pages_rate_check check (max_posts_per_hour between 1 and 25);

-- 3. Publishing queue ---------------------------------------------------------------------------------
create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  page_id uuid references public.facebook_pages(id) on delete set null,
  adapter text not null check (adapter in ('mock', 'facebook')),
  idempotency_key text not null unique,
  payload jsonb not null,
  run_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 4 check (max_attempts between 1 and 6),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  error_detail text,
  external_post_id text,
  simulated boolean not null default true,
  -- Test-only failure injection for the MOCK adapter. Never writable by customers.
  simulate jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
-- At most one live (or successful) publication per post: duplicates are impossible at the database level.
create unique index if not exists publish_jobs_one_live_per_post on public.publish_jobs(post_id) where status in ('queued', 'processing', 'succeeded');
create index if not exists publish_jobs_queue_idx on public.publish_jobs(status, run_at) where status in ('queued', 'processing');

create table if not exists public.publishing_controls (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  paused boolean not null default false,
  reason text,
  paused_by uuid,
  paused_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 4. Controlled automation ------------------------------------------------------------------------------
create table if not exists public.automation_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'revoked')),
  version integer not null default 1,
  rules jsonb not null check (jsonb_typeof(rules) = 'object' and pg_column_size(rules) < 32768),
  authorized_version integer,
  authorized_by uuid,
  authorized_at timestamptz,
  paused_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.automation_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.automation_policies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  rules jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (policy_id, version)
);
alter table public.social_posts drop constraint if exists social_posts_policy_fkey;
alter table public.social_posts add constraint social_posts_policy_fkey foreign key (automation_policy_id) references public.automation_policies(id) on delete set null;

-- 5. Simulated Facebook and webhooks ------------------------------------------------------------------
create table if not exists public.mock_facebook_publications (
  idempotency_key text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  page_id uuid,
  external_post_id text not null,
  message text not null,
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.social_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'facebook',
  object text,
  signature_valid boolean not null,
  payload jsonb not null,
  result text,
  received_at timestamptz not null default now()
);

alter table public.social_post_revisions enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.publishing_controls enable row level security;
alter table public.automation_policies enable row level security;
alter table public.automation_policy_versions enable row level security;
alter table public.mock_facebook_publications enable row level security;
alter table public.social_webhook_events enable row level security;
drop policy if exists social_post_revisions_read on public.social_post_revisions;
create policy social_post_revisions_read on public.social_post_revisions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists publish_jobs_read on public.publish_jobs;
create policy publish_jobs_read on public.publish_jobs for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists publishing_controls_read on public.publishing_controls;
create policy publishing_controls_read on public.publishing_controls for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists automation_policies_read on public.automation_policies;
create policy automation_policies_read on public.automation_policies for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists automation_policy_versions_read on public.automation_policy_versions;
create policy automation_policy_versions_read on public.automation_policy_versions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists mock_facebook_publications_read on public.mock_facebook_publications;
create policy mock_facebook_publications_read on public.mock_facebook_publications for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.social_post_revisions, public.publish_jobs, public.publishing_controls, public.automation_policies,
  public.automation_policy_versions, public.mock_facebook_publications, public.social_webhook_events from public, anon, authenticated;
grant select on public.social_post_revisions, public.publish_jobs, public.publishing_controls, public.automation_policies,
  public.automation_policy_versions, public.mock_facebook_publications to authenticated;
grant all on public.social_post_revisions, public.publish_jobs, public.publishing_controls, public.automation_policies,
  public.automation_policy_versions, public.mock_facebook_publications, public.social_webhook_events to service_role;
-- Customers see the test-only failure injection column as nothing more than data; they cannot write it.
revoke select on public.publish_jobs from authenticated;
grant select (id, organization_id, post_id, page_id, adapter, run_at, status, attempt_count, max_attempts, error_code, error_detail, external_post_id, simulated, created_at, updated_at, completed_at) on public.publish_jobs to authenticated;

-- 6. Helpers ------------------------------------------------------------------------------------------
create or replace function public.limo_social_audit(p_org uuid, p_event text, p_entity_type text, p_entity_id uuid, p_meta jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), p_event, p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

/** "[Price]"-style placeholders anywhere in the post text block approval. */
create or replace function public.limo_post_has_placeholders(p public.social_posts)
returns boolean language sql immutable set search_path = '' as $$
  select (coalesce(p.caption, '') || ' ' || coalesce(p.headline, '') || ' ' || coalesce(p.cta, '')) ~'\[[^]\n]{1,80}\]'
$$;

create or replace function public.limo_post_fingerprint(p public.social_posts)
returns text language sql immutable set search_path = '' as $$
  select md5(concat_ws('|', p.caption, p.headline, p.cta, array_to_string(p.hashtags, ','), p.media_kind, p.media_asset_id::text, p.render_job_id::text, p.image_project_id::text))
$$;

create or replace function public.limo_post_snapshot(p public.social_posts)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('title', p.title, 'caption', p.caption, 'headline', p.headline, 'cta', p.cta, 'hashtags', to_jsonb(p.hashtags),
    'language_code', p.language_code, 'tone', p.tone, 'media_kind', p.media_kind, 'image_project_id', p.image_project_id,
    'media_asset_id', p.media_asset_id, 'render_job_id', p.render_job_id)
$$;

create or replace function public.limo_record_post_revision(p_post_id uuid, p_source text, p_label text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_p public.social_posts%rowtype;
  v_last public.social_post_revisions%rowtype;
begin
  select * into v_p from public.social_posts where id = p_post_id;
  select * into v_last from public.social_post_revisions where post_id = p_post_id order by revision_number desc limit 1;
  -- Consecutive autosaves by the same user within 10 minutes share one revision.
  if p_source = 'autosave' and v_last.id is not null and v_last.source = 'autosave' and v_last.created_by is not distinct from auth.uid() and v_last.updated_at > now() - interval '10 minutes' then
    update public.social_post_revisions set snapshot = public.limo_post_snapshot(v_p), updated_at = now() where id = v_last.id;
    return v_last.revision_number;
  end if;
  insert into public.social_post_revisions(organization_id, post_id, revision_number, source, label, snapshot, created_by)
  values (v_p.organization_id, p_post_id, coalesce(v_last.revision_number, 0) + 1, p_source, left(p_label, 200), public.limo_post_snapshot(v_p), auth.uid());
  update public.social_posts set revision_number = coalesce(v_last.revision_number, 0) + 1 where id = p_post_id;
  return coalesce(v_last.revision_number, 0) + 1;
end;
$$;

/** Media check shared by approval, scheduling and automation. Returns null when fine, else the reason. */
create or replace function public.limo_post_media_problem(p public.social_posts)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
begin
  if p.media_kind = 'video' then
    if p.render_job_id is null then return 'Choose a video before approving'; end if;
    select * into v_job from public.render_jobs where id = p.render_job_id and organization_id = p.organization_id;
    if not found or v_job.status <> 'completed' or v_job.output_media_asset_id is null then return 'The video export is not finished'; end if;
    if (select approved_revision_id from public.studio_projects where id = v_job.project_id and script_status = 'approved') is distinct from v_job.script_revision_id then
      return 'The video was made from a script version that is no longer approved';
    end if;
    return null;
  end if;
  if p.media_asset_id is null then return 'Choose an image before approving'; end if;
  if p.image_project_id is not null and (select status from public.image_projects where id = p.image_project_id) is distinct from 'approved' then
    return 'Approve the image before approving the post';
  end if;
  return null;
end;
$$;

create or replace function public.limo_post_charge(p_post_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.social_posts%rowtype;
  v_u public.usage_balances%rowtype;
begin
  select * into v_p from public.social_posts where id = p_post_id for update;
  if v_p.quota_charged then return; end if;
  perform 1 from public.organization_subscriptions where organization_id = v_p.organization_id and status = 'active' and renews_at > now();
  if not found then raise exception 'Active subscription required'; end if;
  select * into v_u from public.usage_balances where organization_id = v_p.organization_id for update;
  if not found or v_u.cycle_end <= now() then raise exception 'Billing cycle unavailable'; end if;
  if (v_u.base_posts + v_u.extra_posts) - v_u.used_posts < 1 then raise exception 'Post limit reached'; end if;
  update public.usage_balances set used_posts = used_posts + 1, updated_at = now() where organization_id = v_p.organization_id;
  insert into public.usage_ledger(organization_id, resource, delta, reason, reference_type, reference_id, created_by)
  values (v_p.organization_id, 'post', -1, 'post_reserved', 'social_post', p_post_id, auth.uid());
  update public.social_posts set quota_charged = true where id = p_post_id;
end;
$$;

create or replace function public.limo_post_refund(p_post_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.social_posts%rowtype;
begin
  select * into v_p from public.social_posts where id = p_post_id for update;
  if not v_p.quota_charged then return; end if;
  update public.usage_balances set used_posts = greatest(0, used_posts - 1), updated_at = now() where organization_id = v_p.organization_id;
  insert into public.usage_ledger(organization_id, resource, delta, reason, reference_type, reference_id, created_by)
  values (v_p.organization_id, 'post', 1, 'post_refund', 'social_post', p_post_id, auth.uid());
  update public.social_posts set quota_charged = false where id = p_post_id;
end;
$$;

/**
 * An approved or scheduled post whose content basis changed (image or video approval removed, page
 * disconnected) goes back to draft (or approved, for a page change); a queued publication is cancelled
 * and its post slot refunded. A publication already in progress is not interrupted.
 */
create or replace function public.limo_invalidate_post(p_post_id uuid, p_reason text, p_to text default 'draft')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.social_posts%rowtype;
begin
  select * into v_p from public.social_posts where id = p_post_id for update;
  if not found or v_p.status not in ('awaiting_review', 'approved', 'scheduled') then return; end if;
  update public.publish_jobs set status = 'cancelled', error_code = p_reason, updated_at = now() where post_id = p_post_id and status = 'queued';
  update public.social_posts set status = p_to, scheduled_at = case when p_to = 'draft' then null else scheduled_at end,
    last_error = p_reason, updated_at = clock_timestamp() where id = p_post_id;
  perform public.limo_post_refund(p_post_id);
  perform public.limo_social_audit(v_p.organization_id, 'post.invalidated', 'social_post', p_post_id, jsonb_build_object('reason', p_reason, 'from', v_p.status, 'to', p_to));
end;
$$;

-- 7. Customer functions: editing and review -----------------------------------------------------------
create or replace function public.save_social_post_v2(
  p_organization_id uuid, p_post_id uuid, p_base_updated_at timestamptz, p_title text, p_caption text, p_headline text,
  p_hashtags text[], p_cta text, p_language_code text, p_tone text, p_media_kind text, p_image_project_id uuid,
  p_media_asset_id uuid, p_render_job_id uuid, p_source_project_id uuid, p_origin text, p_revision_source text, p_revision_label text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
  v_job public.render_jobs%rowtype;
  v_media uuid := p_media_asset_id;
  v_rev integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if coalesce(p_media_kind, 'image') not in ('image', 'video') then raise exception 'Invalid media'; end if;
  if coalesce(p_language_code, 'en') not in ('en', 'fr', 'ar', 'de') then raise exception 'Invalid language'; end if;
  if p_image_project_id is not null and not exists (select 1 from public.image_projects where id = p_image_project_id and organization_id = p_organization_id) then raise exception 'Image project not found'; end if;
  if p_media_kind = 'video' then
    if p_render_job_id is not null then
      select * into v_job from public.render_jobs where id = p_render_job_id and organization_id = p_organization_id;
      if not found or v_job.status <> 'completed' then raise exception 'Video file outside this workspace'; end if;
      v_media := v_job.output_media_asset_id;
    else
      v_media := null;
    end if;
  elsif v_media is not null and not exists (select 1 from public.media_assets where id = v_media and organization_id = p_organization_id and media_type = 'image') then
    raise exception 'Image file outside this workspace';
  end if;
  if p_source_project_id is not null and not exists (select 1 from public.studio_projects where id = p_source_project_id and organization_id = p_organization_id) then raise exception 'Project not found'; end if;
  if cardinality(coalesce(p_hashtags, '{}')) > 30 or exists (select 1 from unnest(coalesce(p_hashtags, '{}')) t where t !~ '^[[:alnum:]_]{1,60}$') then raise exception 'Invalid hashtags'; end if;
  if char_length(coalesce(p_caption, '')) > 5000 then raise exception 'Caption too long'; end if;

  if p_post_id is null then
    insert into public.social_posts(organization_id, title, caption, headline, hashtags, cta, language_code, tone, media_kind, image_project_id,
      media_asset_id, render_job_id, source_project_id, origin, created_by)
    values (p_organization_id, left(btrim(p_title), 200), coalesce(p_caption, ''), left(coalesce(p_headline, ''), 200), coalesce(p_hashtags, '{}'),
      left(coalesce(p_cta, ''), 120), coalesce(p_language_code, 'en'), left(coalesce(p_tone, 'friendly'), 40), coalesce(p_media_kind, 'image'),
      case when p_media_kind = 'video' then null else p_image_project_id end, v_media, case when p_media_kind = 'video' then p_render_job_id else null end,
      p_source_project_id, case when p_origin in ('manual', 'ai') then p_origin else 'manual' end, auth.uid())
    returning * into v_post;
    v_rev := public.limo_record_post_revision(v_post.id, 'created', p_revision_label);
  else
    select * into v_post from public.social_posts where id = p_post_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Post not found'; end if;
    if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
      raise exception 'Post changed since it was loaded' using errcode = 'P0001';
    end if;
    if v_post.status in ('approved', 'scheduled', 'publishing', 'published') then raise exception 'Post is approved; remove approval before editing'; end if;
    update public.social_posts set title = left(btrim(p_title), 200), caption = coalesce(p_caption, ''), headline = left(coalesce(p_headline, ''), 200),
      hashtags = coalesce(p_hashtags, '{}'), cta = left(coalesce(p_cta, ''), 120), language_code = coalesce(p_language_code, 'en'),
      tone = left(coalesce(p_tone, 'friendly'), 40), media_kind = coalesce(p_media_kind, 'image'),
      image_project_id = case when p_media_kind = 'video' then null else p_image_project_id end, media_asset_id = v_media,
      render_job_id = case when p_media_kind = 'video' then p_render_job_id else null end, source_project_id = p_source_project_id,
      -- Any edit of a rejected, failed or cancelled post makes it a draft again.
      status = 'draft', last_error = case when v_post.status in ('failed', 'cancelled') then null else last_error end,
      updated_at = clock_timestamp()
    where id = p_post_id returning * into v_post;
    v_rev := public.limo_record_post_revision(v_post.id, case when p_revision_source in ('manual', 'autosave', 'ai_suggestion') then p_revision_source else 'manual' end, p_revision_label);
  end if;
  select * into v_post from public.social_posts where id = v_post.id;
  return jsonb_build_object('id', v_post.id, 'updated_at', v_post.updated_at, 'status', v_post.status, 'revision_number', v_rev);
end;
$$;

-- Milestone 6 editors keep working, now with the wider status list.
create or replace function public.save_social_post(
  p_organization_id uuid, p_post_id uuid, p_base_updated_at timestamptz, p_title text, p_caption text, p_hashtags text[],
  p_image_project_id uuid, p_media_asset_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
begin
  if p_post_id is not null then
    select * into v_post from public.social_posts where id = p_post_id and organization_id = p_organization_id;
  end if;
  return public.save_social_post_v2(p_organization_id, p_post_id, p_base_updated_at, p_title, p_caption, coalesce(v_post.headline, ''), p_hashtags,
    coalesce(v_post.cta, ''), coalesce(v_post.language_code, 'en'), coalesce(v_post.tone, 'friendly'), 'image', p_image_project_id, p_media_asset_id,
    null, v_post.source_project_id, coalesce(v_post.origin, 'manual'), 'manual', null);
end;
$$;

create or replace function public.submit_social_post_review(p_post_id uuid, p_base_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then raise exception 'Post changed since it was loaded'; end if;
  if v_post.status <> 'draft' then raise exception 'Only drafts can be sent for review'; end if;
  update public.social_posts set status = 'awaiting_review', review_note = null, updated_at = clock_timestamp() where id = p_post_id returning * into v_post;
  perform public.limo_social_audit(v_post.organization_id, 'post.review_requested', 'social_post', p_post_id, '{}'::jsonb);
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status);
end;
$$;

create or replace function public.approve_social_post(p_post_id uuid, p_base_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
  v_problem text;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Post changed since it was loaded' using errcode = 'P0001';
  end if;
  if v_post.status not in ('draft', 'awaiting_review') then raise exception 'Post is already approved'; end if;
  if char_length(btrim(v_post.caption)) = 0 then raise exception 'Write a caption before approving'; end if;
  if public.limo_post_has_placeholders(v_post) then raise exception 'Replace all [placeholders] before approving'; end if;
  v_problem := public.limo_post_media_problem(v_post);
  if v_problem is not null then raise exception '%', v_problem; end if;
  update public.social_posts set status = 'approved', approved_at = now(), approved_by = auth.uid(), review_note = null, last_error = null,
    approved_fingerprint = public.limo_post_fingerprint(v_post), updated_at = clock_timestamp()
  where id = p_post_id returning * into v_post;
  perform public.limo_record_post_revision(p_post_id, 'approval', null);
  perform public.limo_social_audit(v_post.organization_id, 'post.approved', 'social_post', p_post_id, jsonb_build_object('fingerprint', v_post.approved_fingerprint));
  select * into v_post from public.social_posts where id = p_post_id;
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status, 'revision_number', v_post.revision_number);
end;
$$;

create or replace function public.reject_social_post(p_post_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if v_post.status <> 'awaiting_review' then raise exception 'Only posts awaiting review can be rejected'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Explain what must change'; end if;
  update public.social_posts set status = 'draft', review_note = left(btrim(p_note), 1000), updated_at = clock_timestamp() where id = p_post_id returning * into v_post;
  perform public.limo_social_audit(v_post.organization_id, 'post.rejected', 'social_post', p_post_id, jsonb_build_object('note', left(btrim(p_note), 200)));
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status);
end;
$$;

-- Approval removal (Milestone 6 entry point): approved → draft. Scheduled posts must be unscheduled first.
create or replace function public.set_social_post_approval(p_post_id uuid, p_approve boolean, p_base_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
begin
  if p_approve then return public.approve_social_post(p_post_id, p_base_updated_at); end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Post changed since it was loaded' using errcode = 'P0001';
  end if;
  if v_post.status = 'scheduled' then raise exception 'Unschedule the post before removing its approval'; end if;
  if v_post.status <> 'approved' then raise exception 'Post is not approved'; end if;
  update public.social_posts set status = 'draft', updated_at = clock_timestamp() where id = p_post_id returning * into v_post;
  perform public.limo_social_audit(v_post.organization_id, 'post.approval_removed', 'social_post', p_post_id, '{}'::jsonb);
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status);
end;
$$;

create or replace function public.restore_social_post_revision(p_revision_id uuid, p_base_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rev public.social_post_revisions%rowtype;
  v_post public.social_posts%rowtype;
  s jsonb;
  v_media_kind text;
  v_job uuid;
begin
  select * into v_rev from public.social_post_revisions where id = p_revision_id;
  if not found or not public.can_edit_org(v_rev.organization_id) then raise exception 'Revision not found'; end if;
  select * into v_post from public.social_posts where id = v_rev.post_id;
  s := v_rev.snapshot;
  v_media_kind := coalesce(s ->> 'media_kind', 'image');
  v_job := nullif(s ->> 'render_job_id', '')::uuid;
  -- Restoring goes through the normal save (permissions, media ownership, approval lock, concurrency).
  perform public.save_social_post_v2(v_post.organization_id, v_post.id, p_base_updated_at, coalesce(s ->> 'title', v_post.title), coalesce(s ->> 'caption', ''),
    coalesce(s ->> 'headline', ''), array(select jsonb_array_elements_text(coalesce(s -> 'hashtags', '[]'::jsonb))), coalesce(s ->> 'cta', ''),
    coalesce(s ->> 'language_code', 'en'), coalesce(s ->> 'tone', 'friendly'), v_media_kind, nullif(s ->> 'image_project_id', '')::uuid,
    nullif(s ->> 'media_asset_id', '')::uuid, v_job, v_post.source_project_id, v_post.origin, 'manual', 'Restored revision ' || v_rev.revision_number);
  update public.social_post_revisions set source = 'restore' where post_id = v_post.id and revision_number = (select revision_number from public.social_posts where id = v_post.id);
  select * into v_post from public.social_posts where id = v_post.id;
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status, 'revision_number', v_post.revision_number);
end;
$$;

-- 8. Scheduling ----------------------------------------------------------------------------------------
/**
 * Schedules an APPROVED post on one of the workspace's active Pages. p_local_time + p_timezone (IANA
 * name) give the wall-clock time; null means "publish now". Facebook Pages are published through the
 * mock adapter until the locked facebook_live_publishing flag is opened (owner approval + Meta review).
 */
create or replace function public.schedule_social_post(p_post_id uuid, p_base_updated_at timestamptz, p_page_id uuid, p_local_time timestamp, p_timezone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
  v_page public.facebook_pages%rowtype;
  v_conn public.social_connections%rowtype;
  v_run timestamptz;
  v_job uuid;
  v_problem text;
  v_live boolean;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Post changed since it was loaded' using errcode = 'P0001';
  end if;
  if v_post.status = 'scheduled' then raise exception 'Post is already scheduled'; end if;
  if v_post.status <> 'approved' then raise exception 'Approve the post before scheduling'; end if;
  -- The content must still be exactly what was approved, with media that is still approved.
  if v_post.approved_fingerprint is distinct from public.limo_post_fingerprint(v_post) then raise exception 'Approve the post before scheduling'; end if;
  v_problem := public.limo_post_media_problem(v_post);
  if v_problem is not null then raise exception '%', v_problem; end if;
  select * into v_page from public.facebook_pages where id = p_page_id and organization_id = v_post.organization_id;
  if not found or v_page.status <> 'active' then raise exception 'Choose a connected Page of this workspace'; end if;
  select * into v_conn from public.social_connections where id = v_page.connection_id;
  if v_conn.status <> 'connected' or (v_conn.expires_at is not null and v_conn.expires_at <= now()) then raise exception 'Reconnect this Page before scheduling'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid time zone'; end if;
  v_run := case when p_local_time is null then now() else p_local_time at time zone p_timezone end;
  if v_run < now() - interval '1 minute' then raise exception 'Choose a time in the future'; end if;
  if v_run > now() + interval '120 days' then raise exception 'Schedule at most 120 days ahead'; end if;
  if coalesce((select paused from public.publishing_controls where organization_id = v_post.organization_id), false) then raise exception 'Publishing is paused for this workspace'; end if;
  v_live := not v_page.is_mock and coalesce((select enabled from public.feature_flags where key = 'facebook_live_publishing'), false);
  if not v_page.is_mock and not v_live then raise exception 'Live Facebook publishing is not enabled'; end if;

  perform public.limo_post_charge(p_post_id);
  insert into public.publish_jobs(organization_id, post_id, page_id, adapter, idempotency_key, payload, run_at, simulated, created_by)
  values (v_post.organization_id, p_post_id, v_page.id, case when v_page.is_mock then 'mock' else 'facebook' end,
    'post:' || p_post_id::text || ':' || v_post.approved_fingerprint,
    jsonb_build_object('message', concat_ws(E'\n\n', nullif(btrim(v_post.headline), ''), btrim(v_post.caption), nullif(btrim(v_post.cta), ''),
        nullif(array_to_string(array(select '#' || h from unnest(v_post.hashtags) h), ' '), '')),
      'media_kind', v_post.media_kind, 'media_asset_id', v_post.media_asset_id, 'page_external_id', v_page.page_id),
    v_run, v_page.is_mock, auth.uid())
  returning id into v_job;
  update public.social_posts set status = 'scheduled', page_id = v_page.id, scheduled_at = v_run, timezone = p_timezone, last_error = null,
    simulated = v_page.is_mock, updated_at = clock_timestamp()
  where id = p_post_id returning * into v_post;
  perform public.limo_social_audit(v_post.organization_id, 'post.scheduled', 'social_post', p_post_id,
    jsonb_build_object('run_at', v_run, 'timezone', p_timezone, 'page_id', v_page.id, 'simulated', v_page.is_mock, 'job_id', v_job));
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status, 'job_id', v_job, 'run_at', v_run, 'simulated', v_page.is_mock);
exception when unique_violation then
  raise exception 'Post is already scheduled';
end;
$$;

create or replace function public.unschedule_social_post(p_post_id uuid, p_cancel boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_post public.social_posts%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if exists (select 1 from public.publish_jobs where post_id = p_post_id and status = 'processing') then raise exception 'Publishing is already in progress'; end if;
  if p_cancel then
    if v_post.status not in ('draft', 'awaiting_review', 'approved', 'scheduled', 'failed') then raise exception 'This post can no longer be cancelled'; end if;
  elsif v_post.status <> 'scheduled' then raise exception 'Post is not scheduled';
  end if;
  update public.publish_jobs set status = 'cancelled', error_code = 'cancelled_by_user', updated_at = now() where post_id = p_post_id and status = 'queued';
  update public.social_posts set status = case when p_cancel then 'cancelled' else 'approved' end, scheduled_at = null, updated_at = clock_timestamp()
  where id = p_post_id returning * into v_post;
  perform public.limo_post_refund(p_post_id);
  perform public.limo_social_audit(v_post.organization_id, case when p_cancel then 'post.cancelled' else 'post.unscheduled' end, 'social_post', p_post_id, '{}'::jsonb);
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status);
end;
$$;

-- 9. Workspace controls, Pages, automation -------------------------------------------------------------
create or replace function public.set_publishing_paused(p_organization_id uuid, p_paused boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  insert into public.publishing_controls(organization_id, paused, reason, paused_by, paused_at, updated_at)
  values (p_organization_id, p_paused, left(p_reason, 300), auth.uid(), case when p_paused then now() end, now())
  on conflict (organization_id) do update set paused = excluded.paused, reason = excluded.reason, paused_by = excluded.paused_by,
    paused_at = excluded.paused_at, updated_at = now();
  if p_paused then
    update public.automation_policies set status = 'paused', paused_reason = 'workspace_paused', updated_at = now() where organization_id = p_organization_id and status = 'active';
  end if;
  perform public.limo_social_audit(p_organization_id, case when p_paused then 'publishing.paused' else 'publishing.resumed' end, 'organization', p_organization_id, jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('paused', p_paused);
end;
$$;

/** A SIMULATED Page for testing the full flow. Real Pages come from the Meta OAuth flow (not enabled). */
create or replace function public.add_mock_facebook_page(p_organization_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_conn uuid;
  v_page uuid;
  v_u public.usage_balances%rowtype;
begin
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Give the Page a name'; end if;
  select * into v_u from public.usage_balances where organization_id = p_organization_id;
  if not found then raise exception 'Billing cycle unavailable'; end if;
  if (select count(*) from public.facebook_pages where organization_id = p_organization_id and status = 'active') >= v_u.base_facebook_pages + v_u.extra_facebook_pages then
    raise exception 'Facebook page limit reached';
  end if;
  select id into v_conn from public.social_connections where organization_id = p_organization_id and provider = 'facebook' and is_mock and status = 'connected';
  if v_conn is null then
    insert into public.social_connections(organization_id, provider, external_user_id, token_secret_ref, status, connected_by, is_mock, scopes)
    values (p_organization_id, 'facebook', 'mock:' || gen_random_uuid()::text, null, 'connected', auth.uid(), true, array['pages_manage_posts (simulated)'])
    returning id into v_conn;
  end if;
  insert into public.facebook_pages(organization_id, connection_id, page_id, page_name, token_secret_ref, selected, is_mock, status)
  values (p_organization_id, v_conn, 'mock_' || replace(gen_random_uuid()::text, '-', ''), btrim(p_name), null, true, true, 'active')
  returning id into v_page;
  perform public.limo_social_audit(p_organization_id, 'facebook.page_connected', 'facebook_page', v_page, jsonb_build_object('simulated', true));
  return v_page;
end;
$$;

create or replace function public.disconnect_facebook_page(p_page_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_page public.facebook_pages%rowtype;
  v_post uuid;
begin
  select * into v_page from public.facebook_pages where id = p_page_id for update;
  if not found or not public.can_edit_org(v_page.organization_id) then raise exception 'Page not found'; end if;
  update public.facebook_pages set status = 'disconnected', selected = false, updated_at = now() where id = p_page_id;
  for v_post in select id from public.social_posts where page_id = p_page_id and status = 'scheduled' loop
    perform public.limo_invalidate_post(v_post, 'page_disconnected', 'approved');
  end loop;
  update public.automation_policies set status = 'paused', paused_reason = 'page_disconnected', updated_at = now()
  where organization_id = v_page.organization_id and status = 'active' and rules ->> 'page_id' = p_page_id::text;
  -- A connection without active Pages is revoked; its Vault secret reference is cleared (the worker deletes secrets).
  if not exists (select 1 from public.facebook_pages where connection_id = v_page.connection_id and status = 'active') then
    update public.social_connections set status = 'revoked', disconnected_at = now(), updated_at = now() where id = v_page.connection_id;
  end if;
  perform public.limo_social_audit(v_page.organization_id, 'facebook.page_disconnected', 'facebook_page', p_page_id, jsonb_build_object('simulated', v_page.is_mock));
  return jsonb_build_object('status', 'disconnected');
end;
$$;

/**
 * Saves automation rules as a NEW version. Any change de-authorises the policy: it must be authorised
 * again (explicitly, by a workspace owner/admin) before it can create or schedule anything.
 */
create or replace function public.save_automation_policy(p_organization_id uuid, p_policy_id uuid, p_name text, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.automation_policies%rowtype;
  v_page uuid := nullif(p_rules ->> 'page_id', '')::uuid;
begin
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if v_page is null or not exists (select 1 from public.facebook_pages where id = v_page and organization_id = p_organization_id and status = 'active') then
    raise exception 'Choose a connected Page of this workspace';
  end if;
  if coalesce((p_rules ->> 'max_posts_per_week')::integer, 0) not between 1 and 21 then raise exception 'Invalid posting frequency'; end if;
  if coalesce(p_rules ->> 'boundary', '') not in ('review_each', 'publish_within_policy') then raise exception 'Invalid approval boundary'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_rules ->> 'timezone') then raise exception 'Invalid time zone'; end if;
  if p_policy_id is null then
    insert into public.automation_policies(organization_id, name, rules, created_by) values (p_organization_id, left(btrim(p_name), 120), p_rules, auth.uid()) returning * into v_p;
  else
    select * into v_p from public.automation_policies where id = p_policy_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Policy not found'; end if;
    if v_p.status = 'revoked' then raise exception 'This policy was revoked'; end if;
    update public.automation_policies set name = left(btrim(p_name), 120), rules = p_rules, version = version + 1, status = 'draft',
      authorized_version = null, updated_at = now() where id = p_policy_id returning * into v_p;
  end if;
  insert into public.automation_policy_versions(policy_id, organization_id, version, rules, created_by) values (v_p.id, p_organization_id, v_p.version, p_rules, auth.uid());
  perform public.limo_social_audit(p_organization_id, 'automation.policy_saved', 'automation_policy', v_p.id, jsonb_build_object('version', v_p.version));
  return jsonb_build_object('id', v_p.id, 'version', v_p.version, 'status', v_p.status);
end;
$$;

create or replace function public.authorize_automation_policy(p_policy_id uuid, p_version integer, p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.automation_policies%rowtype;
begin
  select * into v_p from public.automation_policies where id = p_policy_id for update;
  if not found or not public.is_org_member(v_p.organization_id) then raise exception 'Policy not found'; end if;
  -- Authorising automation is an owner/admin decision, not an editor's.
  if not exists (select 1 from public.organization_members where organization_id = v_p.organization_id and user_id = auth.uid() and role in ('owner', 'admin')) then
    raise exception 'Not authorized';
  end if;
  if not coalesce((select enabled from public.feature_flags where key = 'auto_publishing'), false) then raise exception 'Automatic publishing is not available'; end if;
  if p_confirmed is not true then raise exception 'Confirm the automation rules'; end if;
  if p_version is distinct from v_p.version then raise exception 'The rules changed; review them again'; end if;
  if v_p.status = 'revoked' then raise exception 'This policy was revoked'; end if;
  if coalesce((select paused from public.publishing_controls where organization_id = v_p.organization_id), false) then raise exception 'Publishing is paused for this workspace'; end if;
  update public.automation_policies set status = 'active', authorized_version = v_p.version, authorized_by = auth.uid(), authorized_at = now(),
    paused_reason = null, updated_at = now() where id = p_policy_id returning * into v_p;
  perform public.limo_social_audit(v_p.organization_id, 'automation.authorized', 'automation_policy', p_policy_id, jsonb_build_object('version', v_p.version, 'rules', v_p.rules));
  return jsonb_build_object('id', v_p.id, 'status', v_p.status, 'version', v_p.version);
end;
$$;

create or replace function public.set_automation_policy_state(p_policy_id uuid, p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.automation_policies%rowtype;
  v_post uuid;
begin
  select * into v_p from public.automation_policies where id = p_policy_id for update;
  if not found or not public.can_edit_org(v_p.organization_id) then raise exception 'Policy not found'; end if;
  if p_state not in ('paused', 'revoked') then raise exception 'Invalid state'; end if;
  if v_p.status = 'revoked' then raise exception 'This policy was revoked'; end if;
  update public.automation_policies set status = p_state, paused_reason = case when p_state = 'paused' then 'paused_by_user' end, updated_at = now() where id = p_policy_id;
  -- Revoking also withdraws the publications it scheduled that have not started.
  if p_state = 'revoked' then
    for v_post in select id from public.social_posts where automation_policy_id = p_policy_id and status in ('approved', 'scheduled', 'awaiting_review') loop
      perform public.limo_invalidate_post(v_post, 'automation_revoked', 'draft');
    end loop;
  end if;
  perform public.limo_social_audit(v_p.organization_id, 'automation.' || p_state, 'automation_policy', p_policy_id, jsonb_build_object('version', v_p.version));
  return jsonb_build_object('id', p_policy_id, 'status', p_state);
end;
$$;

-- 10. Invalidation when approved media changes ----------------------------------------------------------
create or replace function public.remove_image_approval(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.image_projects%rowtype;
  v_post uuid;
begin
  select * into v_p from public.image_projects where id = p_project_id for update;
  if not found or not public.can_edit_org(v_p.organization_id) then raise exception 'Image project not found'; end if;
  update public.image_projects set status = 'draft', updated_at = clock_timestamp() where id = p_project_id returning * into v_p;
  -- Posts using this design must be approved again with the new design; queued publications are withdrawn.
  for v_post in select id from public.social_posts where image_project_id = p_project_id and status in ('awaiting_review', 'approved', 'scheduled') loop
    perform public.limo_invalidate_post(v_post, 'image_changed', 'draft');
  end loop;
  return jsonb_build_object('updated_at', v_p.updated_at, 'status', 'draft');
end;
$$;

create or replace function public.limo_video_posts_invalidate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_post uuid;
begin
  if old.script_status = 'approved' and (new.script_status is distinct from 'approved' or new.approved_revision_id is distinct from old.approved_revision_id) then
    for v_post in
      select p.id from public.social_posts p join public.render_jobs r on r.id = p.render_job_id
      where r.project_id = new.id and p.status in ('awaiting_review', 'approved', 'scheduled')
    loop
      perform public.limo_invalidate_post(v_post, 'video_changed', 'draft');
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_video_posts_invalidate on public.studio_projects;
create trigger trg_video_posts_invalidate after update of script_status, approved_revision_id on public.studio_projects
  for each row execute function public.limo_video_posts_invalidate();

-- 11. Worker functions (service role only) --------------------------------------------------------------
/**
 * Claims the next due publication. Skips paused workspaces and Pages over their hourly limit; takes over
 * jobs whose worker stopped heart-beating (the adapter's idempotency key prevents double publishing);
 * fails jobs whose Page connection expired or was revoked (reconnect required).
 */
create or replace function public.claim_publish_job(p_worker_id text, p_lease_seconds integer default 60)
returns setof public.publish_jobs language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
  v_conn public.social_connections%rowtype;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then raise exception 'Worker id required'; end if;
  for v_job in
    select j.* from public.publish_jobs j
    left join public.publishing_controls c on c.organization_id = j.organization_id
    left join public.facebook_pages pg on pg.id = j.page_id
    where ((j.status = 'queued' and j.run_at <= now())
        or (j.status = 'processing' and j.heartbeat_at < now() - make_interval(secs => p_lease_seconds)))
      and not coalesce(c.paused, false)
      and (select count(*) from public.publish_jobs d where d.page_id = j.page_id and d.status = 'succeeded' and d.completed_at > now() - interval '1 hour') < coalesce(pg.max_posts_per_hour, 6)
    order by j.run_at, j.created_at
    for update of j skip locked
    limit 1
  loop
    if v_job.status = 'processing' and v_job.attempt_count >= v_job.max_attempts then
      perform public.limo_fail_publish(v_job.id, 'worker_lost', 'The publisher stopped responding several times.');
      continue;
    end if;
    select c.* into v_conn from public.facebook_pages p join public.social_connections c on c.id = p.connection_id where p.id = v_job.page_id;
    if v_job.page_id is null or v_conn.id is null or v_conn.status <> 'connected' or (v_conn.expires_at is not null and v_conn.expires_at <= now())
       or (select status from public.facebook_pages where id = v_job.page_id) <> 'active' then
      if v_conn.id is not null and v_conn.status = 'connected' and v_conn.expires_at <= now() then
        update public.social_connections set status = 'expired', last_error = 'token_expired', updated_at = now() where id = v_conn.id;
      end if;
      perform public.limo_fail_publish(v_job.id, 'reconnect_required', 'The Facebook connection expired or was removed. Reconnect the Page and schedule again.');
      continue;
    end if;
    if v_job.adapter = 'facebook' and not coalesce((select enabled from public.feature_flags where key = 'facebook_live_publishing'), false) then
      perform public.limo_fail_publish(v_job.id, 'live_publishing_disabled', 'Live Facebook publishing is not enabled.');
      continue;
    end if;
    update public.publish_jobs set status = 'processing', locked_by = left(p_worker_id, 120), locked_at = now(), heartbeat_at = now(),
      attempt_count = attempt_count + 1, updated_at = now() where id = v_job.id returning * into v_job;
    update public.social_posts set status = 'publishing', updated_at = clock_timestamp() where id = v_job.post_id;
    return next v_job;
    return;
  end loop;
end;
$$;

create or replace function public.limo_fail_publish(p_job_id uuid, p_code text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
begin
  update public.publish_jobs set status = 'failed', error_code = left(p_code, 80), error_detail = left(p_detail, 500), locked_by = null, updated_at = now()
  where id = p_job_id returning * into v_job;
  update public.social_posts set status = 'failed', last_error = left(p_code, 80), updated_at = clock_timestamp() where id = v_job.post_id;
  perform public.limo_post_refund(v_job.post_id);
  perform public.limo_social_audit(v_job.organization_id, 'post.publish_failed', 'social_post', v_job.post_id, jsonb_build_object('code', p_code, 'job_id', p_job_id, 'attempts', v_job.attempt_count));
end;
$$;

-- Heartbeat. 'continue', 'cancel' (workspace paused while publishing) or 'lost' (lease taken over).
create or replace function public.report_publish_heartbeat(p_job_id uuid, p_worker_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
begin
  select * into v_job from public.publish_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then return 'lost'; end if;
  update public.publish_jobs set heartbeat_at = now(), updated_at = now() where id = p_job_id;
  return case when coalesce((select paused from public.publishing_controls where organization_id = v_job.organization_id), false) then 'cancel' else 'continue' end;
end;
$$;

create or replace function public.complete_publish_job(p_job_id uuid, p_worker_id text, p_external_post_id text, p_simulated boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
begin
  select * into v_job from public.publish_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status = 'succeeded' then return jsonb_build_object('status', 'succeeded', 'external_post_id', v_job.external_post_id); end if;
  if v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then raise exception 'Job is not held by this worker'; end if;
  if v_job.adapter = 'mock' and not p_simulated then raise exception 'A simulated Page cannot be reported as really published'; end if;
  update public.publish_jobs set status = 'succeeded', external_post_id = left(p_external_post_id, 200), simulated = p_simulated, completed_at = now(),
    locked_by = null, updated_at = now() where id = p_job_id returning * into v_job;
  update public.social_posts set status = 'published', published_at = now(), external_post_id = v_job.external_post_id, simulated = p_simulated,
    last_error = null, updated_at = clock_timestamp() where id = v_job.post_id;
  perform public.limo_social_audit(v_job.organization_id, case when p_simulated then 'post.simulated_published' else 'post.published' end, 'social_post', v_job.post_id,
    jsonb_build_object('job_id', p_job_id, 'external_post_id', v_job.external_post_id, 'attempts', v_job.attempt_count));
  return jsonb_build_object('status', 'succeeded', 'external_post_id', v_job.external_post_id);
end;
$$;

create or replace function public.fail_publish_job(p_job_id uuid, p_worker_id text, p_code text, p_detail text, p_retryable boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
begin
  select * into v_job from public.publish_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then return 'lost'; end if;
  if p_code in ('token_expired', 'permission_revoked') then
    update public.social_connections c set status = 'expired', last_error = p_code, updated_at = now()
    from public.facebook_pages p where p.id = v_job.page_id and c.id = p.connection_id;
  end if;
  if p_retryable and v_job.attempt_count < v_job.max_attempts then
    update public.publish_jobs set status = 'queued', run_at = now() + make_interval(secs => 30 * v_job.attempt_count), locked_by = null,
      error_code = left(p_code, 80), error_detail = left(p_detail, 500), updated_at = now() where id = p_job_id;
    update public.social_posts set status = 'scheduled', last_error = left(p_code, 80), updated_at = clock_timestamp() where id = v_job.post_id;
    perform public.limo_social_audit(v_job.organization_id, 'post.publish_retry', 'social_post', v_job.post_id, jsonb_build_object('code', p_code, 'attempt', v_job.attempt_count));
    return 'retry';
  end if;
  perform public.limo_fail_publish(p_job_id, p_code, p_detail);
  return 'failed';
end;
$$;

-- The mock adapter's "Facebook": idempotent by key, like a Graph publish with a client-side dedupe check.
create or replace function public.mock_facebook_publish(p_job_id uuid, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.publish_jobs%rowtype;
  v_pub public.mock_facebook_publications%rowtype;
begin
  select * into v_job from public.publish_jobs where id = p_job_id;
  if not found or v_job.adapter <> 'mock' or v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then raise exception 'Job is not held by this worker'; end if;
  select * into v_pub from public.mock_facebook_publications where idempotency_key = v_job.idempotency_key;
  if found then return jsonb_build_object('external_post_id', v_pub.external_post_id, 'duplicate', true); end if;
  insert into public.mock_facebook_publications(idempotency_key, organization_id, page_id, external_post_id, message, media)
  values (v_job.idempotency_key, v_job.organization_id, v_job.page_id, 'sim_' || replace(gen_random_uuid()::text, '-', ''), v_job.payload ->> 'message',
    jsonb_build_array(jsonb_build_object('kind', v_job.payload ->> 'media_kind', 'asset_id', v_job.payload ->> 'media_asset_id')))
  returning * into v_pub;
  return jsonb_build_object('external_post_id', v_pub.external_post_id, 'duplicate', false);
end;
$$;

/**
 * Automation runner entry point: creates one post under an ACTIVE, authorised policy version. Posts with
 * missing facts, or under a "review each" policy, wait for a person; otherwise the policy's recorded
 * authorisation approves and schedules them. Every step is audited with the policy version.
 */
create or replace function public.automation_create_post(p_policy_id uuid, p_version integer, p_title text, p_caption text, p_headline text,
  p_hashtags text[], p_cta text, p_media_kind text, p_image_project_id uuid, p_media_asset_id uuid, p_render_job_id uuid, p_run_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pol public.automation_policies%rowtype;
  v_post public.social_posts%rowtype;
  v_page public.facebook_pages%rowtype;
  v_week integer;
  v_media uuid := p_media_asset_id;
  v_problem text;
  v_job uuid;
begin
  select * into v_pol from public.automation_policies where id = p_policy_id for update;
  if not found or v_pol.status <> 'active' or v_pol.authorized_version is distinct from v_pol.version or p_version is distinct from v_pol.version then
    raise exception 'Policy is not active for this version';
  end if;
  if not coalesce((select enabled from public.feature_flags where key = 'auto_publishing'), false) then raise exception 'Automatic publishing is not available'; end if;
  if coalesce((select paused from public.publishing_controls where organization_id = v_pol.organization_id), false) then raise exception 'Publishing is paused for this workspace'; end if;
  select * into v_page from public.facebook_pages where id = (v_pol.rules ->> 'page_id')::uuid and organization_id = v_pol.organization_id and status = 'active';
  if not found then raise exception 'Choose a connected Page of this workspace'; end if;
  select count(*) into v_week from public.social_posts where automation_policy_id = p_policy_id and created_at > now() - interval '7 days';
  if v_week >= (v_pol.rules ->> 'max_posts_per_week')::integer then raise exception 'Weekly automation limit reached'; end if;
  if p_media_kind = 'video' then
    select output_media_asset_id into v_media from public.render_jobs where id = p_render_job_id and organization_id = v_pol.organization_id and status = 'completed';
  end if;
  insert into public.social_posts(organization_id, title, caption, headline, hashtags, cta, language_code, tone, media_kind, image_project_id, media_asset_id,
    render_job_id, origin, automation_policy_id, automation_policy_version)
  values (v_pol.organization_id, left(btrim(p_title), 200), left(coalesce(p_caption, ''), 5000), left(coalesce(p_headline, ''), 200), coalesce(p_hashtags, '{}'),
    left(coalesce(p_cta, ''), 120), coalesce(v_pol.rules ->> 'language_code', 'en'), coalesce(v_pol.rules ->> 'tone', 'friendly'), p_media_kind,
    case when p_media_kind = 'video' then null else p_image_project_id end, v_media, case when p_media_kind = 'video' then p_render_job_id end,
    'automation', p_policy_id, v_pol.version)
  returning * into v_post;
  perform public.limo_record_post_revision(v_post.id, 'automation', 'Policy ' || v_pol.name || ' v' || v_pol.version);
  v_problem := coalesce(public.limo_post_media_problem(v_post), case when public.limo_post_has_placeholders(v_post) then 'missing_facts' end);
  if v_problem is not null or v_pol.rules ->> 'boundary' = 'review_each' then
    update public.social_posts set status = 'awaiting_review', review_note = v_problem, updated_at = clock_timestamp() where id = v_post.id;
    perform public.limo_social_audit(v_pol.organization_id, 'automation.post_for_review', 'social_post', v_post.id, jsonb_build_object('policy_version', v_pol.version, 'reason', coalesce(v_problem, 'review_each')));
    return jsonb_build_object('post_id', v_post.id, 'status', 'awaiting_review');
  end if;
  if p_run_at < now() - interval '1 minute' then raise exception 'Choose a time in the future'; end if;
  update public.social_posts set status = 'approved', approved_at = now(), approved_by = v_pol.authorized_by, approved_fingerprint = public.limo_post_fingerprint(v_post),
    review_note = 'Approved by automation policy v' || v_pol.version, updated_at = clock_timestamp() where id = v_post.id returning * into v_post;
  perform public.limo_post_charge(v_post.id);
  insert into public.publish_jobs(organization_id, post_id, page_id, adapter, idempotency_key, payload, run_at, simulated, created_by)
  values (v_post.organization_id, v_post.id, v_page.id, case when v_page.is_mock then 'mock' else 'facebook' end, 'post:' || v_post.id::text || ':' || v_post.approved_fingerprint,
    jsonb_build_object('message', concat_ws(E'\n\n', nullif(btrim(v_post.headline), ''), btrim(v_post.caption), nullif(btrim(v_post.cta), ''),
        nullif(array_to_string(array(select '#' || h from unnest(v_post.hashtags) h), ' '), '')),
      'media_kind', v_post.media_kind, 'media_asset_id', v_post.media_asset_id, 'page_external_id', v_page.page_id),
    p_run_at, v_page.is_mock, v_pol.authorized_by)
  returning id into v_job;
  update public.social_posts set status = 'scheduled', page_id = v_page.id, scheduled_at = p_run_at, timezone = v_pol.rules ->> 'timezone', simulated = v_page.is_mock,
    updated_at = clock_timestamp() where id = v_post.id;
  perform public.limo_social_audit(v_pol.organization_id, 'automation.post_scheduled', 'social_post', v_post.id,
    jsonb_build_object('policy_id', p_policy_id, 'policy_version', v_pol.version, 'run_at', p_run_at, 'job_id', v_job, 'simulated', v_page.is_mock));
  return jsonb_build_object('post_id', v_post.id, 'status', 'scheduled', 'job_id', v_job);
end;
$$;

create or replace function public.record_social_webhook(p_object text, p_signature_valid boolean, p_payload jsonb, p_result text)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.social_webhook_events(object, signature_valid, payload, result) values (left(p_object, 60), p_signature_valid, p_payload, left(p_result, 200)) returning id;
$$;

-- 12. Grants ---------------------------------------------------------------------------------------------
revoke all on function public.limo_social_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.limo_post_has_placeholders(public.social_posts) from public, anon;
revoke all on function public.limo_post_fingerprint(public.social_posts) from public, anon;
revoke all on function public.limo_post_snapshot(public.social_posts) from public, anon;
revoke all on function public.limo_record_post_revision(uuid, text, text) from public, anon, authenticated;
revoke all on function public.limo_post_media_problem(public.social_posts) from public, anon, authenticated;
revoke all on function public.limo_post_charge(uuid) from public, anon, authenticated;
revoke all on function public.limo_post_refund(uuid) from public, anon, authenticated;
revoke all on function public.limo_invalidate_post(uuid, text, text) from public, anon, authenticated;
revoke all on function public.limo_fail_publish(uuid, text, text) from public, anon, authenticated;
revoke all on function public.limo_video_posts_invalidate() from public, anon, authenticated;
revoke all on function public.save_social_post_v2(uuid, uuid, timestamptz, text, text, text, text[], text, text, text, text, uuid, uuid, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.submit_social_post_review(uuid, timestamptz) from public, anon;
revoke all on function public.approve_social_post(uuid, timestamptz) from public, anon;
revoke all on function public.reject_social_post(uuid, text) from public, anon;
revoke all on function public.restore_social_post_revision(uuid, timestamptz) from public, anon;
revoke all on function public.schedule_social_post(uuid, timestamptz, uuid, timestamp, text) from public, anon;
revoke all on function public.unschedule_social_post(uuid, boolean) from public, anon;
revoke all on function public.set_publishing_paused(uuid, boolean, text) from public, anon;
revoke all on function public.add_mock_facebook_page(uuid, text) from public, anon;
revoke all on function public.disconnect_facebook_page(uuid) from public, anon;
revoke all on function public.save_automation_policy(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.authorize_automation_policy(uuid, integer, boolean) from public, anon;
revoke all on function public.set_automation_policy_state(uuid, text) from public, anon;
revoke all on function public.claim_publish_job(text, integer) from public, anon, authenticated;
revoke all on function public.report_publish_heartbeat(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_publish_job(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.fail_publish_job(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.mock_facebook_publish(uuid, text) from public, anon, authenticated;
revoke all on function public.automation_create_post(uuid, integer, text, text, text, text[], text, text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_social_webhook(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_social_post_v2(uuid, uuid, timestamptz, text, text, text, text[], text, text, text, text, uuid, uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.submit_social_post_review(uuid, timestamptz) to authenticated;
grant execute on function public.approve_social_post(uuid, timestamptz) to authenticated;
grant execute on function public.reject_social_post(uuid, text) to authenticated;
grant execute on function public.restore_social_post_revision(uuid, timestamptz) to authenticated;
grant execute on function public.schedule_social_post(uuid, timestamptz, uuid, timestamp, text) to authenticated;
grant execute on function public.unschedule_social_post(uuid, boolean) to authenticated;
grant execute on function public.set_publishing_paused(uuid, boolean, text) to authenticated;
grant execute on function public.add_mock_facebook_page(uuid, text) to authenticated;
grant execute on function public.disconnect_facebook_page(uuid) to authenticated;
grant execute on function public.save_automation_policy(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.authorize_automation_policy(uuid, integer, boolean) to authenticated;
grant execute on function public.set_automation_policy_state(uuid, text) to authenticated;
grant execute on function public.claim_publish_job(text, integer) to service_role;
grant execute on function public.report_publish_heartbeat(uuid, text) to service_role;
grant execute on function public.complete_publish_job(uuid, text, text, boolean) to service_role;
grant execute on function public.fail_publish_job(uuid, text, text, text, boolean) to service_role;
grant execute on function public.mock_facebook_publish(uuid, text) to service_role;
grant execute on function public.automation_create_post(uuid, integer, text, text, text, text[], text, text, uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.record_social_webhook(text, boolean, jsonb, text) to service_role;
