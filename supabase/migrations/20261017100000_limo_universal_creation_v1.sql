-- LIMO AI Studio — universal creation v1 (Milestone 2)
-- Status: PENDING OWNER APPROVAL for production. Additive; existing save_studio_project is unchanged.
--
-- 1. studio_projects: creation_mode + creation_brief (mode-specific inputs); cast may be empty (0..18).
-- 2. project_scenes: narration, visual_prompt, asset_ids (workspace media used by the scene).
-- 3. save_studio_project_v2: like v1, plus mode/brief/narration/visuals/assets; characters are required
--    only for 'story' projects; scene assets must belong to the workspace.
-- 4. Workspace asset library: media_assets metadata columns, private bucket workspace-assets with
--    "<organization_id>/…" folder policies, register/delete functions.
-- 5. brand_kits: one per workspace (name, colours, logo, tagline, CTA, tone).

-- 1. Projects ---------------------------------------------------------------------------------------
alter table public.studio_projects add column if not exists creation_mode text not null default 'story';
alter table public.studio_projects add column if not exists creation_brief jsonb not null default '{}'::jsonb;
alter table public.studio_projects drop constraint if exists studio_projects_creation_mode_check;
alter table public.studio_projects add constraint studio_projects_creation_mode_check check (
  creation_mode in ('product_ad', 'business_promo', 'social_video', 'social_post', 'story', 'explainer', 'ugc_ad', 'custom')
);
alter table public.studio_projects drop constraint if exists studio_projects_creation_brief_check;
alter table public.studio_projects add constraint studio_projects_creation_brief_check check (
  jsonb_typeof(creation_brief) = 'object' and pg_column_size(creation_brief) < 32768
);
alter table public.studio_projects drop constraint if exists studio_projects_project_cast_check1;
alter table public.studio_projects add constraint studio_projects_project_cast_check1
  check (jsonb_array_length(project_cast) between 0 and 18);

-- 2. Scenes -----------------------------------------------------------------------------------------
alter table public.project_scenes add column if not exists narration text;
alter table public.project_scenes add column if not exists visual_prompt text;
alter table public.project_scenes add column if not exists asset_ids uuid[] not null default '{}'::uuid[];

-- 4. Media library ----------------------------------------------------------------------------------
alter table public.media_assets add column if not exists kind text not null default 'other';
alter table public.media_assets add column if not exists file_name text;
alter table public.media_assets add column if not exists mime_type text;
alter table public.media_assets add column if not exists size_bytes bigint;
alter table public.media_assets add column if not exists width integer;
alter table public.media_assets add column if not exists height integer;
alter table public.media_assets add column if not exists duration_ms integer;
alter table public.media_assets add column if not exists label text;
alter table public.media_assets add column if not exists created_by uuid;
alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets add constraint media_assets_kind_check check (
  kind in ('product', 'logo', 'background', 'reference', 'photo', 'video', 'audio', 'render', 'design', 'other')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-assets', 'workspace-assets', false, 104857600,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm'])
on conflict (id) do nothing;

drop policy if exists workspace_assets_insert on storage.objects;
create policy workspace_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-assets'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.can_edit_org(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists workspace_assets_read on storage.objects;
create policy workspace_assets_read on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-assets'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists workspace_assets_delete on storage.objects;
create policy workspace_assets_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-assets'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.can_edit_org(((storage.foldername(name))[1])::uuid)
  );

