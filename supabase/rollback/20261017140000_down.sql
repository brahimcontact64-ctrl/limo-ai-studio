-- Rollback of 20261017140000_limo_character_system_v1. Run before 20261017120000_down.sql.
-- Removes design specs, reference records (files stay in the bucket), workspace character fields and the
-- character-library policies; restores the Milestone 2 save_studio_project_v2 and direct writes on characters.
--
-- PRE-CHECK: projects that cast workspace characters ("custom:<uuid>") could no longer be saved afterwards.
do $$
begin
  if exists (select 1 from public.studio_projects p, jsonb_array_elements(p.project_cast) e where e->>'id' like 'custom:%') then
    raise exception 'Rollback stopped: projects cast workspace characters; resolve them first';
  end if;
end $$;

drop function if exists public.retire_character_reference(uuid, text);
drop function if exists public.review_character_reference(uuid, boolean, text, jsonb);
drop function if exists public.record_character_reference_view(uuid);
drop function if exists public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb);
drop function if exists public.archive_custom_character(uuid);
drop function if exists public.save_custom_character(uuid, uuid, text, text, text, text, text, jsonb);
drop function if exists public.admin_approve_character_spec(text, integer);
drop function if exists public.admin_propose_character_spec(text, jsonb, text);
drop function if exists public.limo_can_review_reference(uuid);
drop function if exists public.limo_refresh_reference_status(text, uuid);
drop function if exists public.limo_latest_spec(text);

drop policy if exists character_library_insert on storage.objects;
drop policy if exists character_library_read on storage.objects;
-- The character-library bucket and its files are left in place (export/remove them through the Storage API).

drop table if exists public.character_reference_views;
drop table if exists public.character_reference_assets;
drop table if exists public.character_design_specs;

-- Approval state came only from the removed tables.
update public.character_catalog set reference_status = 'pending', visual_ref = null where family_code is not null;

alter table public.characters drop constraint if exists characters_base_family_check;
alter table public.characters drop constraint if exists characters_age_group_check;
alter table public.characters drop constraint if exists characters_gender_code_check;
alter table public.characters drop constraint if exists characters_status_check;
alter table public.characters drop constraint if exists characters_reference_status_check;
alter table public.characters drop constraint if exists characters_spec_check;
alter table public.characters
  drop column if exists base_family,
  drop column if exists age_group,
  drop column if exists gender_code,
  drop column if exists spec,
  drop column if exists spec_version,
  drop column if exists status,
  drop column if exists reference_status,
  drop column if exists visual_ref,
  drop column if exists created_by,
  drop column if exists updated_at;
-- Previous direct-write policies (TRUNCATE and anon grants are deliberately not restored).
grant insert, update, delete on public.characters to authenticated;
drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters for insert to authenticated with check (public.can_edit_org(organization_id));
drop policy if exists characters_update on public.characters;
create policy characters_update on public.characters for update to authenticated using (public.can_edit_org(organization_id)) with check (public.can_edit_org(organization_id));

-- Milestone 2 definition of save_studio_project_v2 (catalog characters only), copied from 20261017100000.
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

drop function if exists public.limo_uuid_or_null(text);
