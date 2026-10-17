-- LIMO Milestone 6: Image Studio and social posts.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Depends on 20261017100000 (media_assets metadata, workspace-assets bucket, register flow) and
-- 20261017160000 (content_series for story illustrations).
--
-- image_projects: one editable design (layered JSON document) per project; image_revisions: every save,
-- restorable; image_exports: rendered PNG/JPEG/WebP files saved to the private workspace library;
-- social_posts: caption + hashtags + one image, approved before the (future) publishing step.
-- All reads are limited to workspace members; all writes go through the functions below.

-- 1. Tables -------------------------------------------------------------------------------------------
create table if not exists public.image_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  purpose text not null check (purpose in ('product_ad', 'social_post', 'banner', 'thumbnail', 'story_illustration', 'educational', 'custom')),
  aspect text not null check (aspect in ('1:1', '4:5', '9:16', '16:9')),
  style text not null default 'modern' check (style in ('modern', 'bold', 'elegant', 'playful', 'minimal', 'natural')),
  prompt text not null default '' check (char_length(prompt) <= 4000),
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) < 16384),
  document jsonb not null check (jsonb_typeof(document) = 'object' and pg_column_size(document) < 524288),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_revision_id uuid,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  series_id uuid references public.content_series(id) on delete set null,
  source_project_id uuid references public.studio_projects(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists image_projects_org_idx on public.image_projects(organization_id, updated_at desc);

create table if not exists public.image_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  image_project_id uuid not null references public.image_projects(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  source text not null check (source in ('created', 'manual', 'autosave', 'mock_generation', 'restore', 'approval')),
  label text check (label is null or char_length(label) <= 200),
  document jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (image_project_id, revision_number)
);
alter table public.image_projects drop constraint if exists image_projects_approved_revision_fkey;
alter table public.image_projects add constraint image_projects_approved_revision_fkey foreign key (approved_revision_id) references public.image_revisions(id) on delete set null;

create table if not exists public.image_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  image_project_id uuid not null references public.image_projects(id) on delete cascade,
  revision_number integer,
  from_approved boolean not null default false,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  format text not null check (format in ('png', 'jpeg', 'webp')),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists image_exports_project_idx on public.image_exports(image_project_id, created_at desc);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  caption text not null default '' check (char_length(caption) <= 5000),
  hashtags text[] not null default '{}' check (cardinality(hashtags) <= 30),
  channel text not null default 'facebook_page' check (channel in ('facebook_page')),
  image_project_id uuid references public.image_projects(id) on delete set null,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_org_idx on public.social_posts(organization_id, updated_at desc);

alter table public.image_projects enable row level security;
alter table public.image_revisions enable row level security;
alter table public.image_exports enable row level security;
alter table public.social_posts enable row level security;
drop policy if exists image_projects_read on public.image_projects;
create policy image_projects_read on public.image_projects for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists image_revisions_read on public.image_revisions;
create policy image_revisions_read on public.image_revisions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists image_exports_read on public.image_exports;
create policy image_exports_read on public.image_exports for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.image_projects, public.image_revisions, public.image_exports, public.social_posts from public, anon, authenticated;
grant select on public.image_projects, public.image_revisions, public.image_exports, public.social_posts to authenticated;
grant all on public.image_projects, public.image_revisions, public.image_exports, public.social_posts to service_role;

-- 2. Document check ------------------------------------------------------------------------------------
-- Size must match the aspect; at most 60 layers; every image layer must use an image of this workspace.
create or replace function public.limo_check_image_doc(p_organization_id uuid, p_aspect text, p_doc jsonb)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_w integer := (p_doc ->> 'width')::integer;
  v_h integer := (p_doc ->> 'height')::integer;
  v_bad text;
begin
  if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(coalesce(p_doc -> 'layers', 'null'::jsonb)) <> 'array' then raise exception 'Invalid image document'; end if;
  if (p_aspect, v_w, v_h) not in (('1:1', 1080, 1080), ('4:5', 1080, 1350), ('9:16', 1080, 1920), ('16:9', 1920, 1080)) then
    raise exception 'Image size does not match the aspect ratio';
  end if;
  if jsonb_array_length(p_doc -> 'layers') > 60 then raise exception 'Too many layers'; end if;
  if exists (select 1 from jsonb_array_elements(p_doc -> 'layers') l where l ->> 'type' = 'text' and char_length(coalesce(l ->> 'content', '')) > 1000) then
    raise exception 'Text layer too long';
  end if;
  select l ->> 'asset_id' into v_bad from jsonb_array_elements(p_doc -> 'layers') l
  where l ->> 'type' = 'image' and not exists (
    select 1 from public.media_assets m
    where m.id = public.limo_uuid_or_null(l ->> 'asset_id') and m.organization_id = p_organization_id and m.media_type = 'image'
  ) limit 1;
  if v_bad is not null then raise exception 'Image layer uses a file outside this workspace'; end if;
end;
$function$;
revoke all on function public.limo_check_image_doc(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.limo_record_image_revision(p_project_id uuid, p_source text, p_label text)
returns public.image_revisions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.image_projects%rowtype;
  v_last public.image_revisions%rowtype;
  v_rev public.image_revisions%rowtype;
begin
  select * into v_p from public.image_projects where id = p_project_id;
  select * into v_last from public.image_revisions where image_project_id = p_project_id order by revision_number desc limit 1;
  if p_source = 'autosave' and v_last.id is not null and v_last.source = 'autosave' and v_last.created_by = auth.uid() and v_last.updated_at > now() - interval '10 minutes' then
    update public.image_revisions set document = v_p.document, updated_at = now() where id = v_last.id returning * into v_rev;
    return v_rev;
  end if;
  insert into public.image_revisions(organization_id, image_project_id, revision_number, source, label, document, created_by)
  values (v_p.organization_id, p_project_id, coalesce(v_last.revision_number, 0) + 1, p_source, nullif(left(btrim(coalesce(p_label, '')), 200), ''), v_p.document, auth.uid())
  returning * into v_rev;
  delete from public.image_revisions r where r.image_project_id = p_project_id and r.source = 'autosave'
    and r.id not in (select id from public.image_revisions where image_project_id = p_project_id and source = 'autosave' order by revision_number desc limit 30)
    and r.id is distinct from v_p.approved_revision_id;
  return v_rev;
end;
$function$;
revoke all on function public.limo_record_image_revision(uuid, text, text) from public, anon, authenticated;

-- 3. Image projects -------------------------------------------------------------------------------------
create or replace function public.save_image_project(
  p_organization_id uuid, p_project_id uuid, p_base_updated_at timestamptz, p_title text, p_purpose text, p_aspect text, p_style text,
  p_prompt text, p_brief jsonb, p_document jsonb, p_source text, p_label text, p_series_id uuid, p_source_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.image_projects%rowtype;
  v_rev public.image_revisions%rowtype;
  v_source text := coalesce(p_source, 'manual');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if v_source not in ('manual', 'autosave', 'mock_generation') then raise exception 'Invalid revision source'; end if;
  perform public.limo_check_image_doc(p_organization_id, p_aspect, p_document);
  if p_series_id is not null and not exists (select 1 from public.content_series where id = p_series_id and organization_id = p_organization_id) then raise exception 'Series not found'; end if;
  if p_source_project_id is not null and not exists (select 1 from public.studio_projects where id = p_source_project_id and organization_id = p_organization_id) then raise exception 'Project not found'; end if;

  if p_project_id is null then
    if (select count(*) from public.image_projects where organization_id = p_organization_id) >= 500 then raise exception 'A workspace can have at most 500 image projects'; end if;
    insert into public.image_projects(organization_id, title, purpose, aspect, style, prompt, brief, document, series_id, source_project_id, created_by)
    values (p_organization_id, left(btrim(p_title), 200), p_purpose, p_aspect, coalesce(p_style, 'modern'), left(coalesce(p_prompt, ''), 4000), coalesce(p_brief, '{}'::jsonb), p_document, p_series_id, p_source_project_id, auth.uid())
    returning * into v_p;
    v_rev := public.limo_record_image_revision(v_p.id, case when v_source = 'mock_generation' then 'mock_generation' else 'created' end, p_label);
  else
    select * into v_p from public.image_projects where id = p_project_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Image project not found'; end if;
    if p_base_updated_at is null or date_trunc('milliseconds', v_p.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
      raise exception 'Image changed since it was loaded' using errcode = 'P0001';
    end if;
    if v_p.status = 'approved' then raise exception 'Image is approved; remove approval before editing'; end if;
    update public.image_projects set title = left(btrim(p_title), 200), purpose = p_purpose, aspect = p_aspect, style = coalesce(p_style, style),
      prompt = left(coalesce(p_prompt, ''), 4000), brief = coalesce(p_brief, '{}'::jsonb), document = p_document,
      series_id = p_series_id, source_project_id = p_source_project_id, updated_at = clock_timestamp()
    where id = p_project_id returning * into v_p;
    v_rev := public.limo_record_image_revision(v_p.id, v_source, p_label);
  end if;
  return jsonb_build_object('id', v_p.id, 'updated_at', v_p.updated_at, 'revision_number', v_rev.revision_number, 'status', v_p.status);
end;
$function$;

create or replace function public.restore_image_revision(p_revision_id uuid, p_base_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rev public.image_revisions%rowtype;
  v_p public.image_projects%rowtype;
  v_new public.image_revisions%rowtype;
begin
  select * into v_rev from public.image_revisions where id = p_revision_id;
  if not found or not public.can_edit_org(v_rev.organization_id) then raise exception 'Revision not found'; end if;
  select * into v_p from public.image_projects where id = v_rev.image_project_id for update;
  if p_base_updated_at is null or date_trunc('milliseconds', v_p.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Image changed since it was loaded' using errcode = 'P0001';
  end if;
  if v_p.status = 'approved' then raise exception 'Image is approved; remove approval before editing'; end if;
  perform public.limo_check_image_doc(v_p.organization_id, v_p.aspect, v_rev.document);
  update public.image_projects set document = v_rev.document, updated_at = clock_timestamp() where id = v_p.id returning * into v_p;
  v_new := public.limo_record_image_revision(v_p.id, 'restore', 'Restored revision ' || v_rev.revision_number);
  return jsonb_build_object('id', v_p.id, 'updated_at', v_p.updated_at, 'revision_number', v_new.revision_number);
end;
$function$;

-- Approval: no [placeholder] text left; the approved revision is what exports and posts use.
create or replace function public.approve_image_project(p_project_id uuid, p_base_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.image_projects%rowtype;
  v_rev public.image_revisions%rowtype;
begin
  select * into v_p from public.image_projects where id = p_project_id for update;
  if not found or not public.can_edit_org(v_p.organization_id) then raise exception 'Image project not found'; end if;
  if v_p.status = 'approved' then raise exception 'Image is already approved'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_p.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Image changed since it was loaded' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_p.document -> 'layers') l
             where l ->> 'type' = 'text' and coalesce((l ->> 'visible')::boolean, true) and l ->> 'content' ~ '\[[^]\n]{1,80}\]') then
    raise exception 'Replace the placeholder text before approving';
  end if;
  perform public.limo_check_image_doc(v_p.organization_id, v_p.aspect, v_p.document);
  v_rev := public.limo_record_image_revision(p_project_id, 'approval', 'Approved');
  update public.image_projects set status = 'approved', approved_revision_id = v_rev.id, approved_at = now(), approved_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_project_id returning * into v_p;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_p.organization_id, auth.uid(), 'image.approved', 'image_project', p_project_id, jsonb_build_object('revision_number', v_rev.revision_number));
  return jsonb_build_object('updated_at', v_p.updated_at, 'revision_number', v_rev.revision_number, 'status', 'approved');
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

-- 4. Exports: a rendered file already uploaded to workspace-assets/<org>/exports/… becomes a library item.
create or replace function public.register_image_export(
  p_project_id uuid, p_object_path text, p_format text, p_width integer, p_height integer, p_size_bytes bigint, p_revision_number integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.image_projects%rowtype;
  v_asset uuid;
  v_export uuid;
  v_w integer;
  v_h integer;
begin
  select * into v_p from public.image_projects where id = p_project_id;
  if not found or not public.can_edit_org(v_p.organization_id) then raise exception 'Image project not found'; end if;
  if p_format not in ('png', 'jpeg', 'webp') then raise exception 'Invalid export format'; end if;
  if left(p_object_path, char_length(v_p.organization_id::text) + 9) <> v_p.organization_id::text || '/exports/' or p_object_path ~ '\.\.' then raise exception 'Invalid export path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'workspace-assets' and name = p_object_path) then raise exception 'Uploaded file not found'; end if;
  v_w := (v_p.document ->> 'width')::integer;
  v_h := (v_p.document ->> 'height')::integer;
  if not ((p_width, p_height) in ((v_w, v_h), (v_w * 2, v_h * 2))) then raise exception 'Export size does not match the design'; end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400 then raise exception 'Export too large'; end if;
  insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, file_name, mime_type, size_bytes, width, height, label, created_by)
  values (v_p.organization_id, 'workspace-assets', p_object_path, 'image', 'uploaded', 'design',
          left(v_p.title, 160) || case p_format when 'png' then '.png' when 'jpeg' then '.jpg' else '.webp' end,
          case p_format when 'png' then 'image/png' when 'jpeg' then 'image/jpeg' else 'image/webp' end,
          p_size_bytes, p_width, p_height, left(v_p.title, 120), auth.uid())
  returning id into v_asset;
  insert into public.image_exports(organization_id, image_project_id, revision_number, from_approved, media_asset_id, format, width, height, size_bytes, created_by)
  values (v_p.organization_id, p_project_id, p_revision_number, v_p.status = 'approved', v_asset, p_format, p_width, p_height, p_size_bytes, auth.uid())
  returning id into v_export;
  return jsonb_build_object('export_id', v_export, 'media_asset_id', v_asset, 'from_approved', v_p.status = 'approved');
end;
$function$;

-- 5. Social posts ---------------------------------------------------------------------------------------
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

revoke all on function public.save_image_project(uuid, uuid, timestamptz, text, text, text, text, text, jsonb, jsonb, text, text, uuid, uuid) from public, anon;
revoke all on function public.restore_image_revision(uuid, timestamptz) from public, anon;
revoke all on function public.approve_image_project(uuid, timestamptz) from public, anon;
revoke all on function public.remove_image_approval(uuid) from public, anon;
revoke all on function public.register_image_export(uuid, text, text, integer, integer, bigint, integer) from public, anon;
revoke all on function public.save_social_post(uuid, uuid, timestamptz, text, text, text[], uuid, uuid) from public, anon;
revoke all on function public.set_social_post_approval(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.save_image_project(uuid, uuid, timestamptz, text, text, text, text, text, jsonb, jsonb, text, text, uuid, uuid) to authenticated;
grant execute on function public.restore_image_revision(uuid, timestamptz) to authenticated;
grant execute on function public.approve_image_project(uuid, timestamptz) to authenticated;
grant execute on function public.remove_image_approval(uuid) to authenticated;
grant execute on function public.register_image_export(uuid, text, text, integer, integer, bigint, integer) to authenticated;
grant execute on function public.save_social_post(uuid, uuid, timestamptz, text, text, text[], uuid, uuid) to authenticated;
grant execute on function public.set_social_post_approval(uuid, boolean, timestamptz) to authenticated;