create or replace function public.register_media_asset(
  p_organization_id uuid, p_object_path text, p_kind text, p_mime_type text, p_size_bytes bigint,
  p_file_name text, p_width integer default null, p_height integer default null,
  p_duration_ms integer default null, p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_type text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if split_part(p_object_path, '/', 1) <> p_organization_id::text then raise exception 'Invalid asset path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'workspace-assets' and name = p_object_path) then
    raise exception 'Uploaded file not found';
  end if;
  v_type := case
    when p_mime_type like 'image/%' then 'image'
    when p_mime_type like 'video/%' then 'video'
    when p_mime_type like 'audio/%' then 'audio'
    else 'other' end;
  insert into public.media_assets(
    organization_id, bucket_id, object_path, media_type, source, kind, file_name, mime_type,
    size_bytes, width, height, duration_ms, label, created_by
  ) values (
    p_organization_id, 'workspace-assets', p_object_path, v_type, 'uploaded', coalesce(p_kind, 'other'),
    left(coalesce(p_file_name, ''), 200), left(coalesce(p_mime_type, ''), 100), p_size_bytes,
    p_width, p_height, p_duration_ms, nullif(left(btrim(coalesce(p_label, '')), 120), ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.delete_media_asset(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_asset public.media_assets%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_asset from public.media_assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found'; end if;
  if not public.can_edit_org(v_asset.organization_id) then raise exception 'Not authorized'; end if;
  if v_asset.source <> 'uploaded' then raise exception 'Generated assets are removed by retention'; end if;
  if exists (select 1 from public.project_scenes where p_asset_id = any(asset_ids)) then
    raise exception 'Asset is used by a project scene';
  end if;
  delete from public.media_assets where id = p_asset_id;
  return v_asset.object_path;
end;
$function$;

-- 5. Brand kit --------------------------------------------------------------------------------------
create table if not exists public.brand_kits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  brand_name text not null default '' check (char_length(brand_name) <= 120),
  tagline text not null default '' check (char_length(tagline) <= 200),
  website text not null default '' check (char_length(website) <= 200),
  primary_color text not null default '#7157ef' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#211e2b' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_asset_id uuid references public.media_assets(id) on delete set null,
  default_cta text not null default '' check (char_length(default_cta) <= 120),
  tone text not null default '' check (char_length(tone) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.brand_kits enable row level security;
drop policy if exists brand_kits_read on public.brand_kits;
create policy brand_kits_read on public.brand_kits for select to authenticated using (public.is_org_member(organization_id));

create or replace function public.save_brand_kit(p_organization_id uuid, p_kit jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_logo uuid := nullif(p_kit->>'logo_asset_id', '')::uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if v_logo is not null and not exists (select 1 from public.media_assets where id = v_logo and organization_id = p_organization_id) then
    raise exception 'Logo does not belong to this workspace';
  end if;
  insert into public.brand_kits(organization_id, brand_name, tagline, website, primary_color, secondary_color, logo_asset_id, default_cta, tone, updated_by, updated_at)
  values (p_organization_id,
    left(btrim(coalesce(p_kit->>'brand_name', '')), 120), left(btrim(coalesce(p_kit->>'tagline', '')), 200),
    left(btrim(coalesce(p_kit->>'website', '')), 200), coalesce(nullif(p_kit->>'primary_color', ''), '#7157ef'),
    coalesce(nullif(p_kit->>'secondary_color', ''), '#211e2b'), v_logo,
    left(btrim(coalesce(p_kit->>'default_cta', '')), 120), left(btrim(coalesce(p_kit->>'tone', '')), 200), auth.uid(), now())
  on conflict (organization_id) do update set
    brand_name = excluded.brand_name, tagline = excluded.tagline, website = excluded.website,
    primary_color = excluded.primary_color, secondary_color = excluded.secondary_color,
    logo_asset_id = excluded.logo_asset_id, default_cta = excluded.default_cta, tone = excluded.tone,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$;

-- 3. save_studio_project_v2 -------------------------------------------------------------------------
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
    if (select count(*) from public.character_catalog c where c.active = true and c.id = any(v_cast_ids)) <> v_cast_count then
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

revoke all on function public.save_studio_project_v2(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]) from public, anon;
revoke all on function public.register_media_asset(uuid, text, text, text, bigint, text, integer, integer, integer, text) from public, anon;
revoke all on function public.delete_media_asset(uuid) from public, anon;
revoke all on function public.save_brand_kit(uuid, jsonb) from public, anon;
grant execute on function public.save_studio_project_v2(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.register_media_asset(uuid, text, text, text, bigint, text, integer, integer, integer, text) to authenticated;
grant execute on function public.delete_media_asset(uuid) to authenticated;
grant execute on function public.save_brand_kit(uuid, jsonb) to authenticated;
