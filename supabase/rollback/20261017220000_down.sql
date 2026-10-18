-- Rollback of 20261017220000_limo_social_publishing_v1. Run first (newest migration).
-- Removes scheduling, publishing jobs, post revisions, automation policies, the workspace pause, simulated
-- Pages/connections and their publications. Social posts stay, reduced to the Milestone 6 model: anything
-- approved/scheduled/published becomes 'approved', everything else 'draft'. The extra post fields
-- (headline, CTA, language, tone, video, schedule, publication references) are dropped. Post credits
-- already used this cycle are not returned. The Milestone 6 functions are restored exactly.
drop trigger if exists trg_video_posts_invalidate on public.studio_projects;
drop function if exists public.limo_video_posts_invalidate();
drop function if exists public.record_social_webhook(text, boolean, jsonb, text);
drop function if exists public.automation_create_post(uuid, integer, text, text, text, text[], text, text, uuid, uuid, uuid, timestamptz);
drop function if exists public.mock_facebook_publish(uuid, text);
drop function if exists public.fail_publish_job(uuid, text, text, text, boolean);
drop function if exists public.complete_publish_job(uuid, text, text, boolean);
drop function if exists public.report_publish_heartbeat(uuid, text);
drop function if exists public.claim_publish_job(text, integer);
drop function if exists public.limo_fail_publish(uuid, text, text);
drop function if exists public.set_automation_policy_state(uuid, text);
drop function if exists public.authorize_automation_policy(uuid, integer, boolean);
drop function if exists public.save_automation_policy(uuid, uuid, text, jsonb);
drop function if exists public.disconnect_facebook_page(uuid);
drop function if exists public.add_mock_facebook_page(uuid, text);
drop function if exists public.set_publishing_paused(uuid, boolean, text);
drop function if exists public.unschedule_social_post(uuid, boolean);
drop function if exists public.schedule_social_post(uuid, timestamptz, uuid, timestamp, text);
drop function if exists public.restore_social_post_revision(uuid, timestamptz);
drop function if exists public.reject_social_post(uuid, text);
drop function if exists public.approve_social_post(uuid, timestamptz);
drop function if exists public.submit_social_post_review(uuid, timestamptz);
drop function if exists public.save_social_post_v2(uuid, uuid, timestamptz, text, text, text, text[], text, text, text, text, uuid, uuid, uuid, uuid, text, text, text);
drop function if exists public.limo_invalidate_post(uuid, text, text);
drop function if exists public.limo_post_refund(uuid);
drop function if exists public.limo_post_charge(uuid);
drop function if exists public.limo_post_media_problem(public.social_posts);
drop function if exists public.limo_record_post_revision(uuid, text, text);
drop function if exists public.limo_post_snapshot(public.social_posts);
drop function if exists public.limo_post_fingerprint(public.social_posts);
drop function if exists public.limo_post_has_placeholders(public.social_posts);
drop function if exists public.limo_social_audit(uuid, text, text, uuid, jsonb);

drop table if exists public.publish_jobs;
drop table if exists public.social_post_revisions;
drop table if exists public.publishing_controls;
drop table if exists public.mock_facebook_publications;
drop table if exists public.social_webhook_events;
alter table public.social_posts drop constraint if exists social_posts_policy_fkey;
drop table if exists public.automation_policy_versions;
drop table if exists public.automation_policies;

update public.social_posts set status = case when status in ('approved', 'scheduled', 'publishing', 'published') then 'approved' else 'draft' end
where status not in ('draft', 'approved');
alter table public.social_posts drop constraint if exists social_posts_status_check;
alter table public.social_posts add constraint social_posts_status_check check (status in ('draft', 'approved'));
drop index if exists public.social_posts_schedule_idx;
alter table public.social_posts
  drop column if exists headline, drop column if exists cta, drop column if exists language_code, drop column if exists tone,
  drop column if exists media_kind, drop column if exists render_job_id, drop column if exists source_project_id, drop column if exists origin,
  drop column if exists automation_policy_id, drop column if exists automation_policy_version, drop column if exists page_id,
  drop column if exists scheduled_at, drop column if exists timezone, drop column if exists published_at, drop column if exists external_post_id,
  drop column if exists simulated, drop column if exists last_error, drop column if exists review_note, drop column if exists revision_number,
  drop column if exists approved_fingerprint, drop column if exists quota_charged;

