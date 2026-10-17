-- LIMO Milestone 4: canonical character system.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Depends on 20261017090000 (is_platform_admin_mfa) and 20261017100000 (save_studio_project_v2).
--
-- 1. character_design_specs: versioned written design specs (seeded v1 "proposed" from lib/characters/canon.ts).
-- 2. characters (workspace characters): spec, base family, age/gender, status, reference status.
-- 3. character_reference_assets: versioned reference files (rendered reference images, rigged 3D models,
--    turntables) per view / expression / outfit, with provenance. Approval needs a recorded viewing of the
--    file by the reviewer and a complete checklist. Nothing is approved by this migration.
-- 4. Private bucket character-library: canonical/<character>/v<n>/… (platform admins with two-factor) and
--    <organization>/custom/<character>/… (workspace editors). Approved canonical files readable by members.
-- 5. save_studio_project_v2 accepts workspace characters in the cast ("custom:<uuid>").
-- Reference status for generation is "approved" only when the latest spec version is approved AND the
-- front, side and three-quarter reference images for that version are approved.

-- 0. Helpers -----------------------------------------------------------------------------------------
create or replace function public.limo_uuid_or_null(p_text text)
returns uuid
language plpgsql
immutable
set search_path to ''
as $function$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$function$;

-- 1. Design specs ------------------------------------------------------------------------------------
create table if not exists public.character_design_specs (
  id uuid primary key default gen_random_uuid(),
  character_id text not null references public.character_catalog(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'superseded')),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 65536),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (character_id, version)
);
alter table public.character_design_specs enable row level security;
drop policy if exists character_design_specs_read on public.character_design_specs;
create policy character_design_specs_read on public.character_design_specs for select to authenticated using (true);
revoke all on public.character_design_specs from public, anon, authenticated;
grant select on public.character_design_specs to authenticated;
grant all on public.character_design_specs to service_role;

-- 2. Workspace characters ----------------------------------------------------------------------------
alter table public.characters
  add column if not exists base_family text,
  add column if not exists age_group text,
  add column if not exists gender_code text,
  add column if not exists spec jsonb not null default '{}'::jsonb,
  add column if not exists spec_version integer not null default 1,
  add column if not exists status text not null default 'active',
  add column if not exists reference_status text not null default 'pending',
  add column if not exists visual_ref text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
alter table public.characters drop constraint if exists characters_base_family_check;
alter table public.characters add constraint characters_base_family_check check (base_family is null or base_family in ('limo', 'nova', 'adam'));
alter table public.characters drop constraint if exists characters_age_group_check;
alter table public.characters add constraint characters_age_group_check check (age_group is null or age_group in ('child', 'adult', 'elder'));
alter table public.characters drop constraint if exists characters_gender_code_check;
alter table public.characters add constraint characters_gender_code_check check (gender_code is null or gender_code in ('male', 'female', 'unspecified'));
alter table public.characters drop constraint if exists characters_status_check;
alter table public.characters add constraint characters_status_check check (status in ('active', 'archived'));
alter table public.characters drop constraint if exists characters_reference_status_check;
alter table public.characters add constraint characters_reference_status_check check (reference_status in ('pending', 'in_review', 'approved'));
alter table public.characters drop constraint if exists characters_spec_check;
alter table public.characters add constraint characters_spec_check check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 65536);

-- Writes only through save_custom_character / archive_custom_character (reference status cannot be self-set).
drop policy if exists characters_insert on public.characters;
drop policy if exists characters_update on public.characters;
revoke insert, update, delete, truncate on public.characters from anon, authenticated;
revoke all on public.characters from anon;
grant select on public.characters to authenticated;

-- 3. Reference assets ---------------------------------------------------------------------------------
create table if not exists public.character_reference_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  catalog_character_id text references public.character_catalog(id) on delete cascade,
  custom_character_id uuid references public.characters(id) on delete cascade,
  spec_version integer not null check (spec_version > 0),
  asset_kind text not null check (asset_kind in ('rendered_reference', 'rigged_model', 'turntable_video')),
  view text check (view is null or view in ('front', 'side', 'three_quarter', 'back')),
  expression_key text check (expression_key is null or char_length(expression_key) between 2 and 40),
  outfit_key text check (outfit_key is null or char_length(outfit_key) between 2 and 40),
  bucket_id text not null default 'character-library' check (bucket_id = 'character-library'),
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer,
  height integer,
  model_meta jsonb not null default '{}'::jsonb check (jsonb_typeof(model_meta) = 'object'),
  provenance text not null check (provenance in ('uploaded_artwork', 'commissioned', 'ai_generated', '3d_render')),
  provenance_note text check (provenance_note is null or char_length(provenance_note) <= 500),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  review_checklist jsonb,
  created_at timestamptz not null default now(),
  -- Exactly one owner: a catalog character (platform asset) or a workspace character (workspace asset).
  check ((catalog_character_id is not null) <> (custom_character_id is not null)),
  check ((catalog_character_id is not null and organization_id is null) or (custom_character_id is not null and organization_id is not null)),
  -- Rendered references are images of a view or expression; rigged models are model files; turntables are videos.
  check (
    (asset_kind = 'rendered_reference' and mime_type in ('image/png', 'image/jpeg', 'image/webp') and (view is not null or expression_key is not null or outfit_key is not null))
    or (asset_kind = 'rigged_model' and mime_type in ('model/gltf-binary', 'model/gltf+json', 'application/octet-stream') and view is null)
    or (asset_kind = 'turntable_video' and mime_type in ('video/mp4', 'video/webm'))
  )
);
create index if not exists character_reference_assets_catalog_idx on public.character_reference_assets(catalog_character_id, spec_version, status);
create index if not exists character_reference_assets_custom_idx on public.character_reference_assets(custom_character_id, spec_version, status);
alter table public.character_reference_assets enable row level security;
drop policy if exists character_reference_assets_read on public.character_reference_assets;
create policy character_reference_assets_read on public.character_reference_assets for select to authenticated using (
  (organization_id is null and (status = 'approved' or public.is_platform_admin_mfa()))
  or (organization_id is not null and public.is_org_member(organization_id))
);
revoke all on public.character_reference_assets from public, anon, authenticated;
grant select on public.character_reference_assets to authenticated;
grant all on public.character_reference_assets to service_role;

-- Reviewers must open the file before deciding; the review UI records it.
create table if not exists public.character_reference_views (
  asset_id uuid not null references public.character_reference_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (asset_id, user_id)
);
alter table public.character_reference_views enable row level security;
revoke all on public.character_reference_views from public, anon, authenticated;
grant all on public.character_reference_views to service_role;

-- 4. Storage ------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-library', 'character-library', false, 104857600,
        array['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary', 'model/gltf+json', 'application/octet-stream', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists character_library_insert on storage.objects;
create policy character_library_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'character-library' and (
    ((storage.foldername(name))[1] = 'canonical' and public.is_platform_admin_mfa())
    or ((storage.foldername(name))[2] = 'custom' and public.can_edit_org(public.limo_uuid_or_null((storage.foldername(name))[1])))
  )
);
drop policy if exists character_library_read on storage.objects;
create policy character_library_read on storage.objects for select to authenticated using (
  bucket_id = 'character-library' and (
    ((storage.foldername(name))[1] = 'canonical' and (
      public.is_platform_admin_mfa()
      or exists (select 1 from public.character_reference_assets a where a.object_path = name and a.status = 'approved' and a.organization_id is null)
    ))
    or ((storage.foldername(name))[2] = 'custom' and public.is_org_member(public.limo_uuid_or_null((storage.foldername(name))[1])))
  )
);

-- 5. Status ------------------------------------------------------------------------------------------
create or replace function public.limo_latest_spec(p_character_id text)
returns public.character_design_specs
language sql
stable
security definer
set search_path to ''
as $function$
  select * from public.character_design_specs where character_id = p_character_id and status <> 'superseded' order by version desc limit 1;
$function$;
revoke all on function public.limo_latest_spec(text) from public, anon, authenticated;

create or replace function public.limo_refresh_reference_status(p_catalog_id text, p_custom_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version integer;
  v_spec_ok boolean;
  v_required integer;
  v_pending boolean;
  v_front text;
  v_status text;
begin
  if p_catalog_id is not null then
    select version, status = 'approved' into v_version, v_spec_ok from public.limo_latest_spec(p_catalog_id);
  else
    select spec_version, true into v_version, v_spec_ok from public.characters where id = p_custom_id;
  end if;
  select count(distinct view) into v_required from public.character_reference_assets
    where status = 'approved' and asset_kind = 'rendered_reference' and view in ('front', 'side', 'three_quarter')
      and spec_version = v_version and expression_key is null
      and (catalog_character_id = p_catalog_id or custom_character_id = p_custom_id);
  select exists (select 1 from public.character_reference_assets where status = 'pending_review' and spec_version = v_version
    and (catalog_character_id = p_catalog_id or custom_character_id = p_custom_id)) into v_pending;
  select object_path into v_front from public.character_reference_assets
    where status = 'approved' and asset_kind = 'rendered_reference' and view = 'front' and expression_key is null and spec_version = v_version
      and (catalog_character_id = p_catalog_id or custom_character_id = p_custom_id)
    order by reviewed_at desc limit 1;
  v_status := case when coalesce(v_spec_ok, false) and v_required = 3 then 'approved' when v_pending then 'in_review' else 'pending' end;
  if p_catalog_id is not null then
    update public.character_catalog set reference_status = v_status, visual_ref = case when v_status = 'approved' then v_front else null end, updated_at = now()
      where id = p_catalog_id;
  else
    update public.characters set reference_status = v_status, visual_ref = case when v_status = 'approved' then v_front else null end, updated_at = now()
      where id = p_custom_id;
  end if;
  return v_status;
end;
$function$;
revoke all on function public.limo_refresh_reference_status(text, uuid) from public, anon, authenticated;

-- Who may review an asset: platform admins with two-factor for canonical assets; owners/admins of the workspace otherwise.
create or replace function public.limo_can_review_reference(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case when p_org is null then public.is_platform_admin_mfa() else public.is_org_admin(p_org) end;
$function$;
revoke all on function public.limo_can_review_reference(uuid) from public, anon, authenticated;

-- 6. Specs (platform admins) ----------------------------------------------------------------------------
create or replace function public.admin_propose_character_spec(p_character_id text, p_spec jsonb, p_note text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version integer;
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized (two-factor admin session required)'; end if;
  if not exists (select 1 from public.character_catalog where id = p_character_id and family_code is not null) then raise exception 'Unknown character'; end if;
  if jsonb_typeof(p_spec) <> 'object' then raise exception 'Invalid spec'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.character_design_specs where character_id = p_character_id;
  insert into public.character_design_specs(character_id, version, status, spec, note, created_by)
  values (p_character_id, v_version, 'proposed', p_spec, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), auth.uid());
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'character.spec_proposed', 'character', null, jsonb_build_object('character_id', p_character_id, 'version', v_version));
  perform public.limo_refresh_reference_status(p_character_id, null);
  return v_version;
end;
$function$;

create or replace function public.admin_approve_character_spec(p_character_id text, p_version integer)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_latest public.character_design_specs%rowtype;
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized (two-factor admin session required)'; end if;
  v_latest := public.limo_latest_spec(p_character_id);
  if v_latest.id is null or v_latest.version <> p_version then raise exception 'Only the latest spec version can be approved'; end if;
  update public.character_design_specs set status = 'superseded' where character_id = p_character_id and status = 'approved' and version <> p_version;
  update public.character_design_specs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = v_latest.id;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'character.spec_approved', 'character', null, jsonb_build_object('character_id', p_character_id, 'version', p_version));
  return public.limo_refresh_reference_status(p_character_id, null);