-- Simulated Pages and connections only existed for testing the flow.
delete from public.facebook_pages where is_mock;
delete from public.social_connections where is_mock;
alter table public.facebook_pages drop constraint if exists facebook_pages_status_check;
alter table public.facebook_pages drop constraint if exists facebook_pages_rate_check;
alter table public.facebook_pages drop column if exists is_mock, drop column if exists status, drop column if exists max_posts_per_hour;
alter table public.social_connections drop column if exists is_mock, drop column if exists scopes, drop column if exists last_error, drop column if exists disconnected_at;

-- Milestone 6 functions, as defined in 20261017180000.
create or replace function public.save_social_post(
  p_organization_id uuid, p_post_id uuid, p_base_updated_at timestamptz, p_title text, p_caption text, p_hashtags text[],
  p_image_project_id uuid, p_media_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_post public.social_posts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_image_project_id is not null and not exists (select 1 from public.image_projects where id = p_image_project_id and organization_id = p_organization_id) then raise exception 'Image project not found'; end if;
  if p_media_asset_id is not null and not exists (select 1 from public.media_assets where id = p_media_asset_id and organization_id = p_organization_id and media_type = 'image') then
    raise exception 'Image file outside this workspace';
  end if;
  if cardinality(coalesce(p_hashtags, '{}')) > 30 or exists (select 1 from unnest(coalesce(p_hashtags, '{}')) t where t !~ '^[[:alnum:]_]{1,60}$') then raise exception 'Invalid hashtags'; end if;
  if p_post_id is null then
    insert into public.social_posts(organization_id, title, caption, hashtags, image_project_id, media_asset_id, created_by)
    values (p_organization_id, left(btrim(p_title), 200), left(coalesce(p_caption, ''), 5000), coalesce(p_hashtags, '{}'), p_image_project_id, p_media_asset_id, auth.uid())
    returning * into v_post;
  else
    select * into v_post from public.social_posts where id = p_post_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Post not found'; end if;
    if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
      raise exception 'Post changed since it was loaded' using errcode = 'P0001';
    end if;
    if v_post.status = 'approved' then raise exception 'Post is approved; remove approval before editing'; end if;
    update public.social_posts set title = left(btrim(p_title), 200), caption = left(coalesce(p_caption, ''), 5000), hashtags = coalesce(p_hashtags, '{}'),
      image_project_id = p_image_project_id, media_asset_id = p_media_asset_id, updated_at = clock_timestamp()
    where id = p_post_id returning * into v_post;
  end if;
  return jsonb_build_object('id', v_post.id, 'updated_at', v_post.updated_at, 'status', v_post.status);
end;
$function$;

create or replace function public.set_social_post_approval(p_post_id uuid, p_approve boolean, p_base_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_post public.social_posts%rowtype;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or not public.can_edit_org(v_post.organization_id) then raise exception 'Post not found'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_post.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Post changed since it was loaded' using errcode = 'P0001';
  end if;
  if p_approve then
    if char_length(btrim(v_post.caption)) = 0 then raise exception 'Write a caption before approving'; end if;
    if v_post.media_asset_id is null then raise exception 'Choose an image before approving'; end if;
    if v_post.image_project_id is not null and (select status from public.image_projects where id = v_post.image_project_id) <> 'approved' then
      raise exception 'Approve the image before approving the post';
    end if;
    update public.social_posts set status = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = clock_timestamp() where id = p_post_id returning * into v_post;
  else
    update public.social_posts set status = 'draft', updated_at = clock_timestamp() where id = p_post_id returning * into v_post;
  end if;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_post.organization_id, auth.uid(), case when p_approve then 'post.approved' else 'post.approval_removed' end, 'social_post', p_post_id, '{}'::jsonb);
  return jsonb_build_object('updated_at', v_post.updated_at, 'status', v_post.status);
end;
$function$;

create or replace function public.remove_image_approval(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.image_projects%rowtype;
begin
  select * into v_p from public.image_projects where id = p_project_id for update;
  if not found or not public.can_edit_org(v_p.organization_id) then raise exception 'Image project not found'; end if;
  update public.image_projects set status = 'draft', updated_at = clock_timestamp() where id = p_project_id returning * into v_p;
  -- Posts using this image go back to draft: they must be approved again with the new design.
  update public.social_posts set status = 'draft', updated_at = clock_timestamp() where image_project_id = p_project_id and status = 'approved';
  return jsonb_build_object('updated_at', v_p.updated_at, 'status', 'draft');
end;
$function$;