end;
$function$;

-- 7. Workspace characters ----------------------------------------------------------------------------
create or replace function public.save_custom_character(
  p_organization_id uuid, p_character_id uuid, p_name text, p_description text, p_base_family text,
  p_age_group text, p_gender_code text, p_spec jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_old public.characters%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Character name required'; end if;
  if jsonb_typeof(coalesce(p_spec, '{}'::jsonb)) <> 'object' then raise exception 'Invalid spec'; end if;
  if p_character_id is null then
    if (select count(*) from public.characters where organization_id = p_organization_id and status = 'active') >= 50 then
      raise exception 'A workspace can have at most 50 active characters';
    end if;
    insert into public.characters(organization_id, name, description, base_family, age_group, gender_code, spec, created_by)
    values (p_organization_id, left(btrim(p_name), 80), left(coalesce(p_description, ''), 2000), p_base_family, p_age_group, p_gender_code, coalesce(p_spec, '{}'::jsonb), auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.characters where id = p_character_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Character not found'; end if;
    -- A new design spec starts a new reference version: references of the old version stop counting.
    update public.characters set
      name = left(btrim(p_name), 80), description = left(coalesce(p_description, ''), 2000), base_family = p_base_family,
      age_group = p_age_group, gender_code = p_gender_code, spec = coalesce(p_spec, '{}'::jsonb),
      spec_version = case when v_old.spec is distinct from coalesce(p_spec, '{}'::jsonb) or v_old.base_family is distinct from p_base_family
                            or v_old.age_group is distinct from p_age_group or v_old.gender_code is distinct from p_gender_code
                          then v_old.spec_version + 1 else v_old.spec_version end,
      updated_at = now()
    where id = p_character_id returning id into v_id;
  end if;
  perform public.limo_refresh_reference_status(null, v_id);
  return v_id;
end;
$function$;

create or replace function public.archive_custom_character(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.characters where id = p_character_id;
  if v_org is null or not public.can_edit_org(v_org) then raise exception 'Character not found'; end if;
  update public.characters set status = 'archived', updated_at = now() where id = p_character_id;
end;
$function$;

-- 8. References ---------------------------------------------------------------------------------------
create or replace function public.register_character_reference(
  p_catalog_character_id text, p_custom_character_id uuid, p_object_path text, p_asset_kind text, p_view text,
  p_expression_key text, p_outfit_key text, p_mime_type text, p_size_bytes bigint, p_width integer, p_height integer,
  p_provenance text, p_provenance_note text, p_model_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
  v_version integer;
  v_prefix text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if (p_catalog_character_id is null) = (p_custom_character_id is null) then raise exception 'Choose one character'; end if;
  if p_catalog_character_id is not null then
    if not public.is_platform_admin_mfa() then raise exception 'Not authorized (two-factor admin session required)'; end if;
    select version into v_version from public.limo_latest_spec(p_catalog_character_id);
    if v_version is null then raise exception 'Unknown character'; end if;
    v_prefix := 'canonical/' || p_catalog_character_id || '/v' || v_version || '/';
  else
    select organization_id, spec_version into v_org, v_version from public.characters where id = p_custom_character_id and status = 'active';
    if v_org is null or not public.can_edit_org(v_org) then raise exception 'Character not found'; end if;
    v_prefix := v_org::text || '/custom/' || p_custom_character_id::text || '/v' || v_version || '/';
  end if;
  if left(p_object_path, char_length(v_prefix)) <> v_prefix or p_object_path ~ '\.\.' then raise exception 'Invalid reference path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'character-library' and name = p_object_path) then
    raise exception 'Uploaded file not found';
  end if;
  insert into public.character_reference_assets(
    organization_id, catalog_character_id, custom_character_id, spec_version, asset_kind, view, expression_key, outfit_key,
    object_path, mime_type, size_bytes, width, height, model_meta, provenance, provenance_note, uploaded_by
  ) values (
    v_org, p_catalog_character_id, p_custom_character_id, v_version, p_asset_kind, p_view, nullif(p_expression_key, ''), nullif(p_outfit_key, ''),
    p_object_path, p_mime_type, p_size_bytes, p_width, p_height, coalesce(p_model_meta, '{}'::jsonb), p_provenance,
    nullif(left(btrim(coalesce(p_provenance_note, '')), 500), ''), auth.uid()
  ) returning id into v_id;
  perform public.limo_refresh_reference_status(p_catalog_character_id, p_custom_character_id);
  return v_id;
end;
$function$;

create or replace function public.record_character_reference_view(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.character_reference_assets where id = p_asset_id;
  if not found or not public.limo_can_review_reference(v_org) then raise exception 'Reference not found'; end if;
  insert into public.character_reference_views(asset_id, user_id) values (p_asset_id, auth.uid())
  on conflict (asset_id, user_id) do update set viewed_at = now();
end;
$function$;

create or replace function public.review_character_reference(p_asset_id uuid, p_approve boolean, p_note text, p_checklist jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_asset public.character_reference_assets%rowtype;
  v_required text[];
  v_missing text;
begin
  select * into v_asset from public.character_reference_assets where id = p_asset_id for update;
  if not found or not public.limo_can_review_reference(v_asset.organization_id) then raise exception 'Reference not found'; end if;
  if v_asset.status <> 'pending_review' then raise exception 'This reference has already been reviewed'; end if;
  -- No decision without having opened the file in the last 24 hours.
  if not exists (select 1 from public.character_reference_views where asset_id = p_asset_id and user_id = auth.uid() and viewed_at > now() - interval '24 hours') then
    raise exception 'Open the reference before reviewing it';
  end if;
  if p_approve then
    v_required := case when v_asset.asset_kind = 'rigged_model'
      then array['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'rig_checked']
      else array['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'view_correct', 'no_text_or_watermark'] end;
    select k into v_missing from unnest(v_required) k where coalesce((p_checklist ->> k)::boolean, false) is not true limit 1;
    if v_missing is not null then raise exception 'Checklist incomplete: %', v_missing; end if;
    -- One approved file per slot: the previous approval is superseded.
    update public.character_reference_assets set status = 'superseded'
      where status = 'approved' and id <> p_asset_id and asset_kind = v_asset.asset_kind and spec_version = v_asset.spec_version
        and view is not distinct from v_asset.view and expression_key is not distinct from v_asset.expression_key
        and outfit_key is not distinct from v_asset.outfit_key
        and catalog_character_id is not distinct from v_asset.catalog_character_id
        and custom_character_id is not distinct from v_asset.custom_character_id;
  elsif char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters';
  end if;
  update public.character_reference_assets set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
    review_checklist = coalesce(p_checklist, '{}'::jsonb)
  where id = p_asset_id;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_asset.organization_id, auth.uid(), case when p_approve then 'character.reference_approved' else 'character.reference_rejected' end,
          'character_reference', p_asset_id,
          jsonb_build_object('character', coalesce(v_asset.catalog_character_id, v_asset.custom_character_id::text), 'view', v_asset.view, 'kind', v_asset.asset_kind));
  return public.limo_refresh_reference_status(v_asset.catalog_character_id, v_asset.custom_character_id);
end;
$function$;

-- Withdraw an approved or pending reference (e.g. approved by mistake). Never deletes the file.
create or replace function public.retire_character_reference(p_asset_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_asset public.character_reference_assets%rowtype;
begin
  select * into v_asset from public.character_reference_assets where id = p_asset_id for update;
  if not found or not public.limo_can_review_reference(v_asset.organization_id) then raise exception 'Reference not found'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give a reason of at least 5 characters'; end if;
  update public.character_reference_assets set
    status = case when status = 'pending_review' then 'rejected' else 'superseded' end,
    review_note = left(btrim(p_note), 1000), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_asset_id and status in ('pending_review', 'approved');
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_asset.organization_id, auth.uid(), 'character.reference_retired', 'character_reference', p_asset_id, jsonb_build_object('note', left(btrim(p_note), 200)));
  return public.limo_refresh_reference_status(v_asset.catalog_character_id, v_asset.custom_character_id);
end;
$function$;

revoke all on function public.limo_uuid_or_null(text) from public, anon;
revoke all on function public.admin_propose_character_spec(text, jsonb, text) from public, anon;
revoke all on function public.admin_approve_character_spec(text, integer) from public, anon;
revoke all on function public.save_custom_character(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.archive_custom_character(uuid) from public, anon;
revoke all on function public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb) from public, anon;
revoke all on function public.record_character_reference_view(uuid) from public, anon;
revoke all on function public.review_character_reference(uuid, boolean, text, jsonb) from public, anon;
revoke all on function public.retire_character_reference(uuid, text) from public, anon;
grant execute on function public.limo_uuid_or_null(text) to authenticated;
grant execute on function public.admin_propose_character_spec(text, jsonb, text) to authenticated;
grant execute on function public.admin_approve_character_spec(text, integer) to authenticated;
grant execute on function public.save_custom_character(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.archive_custom_character(uuid) to authenticated;
grant execute on function public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb) to authenticated;
grant execute on function public.record_character_reference_view(uuid) to authenticated;
grant execute on function public.review_character_reference(uuid, boolean, text, jsonb) to authenticated;
grant execute on function public.retire_character_reference(uuid, text) to authenticated;

-- 9. Workspace characters in project casts ("custom:<uuid>") ---------------------------------------------
create or replace function public.save_studio_project_v2(
  p_organization_id uuid, p_project_id uuid, p_title text, p_creation_mode text, p_content_type text,
  p_language_code text, p_brief text, p_goal text, p_visual_style text, p_creation_brief jsonb,
  p_project_cast jsonb, p_scenes jsonb, p_export_presets text[]
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project_id uuid;
  v_cast_count integer;
  v_scene_count integer;
  v_total_duration integer := 0;
  v_cast_ids text[] := array[]::text[];
  v_scene jsonb;
  v_scene_number integer;
  v_duration integer;
  v_participants text[];
  v_invalid text;
  v_assets uuid[];
  v_preset text;
  v_min_cast integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.organization_subscriptions
  where organization_id = p_organization_id and status = 'active' and renews_at > now();
  if not found then raise exception 'Active subscription required'; end if;

  if p_creation_mode not in ('product_ad', 'business_promo', 'social_video', 'social_post', 'story', 'explainer', 'ugc_ad', 'custom') then
    raise exception 'Invalid creation mode';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'Project title required'; end if;
  if not exists (select 1 from public.content_type_catalog where code = p_content_type and active = true) then raise exception 'Invalid content type'; end if;
  if not exists (select 1 from public.language_catalog where code = p_language_code and active = true) then raise exception 'Invalid language'; end if;
  if jsonb_typeof(coalesce(p_creation_brief, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_creation_brief, '{}'::jsonb)) >= 32768 then
    raise exception 'Invalid creation brief';
  end if;

  if jsonb_typeof(p_project_cast) <> 'array' then raise exception 'Project cast must be an array'; end if;
  v_cast_count := jsonb_array_length(p_project_cast);
  v_min_cast := case when p_creation_mode = 'story' then 1 else 0 end;
  if v_cast_count < v_min_cast or v_cast_count > 18 then
    raise exception 'Choose between % and 18 characters', v_min_cast;
  end if;
  if v_cast_count > 0 then
    select array_agg(distinct elem->>'id') into v_cast_ids
    from jsonb_array_elements(p_project_cast) elem where nullif(elem->>'id', '') is not null;
    if coalesce(cardinality(v_cast_ids), 0) <> v_cast_count then raise exception 'Character IDs must be unique and present'; end if;
    -- Catalog characters, or active workspace characters of this workspace ("custom:<uuid>").
    if (select count(*) from public.character_catalog c where c.active = true and c.id = any(v_cast_ids))
       + (select count(*) from public.characters ch where ch.organization_id = p_organization_id and ch.status = 'active'
            and ('custom:' || ch.id::text) = any(v_cast_ids)) <> v_cast_count then
      raise exception 'One or more characters are unavailable';
    end if;
  end if;

  if jsonb_typeof(p_scenes) <> 'array' then raise exception 'Scenes must be an array'; end if;
  v_scene_count := jsonb_array_length(p_scenes);
  if v_scene_count < 1 or v_scene_count > 25 then raise exception 'A project must contain 1 to 25 scenes'; end if;

  for v_scene in select value from jsonb_array_elements(p_scenes) loop
    v_scene_number := coalesce((v_scene->>'scene_number')::integer, 0);
    v_duration := coalesce((v_scene->>'duration_seconds')::integer, 0);
    if v_scene_number < 1 or v_scene_number > 25 then raise exception 'Invalid scene number'; end if;
    if v_duration < 1 or v_duration > 15 then raise exception 'Each scene must be between 1 and 15 seconds in LIMO v1'; end if;
    v_total_duration := v_total_duration + v_duration;

    select coalesce(array_agg(x), array[]::text[]) into v_participants
    from jsonb_array_elements_text(coalesce(v_scene->'participants', '[]'::jsonb)) x;
    select x into v_invalid from unnest(v_participants) x where not (x = any(v_cast_ids)) limit 1;
    if v_invalid is not null then raise exception 'Scene participant % is not in the project cast', v_invalid; end if;

    select coalesce(array_agg(x::uuid), array[]::uuid[]) into v_assets
    from jsonb_array_elements_text(coalesce(v_scene->'asset_ids', '[]'::jsonb)) x;
    if cardinality(v_assets) > 10 then raise exception 'A scene can use at most 10 assets'; end if;
    if cardinality(v_assets) > 0 and (select count(*) from public.media_assets m where m.id = any(v_assets) and m.organization_id = p_organization_id) <> cardinality(v_assets) then
      raise exception 'Scene asset does not belong to this workspace';
    end if;
  end loop;
  if (select count(distinct (x->>'scene_number')::integer) from jsonb_array_elements(p_scenes) x) <> v_scene_count then
    raise exception 'Scene numbers must be unique';
  end if;

  if p_project_id is null then
    insert into public.studio_projects(
      organization_id, title, creation_mode, creation_brief, content_type, language_code, brief, goal, visual_style,
      continuation_mode, project_cast, status, total_duration_seconds, estimated_slots, created_by
    ) values (
      p_organization_id, left(btrim(p_title), 200), p_creation_mode, coalesce(p_creation_brief, '{}'::jsonb),
      p_content_type, p_language_code, left(coalesce(p_brief, ''), 8000), left(coalesce(p_goal, ''), 1000),
      left(coalesce(p_visual_style, ''), 1000), false, p_project_cast, 'draft', v_total_duration,
      greatest(1, ceil(v_total_duration::numeric / 30)::integer), auth.uid()
    ) returning id into v_project_id;
  else
    update public.studio_projects set
      title = left(btrim(p_title), 200), creation_mode = p_creation_mode, creation_brief = coalesce(p_creation_brief, '{}'::jsonb),
      content_type = p_content_type, language_code = p_language_code, brief = left(coalesce(p_brief, ''), 8000),
      goal = left(coalesce(p_goal, ''), 1000), visual_style = left(coalesce(p_visual_style, ''), 1000),
      project_cast = p_project_cast, total_duration_seconds = v_total_duration,
      estimated_slots = greatest(1, ceil(v_total_duration::numeric / 30)::integer), updated_at = now()
    where id = p_project_id and organization_id = p_organization_id and status in ('draft', 'ready')
    returning id into v_project_id;
    if v_project_id is null then raise exception 'Project not found or no longer editable'; end if;
    delete from public.project_scenes where project_id = v_project_id;
    delete from public.project_export_choices where project_id = v_project_id;
  end if;

  for v_scene in select value from jsonb_array_elements(p_scenes) loop
    insert into public.project_scenes(
      project_id, organization_id, scene_number, title, duration_seconds, location_prompt, environment_prompt,
      camera_prompt, lighting_prompt, action_prompt, dialogue, on_screen_text, effects_prompt, music_prompt,
      participants, transition_out, continuity_notes, narration, visual_prompt, asset_ids
    ) values (
      v_project_id, p_organization_id, (v_scene->>'scene_number')::integer,
      nullif(left(coalesce(v_scene->>'title', ''), 200), ''), (v_scene->>'duration_seconds')::integer,
      nullif(left(coalesce(v_scene->>'location_prompt', ''), 1500), ''),
      nullif(left(coalesce(v_scene->>'environment_prompt', ''), 1500), ''),
      nullif(left(coalesce(v_scene->>'camera_prompt', ''), 1000), ''),
      nullif(left(coalesce(v_scene->>'lighting_prompt', ''), 1000), ''),
      nullif(left(coalesce(v_scene->>'action_prompt', ''), 2500), ''),
      nullif(left(coalesce(v_scene->>'dialogue', ''), 4000), ''),
      nullif(left(coalesce(v_scene->>'on_screen_text', ''), 1500), ''),
      nullif(left(coalesce(v_scene->>'effects_prompt', ''), 1500), ''),
      nullif(left(coalesce(v_scene->>'music_prompt', ''), 1000), ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_scene->'participants', '[]'::jsonb)) x), array[]::text[]),
      nullif(left(coalesce(v_scene->>'transition_out', ''), 500), ''),
      nullif(left(coalesce(v_scene->>'continuity_notes', ''), 1500), ''),
      nullif(left(coalesce(v_scene->>'narration', ''), 4000), ''),
      nullif(left(coalesce(v_scene->>'visual_prompt', ''), 2500), ''),
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_scene->'asset_ids', '[]'::jsonb)) x), array[]::uuid[])
    );
  end loop;

  if p_export_presets is not null then
    foreach v_preset in array p_export_presets loop
      if not exists (select 1 from public.export_presets where code = v_preset and active = true) then
        raise exception 'Invalid export preset %', v_preset;
      end if;
      insert into public.project_export_choices(project_id, organization_id, preset_code)
      values (v_project_id, p_organization_id, v_preset) on conflict (project_id, preset_code) do nothing;
    end loop;
  end if;
  return v_project_id;
end;
$function$;

-- 10. Seed: canonical design specs v1 (status "proposed"; generated by scripts/gen-character-specs-sql.ts) ---
insert into public.character_design_specs(character_id, version, status, spec, note) values
  ('limo_boy', 1, 'proposed', '{"character_id":"limo_boy","family":"limo","variant":"boy","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"male","personality":"playful and curious","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, energetic, slight forward lean"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","small cap worn backwards on special occasions only"],"outfits":[{"key":"everyday","name":"Everyday","description":"Striped T-shirt, knee-length shorts and sneakers.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Weekend","description":"Hoodie with a small leaf badge, joggers and sneakers.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO young boy: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small cap worn backwards on special occasions only.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('limo_girl', 1, 'proposed', '{"character_id":"limo_girl","family":"limo","variant":"girl","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"female","personality":"playful and curious","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, lively, light on her feet"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","small hair clip shaped like a flower attached to the crown"],"outfits":[{"key":"everyday","name":"Everyday","description":"Short-sleeved dress over leggings and sneakers.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Play day","description":"Dungarees over a T-shirt with rolled cuffs and sneakers.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO young girl: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; small hair clip shaped like a flower attached to the crown.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('limo_man', 1, 'proposed', '{"character_id":"limo_man","family":"limo","variant":"man","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"male","personality":"expressive and confident","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.15,"posture":"relaxed and confident"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","short neat brows"],"outfits":[{"key":"everyday","name":"Everyday","description":"Button-up shirt with rolled sleeves, chinos and casual shoes.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Smart casual","description":"Light jacket over a crew-neck T-shirt, dark trousers.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO adult man: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; short neat brows.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('limo_woman', 1, 'proposed', '{"character_id":"limo_woman","family":"limo","variant":"woman","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"female","personality":"expressive and confident","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.2,"posture":"poised and warm"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","soft eyelashes","small earrings"],"outfits":[{"key":"everyday","name":"Everyday","description":"Blouse, straight trousers and flats.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Smart casual","description":"Long cardigan over a knit top, midi skirt and ankle boots.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO adult woman: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; soft eyelashes; small earrings.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('limo_elder_man', 1, 'proposed', '{"character_id":"limo_elder_man","family":"limo","variant":"elder_man","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"male","personality":"warm and wise","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.2,"posture":"gentle forward lean, calm and dignified"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","round glasses","bushy light-grey brows","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Cardigan over a collared shirt, comfortable trousers and slippers.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Celebration","description":"Tweed vest, bow tie and polished shoes; optional walking stick.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO elderly man: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; round glasses; bushy light-grey brows; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('limo_elder_woman', 1, 'proposed', '{"character_id":"limo_elder_woman","family":"limo","variant":"elder_woman","species":"anthropomorphic tomato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"female","personality":"warm and wise","head":"Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.","crown":"Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.","surface":"Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.","face":"Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.25,"posture":"gentle forward lean, warm and wise"},"palette":[{"key":"skin","hex":"#E8412C","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#B82E1F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF7A5C","use":"specular highlight"},{"key":"crown","hex":"#3E9B3F","use":"calyx and stem"},{"key":"crown_shadow","hex":"#2C7A31","use":"calyx shadow"},{"key":"iris","hex":"#3B2A20","use":"eyes"}],"signature_details":["curled stem tilted to the right","four soft vertical lobes on the head","glasses on a thin chain","soft eyelashes","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Knitted shawl over a long-sleeved dress and comfortable shoes.","colors":["#2F6FDB","#F4F1EA"]},{"key":"special","name":"Celebration","description":"Patterned headscarf, embroidered jacket and long skirt.","colors":["#1F2A44","#F4F1EA"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"LIMO elderly woman: premium stylized 3D anthropomorphic tomato character for a family-friendly animated series. Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette. Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right. Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow. Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #E8412C, crown #3E9B3F, iris #3B2A20. Details: curled stem tilted to the right; four soft vertical lobes on the head; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E8412C","crown #3E9B3F","iris #3B2A20"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_boy', 1, 'proposed', '{"character_id":"nova_boy","family":"nova","variant":"boy","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"male","personality":"playful and curious","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, energetic, slight forward lean"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","small cap worn backwards on special occasions only"],"outfits":[{"key":"everyday","name":"Everyday","description":"Striped T-shirt, knee-length shorts and sneakers.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Weekend","description":"Hoodie with a small leaf badge, joggers and sneakers.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA young boy: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; small cap worn backwards on special occasions only.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_girl', 1, 'proposed', '{"character_id":"nova_girl","family":"nova","variant":"girl","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"female","personality":"playful and curious","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, lively, light on her feet"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","small hair clip shaped like a flower attached to the crown"],"outfits":[{"key":"everyday","name":"Everyday","description":"Short-sleeved dress over leggings and sneakers.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Play day","description":"Dungarees over a T-shirt with rolled cuffs and sneakers.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA young girl: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; small hair clip shaped like a flower attached to the crown.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_man', 1, 'proposed', '{"character_id":"nova_man","family":"nova","variant":"man","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"male","personality":"expressive and confident","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.15,"posture":"relaxed and confident"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","short neat brows"],"outfits":[{"key":"everyday","name":"Everyday","description":"Button-up shirt with rolled sleeves, chinos and casual shoes.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Smart casual","description":"Light jacket over a crew-neck T-shirt, dark trousers.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA adult man: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; short neat brows.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_woman', 1, 'proposed', '{"character_id":"nova_woman","family":"nova","variant":"woman","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"female","personality":"expressive and confident","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.2,"posture":"poised and warm"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","soft eyelashes","small earrings"],"outfits":[{"key":"everyday","name":"Everyday","description":"Blouse, straight trousers and flats.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Smart casual","description":"Long cardigan over a knit top, midi skirt and ankle boots.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA adult woman: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; soft eyelashes; small earrings.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_elder_man', 1, 'proposed', '{"character_id":"nova_elder_man","family":"nova","variant":"elder_man","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"male","personality":"warm and wise","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.2,"posture":"gentle forward lean, calm and dignified"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","round glasses","bushy light-grey brows","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Cardigan over a collared shirt, comfortable trousers and slippers.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Celebration","description":"Tweed vest, bow tie and polished shoes; optional walking stick.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA elderly man: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; round glasses; bushy light-grey brows; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('nova_elder_woman', 1, 'proposed', '{"character_id":"nova_elder_woman","family":"nova","variant":"elder_woman","species":"anthropomorphic strawberry","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"female","personality":"warm and wise","head":"Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.","crown":"Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.","surface":"Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.","face":"Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.25,"posture":"gentle forward lean, warm and wise"},"palette":[{"key":"skin","hex":"#E23D57","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#A8293F","use":"shadows, brows"},{"key":"skin_highlight","hex":"#FF8197","use":"highlight"},{"key":"seeds","hex":"#F5D06A","use":"seed pattern"},{"key":"crown","hex":"#4FAE4A","use":"sepals and stem"},{"key":"iris","hex":"#2E2230","use":"eyes"}],"signature_details":["diamond seed pattern","flat five-sepal ruff with a centred stem","glasses on a thin chain","soft eyelashes","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Knitted shawl over a long-sleeved dress and comfortable shoes.","colors":["#F7F0E3","#7CC6A4"]},{"key":"special","name":"Celebration","description":"Patterned headscarf, embroidered jacket and long skirt.","colors":["#5B4B8A","#7CC6A4"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"NOVA elderly woman: premium stylized 3D anthropomorphic strawberry character for a family-friendly animated series. Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin. Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre. Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks. Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #E23D57, crown #4FAE4A, iris #2E2230. Details: diamond seed pattern; flat five-sepal ruff with a centred stem; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #E23D57","crown #4FAE4A","iris #2E2230"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_boy', 1, 'proposed', '{"character_id":"adam_boy","family":"adam","variant":"boy","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"male","personality":"playful and curious","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, energetic, slight forward lean"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","small cap worn backwards on special occasions only"],"outfits":[{"key":"everyday","name":"Everyday","description":"Striped T-shirt, knee-length shorts and sneakers.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Weekend","description":"Hoodie with a small leaf badge, joggers and sneakers.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM young boy: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, energetic, slight forward lean. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small cap worn backwards on special occasions only.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_girl', 1, 'proposed', '{"character_id":"adam_girl","family":"adam","variant":"girl","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"child","gender":"female","personality":"playful and curious","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":2.6,"head_width_to_shoulders":1.5,"posture":"upright, lively, light on her feet"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","small hair clip shaped like a flower attached to the crown"],"outfits":[{"key":"everyday","name":"Everyday","description":"Short-sleeved dress over leggings and sneakers.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Play day","description":"Dungarees over a T-shirt with rolled cuffs and sneakers.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM young girl: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs. About 2.6 heads tall; upright, lively, light on her feet. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; small hair clip shaped like a flower attached to the crown.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_man', 1, 'proposed', '{"character_id":"adam_man","family":"adam","variant":"man","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"male","personality":"expressive and confident","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.15,"posture":"relaxed and confident"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","short neat brows"],"outfits":[{"key":"everyday","name":"Everyday","description":"Button-up shirt with rolled sleeves, chinos and casual shoes.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Smart casual","description":"Light jacket over a crew-neck T-shirt, dark trousers.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM adult man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; relaxed and confident. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; short neat brows.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_woman', 1, 'proposed', '{"character_id":"adam_woman","family":"adam","variant":"woman","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"adult","gender":"female","personality":"expressive and confident","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.4,"head_width_to_shoulders":1.2,"posture":"poised and warm"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","soft eyelashes","small earrings"],"outfits":[{"key":"everyday","name":"Everyday","description":"Blouse, straight trousers and flats.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Smart casual","description":"Long cardigan over a knit top, midi skirt and ankle boots.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM adult woman: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs. About 3.4 heads tall; poised and warm. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; soft eyelashes; small earrings.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_elder_man', 1, 'proposed', '{"character_id":"adam_elder_man","family":"adam","variant":"elder_man","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"male","personality":"warm and wise","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.2,"posture":"gentle forward lean, calm and dignified"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","round glasses","bushy light-grey brows","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Cardigan over a collared shirt, comfortable trousers and slippers.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Celebration","description":"Tweed vest, bow tie and polished shoes; optional walking stick.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM elderly man: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, calm and dignified. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; round glasses; bushy light-grey brows; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.'),
  ('adam_elder_woman', 1, 'proposed', '{"character_id":"adam_elder_woman","family":"adam","variant":"elder_woman","species":"anthropomorphic potato","render_style":"Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.","age_group":"elder","gender":"female","personality":"warm and wise","head":"Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.","crown":"Two-leaf green sprout growing from the top; the left leaf is larger than the right.","surface":"Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.","face":"Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.","body":"Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.","proportions":{"height_in_heads":3.2,"head_width_to_shoulders":1.25,"posture":"gentle forward lean, warm and wise"},"palette":[{"key":"skin","hex":"#C99A62","use":"head, hands, legs"},{"key":"skin_shadow","hex":"#9A7146","use":"shadows, brows"},{"key":"skin_highlight","hex":"#E3BE8A","use":"highlight"},{"key":"spots","hex":"#8C6A43","use":"potato eye spots"},{"key":"crown","hex":"#6CBF4B","use":"sprout leaves"},{"key":"iris","hex":"#2B2118","use":"eyes"}],"signature_details":["three potato-eye spots in fixed positions","two-leaf sprout, left leaf larger","glasses on a thin chain","soft eyelashes","gentle smile lines around the eyes"],"outfits":[{"key":"everyday","name":"Everyday","description":"Knitted shawl over a long-sleeved dress and comfortable shoes.","colors":["#3D5A80","#E0A526"]},{"key":"special","name":"Celebration","description":"Patterned headscarf, embroidered jacket and long skirt.","colors":["#F2EBDD","#E0A526"]}],"expressions":[{"key":"neutral","description":"Relaxed face, eyes open, mouth closed in a soft line."},{"key":"happy","description":"Eyes slightly squinted, wide closed-mouth smile, cheeks lifted."},{"key":"laughing","description":"Eyes closed in arcs, open mouth laugh, head tilted back slightly."},{"key":"surprised","description":"Eyes wide, brows raised high, small round open mouth."},{"key":"sad","description":"Brows tilted up in the middle, eyes glossy, mouth turned down."},{"key":"thinking","description":"One brow raised, eyes looking up and to the side, mouth pushed to one side."},{"key":"determined","description":"Brows lowered and angled, focused eyes, firm closed mouth."},{"key":"worried","description":"Brows pinched together, eyes looking aside, small tense mouth."}],"required_views":["front","side","three_quarter"],"consistency":{"identity_prompt":"ADAM elderly woman: premium stylized 3D anthropomorphic potato character for a family-friendly animated series. Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left. Two-leaf green sprout growing from the top; the left leaf is larger than the right. Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek. Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth. Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs. About 3.2 heads tall; gentle forward lean, warm and wise. Colours: skin #C99A62, crown #6CBF4B, iris #2B2118. Details: three potato-eye spots in fixed positions; two-leaf sprout, left leaf larger; glasses on a thin chain; soft eyelashes; gentle smile lines around the eyes.","negative_prompt":["realistic human skin or human face","hair on the head (the crown replaces hair)","more or fewer than four fingers per hand","extra limbs or duplicated features","changing the family colour, crown shape or face layout","text, logos or watermarks","scary, violent or adult content","photorealistic food textures"],"locked_colors":["skin #C99A62","crown #6CBF4B","iris #2B2118"],"rules":["Approved reference images take priority over text when both are available.","Keep the crown, face layout and family colours identical in every shot.","Only the outfit and expression may change between scenes.","Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads)."]}}'::jsonb, 'Canonical design brief v1 (text). Awaiting owner review.')
on conflict (character_id, version) do nothing;

-- Existing catalog statuses are recomputed (no approvals exist, so all stay "pending").
do $$
begin
  perform public.limo_refresh_reference_status(id, null) from public.character_catalog where family_code is not null;
end $$;
