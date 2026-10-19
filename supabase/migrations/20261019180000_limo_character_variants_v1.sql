-- LIMO character variants v1 — scene-specific costume / expression on an UNCHANGED canonical spec.
-- Status: PENDING OWNER APPROVAL for production (16th pending migration). Additive; replaces four earlier functions.
-- Depends on 20261017140000 (character references), 20261019090000 / 20261019150000 (Animation Studio).
--
--   * character_variants: versioned variants (variant_key + version), drawn on a canonical spec version; status
--     proposed → approved / rejected. Approving or creating needs a platform admin with two-factor (audited).
--   * Reference files can belong to an APPROVED variant (e.g. the father's "angry" expression in a formal suit); the
--     upload accepts a variant's own expression/outfit keys only with that variant; plain uploads keep the 8 canonical
--     expressions. Variant files never count as the canonical front / three-quarter / side.
--   * Animation shots can select an approved variant per character; its expression becomes allowed in that shot; a
--     keyframe/clip needs the variant's approved front view.
--   * Seed: adam_man.formal_angry v1, approved by the owner in writing (2026-10-19). No artwork is created or approved.

create table if not exists public.character_variants (
  id uuid primary key default gen_random_uuid(),
  variant_key text not null check (variant_key ~ '^[a-z0-9_:.-]{3,80}$'),
  version integer not null default 1 check (version >= 1),
  catalog_character_id text references public.character_catalog(id),
  custom_character_id uuid references public.characters(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  base_spec_version integer not null check (base_spec_version >= 1),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  purpose text not null default '' check (char_length(purpose) <= 500),
  outfit jsonb check (outfit is null or (jsonb_typeof(outfit) = 'object' and char_length(outfit ->> 'key') between 2 and 40)),
  expression jsonb check (expression is null or (jsonb_typeof(expression) = 'object' and char_length(expression ->> 'key') between 2 and 40)),
  approval_note text check (char_length(approval_note) <= 500),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (variant_key, version),
  check ((catalog_character_id is not null and organization_id is null and custom_character_id is null)
      or (custom_character_id is not null and organization_id is not null and catalog_character_id is null))
);
alter table public.character_variants enable row level security;
drop policy if exists character_variants_read on public.character_variants;
create policy character_variants_read on public.character_variants for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));
revoke insert, update, delete on public.character_variants from anon, authenticated;
grant select on public.character_variants to authenticated;
grant all on public.character_variants to service_role;

alter table public.character_reference_assets add column if not exists variant_id uuid references public.character_variants(id);
alter table public.animation_shots add column if not exists character_variants jsonb not null default '{}'::jsonb;

/** Platform admin (two-factor): approve or reject a variant version (audited). */
create or replace function public.admin_set_character_variant_status(p_variant_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.character_variants%rowtype;
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized: platform admin with two-factor authentication required'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid status'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a note'; end if;
  select * into v from public.character_variants where id = p_variant_id for update;
  if not found then raise exception 'Variant not found'; end if;
  update public.character_variants set status = p_status, approval_note = left(btrim(p_note), 500), approved_by = auth.uid(), approved_at = now() where id = v.id;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v.organization_id, auth.uid(), 'character.variant_' || p_status, 'character_variant', v.id, jsonb_build_object('variant', v.variant_key, 'version', v.version, 'note', left(btrim(p_note), 500)));
  return jsonb_build_object('id', v.id, 'status', p_status);
end;
$$;
revoke all on function public.admin_set_character_variant_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_character_variant_status(uuid, text, text) to authenticated;

insert into public.character_variants(variant_key, version, catalog_character_id, base_spec_version, status, purpose, outfit, expression, approval_note, approved_at)
values ('adam_man.formal_angry', 1, 'adam_man', 1, 'approved',
  'Flagship #1 "The Supernatural Eye", shots 1–2: wealthy family-drama father.',
  jsonb_build_object('key', 'formal',
    'description', 'Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds',
    'colors', jsonb_build_array('#2E3138', '#F4F1EA', '#7A1F2B', '#E0A526'),
    'accessories', jsonb_build_array('gold wristwatch on the LEFT wrist (story prop used in shot 2; generic design, no brand or logo)')),
  jsonb_build_object('key', 'angry',
    'description', 'brows pulled down and together, eyes narrowed, mouth open mid-sentence with a hint of teeth, tense cheeks; strong but family-friendly anger, no distortion of the canonical face layout, no scary features'),
  'Approved by the owner in writing on 2026-10-19 (scene variant only; canonical spec unchanged; no artwork approved).', now())
on conflict (variant_key, version) do nothing;

drop function if exists public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb);
create or replace function public.register_character_reference(
  p_catalog_character_id text, p_custom_character_id uuid, p_object_path text, p_asset_kind text, p_view text,
  p_expression_key text, p_outfit_key text, p_mime_type text, p_size_bytes bigint, p_width integer, p_height integer,
  p_provenance text, p_provenance_note text, p_model_meta jsonb default '{}'::jsonb, p_variant_id uuid default null
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
  v_var public.character_variants%rowtype;
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
  if p_variant_id is not null then
    select * into v_var from public.character_variants where id = p_variant_id;
    if not found or v_var.status <> 'approved' then raise exception 'Variant not approved'; end if;
    if v_var.catalog_character_id is distinct from p_catalog_character_id or v_var.custom_character_id is distinct from p_custom_character_id then raise exception 'Variant belongs to another character'; end if;
    if v_var.base_spec_version <> v_version then raise exception 'Variant was made for another spec version'; end if;
    if nullif(p_expression_key, '') is not null and p_expression_key is distinct from (v_var.expression ->> 'key') then raise exception 'Expression is not part of this variant'; end if;
    if nullif(p_outfit_key, '') is not null and p_outfit_key is distinct from (v_var.outfit ->> 'key') then raise exception 'Outfit is not part of this variant'; end if;
  elsif nullif(p_expression_key, '') is not null and p_expression_key not in ('neutral', 'happy', 'laughing', 'surprised', 'sad', 'thinking', 'determined', 'worried') then
    raise exception 'Expression is not canonical; choose its approved variant';
  end if;
  if left(p_object_path, char_length(v_prefix)) <> v_prefix or p_object_path ~ '\.\.' then raise exception 'Invalid reference path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'character-library' and name = p_object_path) then
    raise exception 'Uploaded file not found';
  end if;
  insert into public.character_reference_assets(
    organization_id, catalog_character_id, custom_character_id, spec_version, asset_kind, view, expression_key, outfit_key,
    object_path, mime_type, size_bytes, width, height, model_meta, provenance, provenance_note, uploaded_by, variant_id
  ) values (
    v_org, p_catalog_character_id, p_custom_character_id, v_version, p_asset_kind, p_view, nullif(p_expression_key, ''), nullif(p_outfit_key, ''),
    p_object_path, p_mime_type, p_size_bytes, p_width, p_height, coalesce(p_model_meta, '{}'::jsonb), p_provenance,
    nullif(left(btrim(coalesce(p_provenance_note, '')), 500), ''), auth.uid(), p_variant_id
  ) returning id into v_id;
  perform public.limo_refresh_reference_status(p_catalog_character_id, p_custom_character_id);
  return v_id;
end;
$function$;

create or replace function public.animation_character_gaps(p_organization_id uuid, p_character text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_custom uuid;
  v_version integer;
  v_view text;
begin
  if p_character like 'custom:%' then
    begin
      v_custom := substring(p_character from 8)::uuid;
    exception when others then return array['unknown_character'];
    end;
    select spec_version into v_version from public.characters where id = v_custom and organization_id = p_organization_id;
    if not found then return array['unknown_character']; end if;
  else
    if not exists (select 1 from public.character_catalog where id = p_character) or p_character in ('limo', 'nova', 'adam') then return array['unknown_character']; end if;
    select max(version) into v_version from public.character_design_specs where character_id = p_character and status = 'approved';
    if v_version is null then v_out := array_append(v_out, 'spec_not_approved'); end if;
  end if;
  foreach v_view in array array['front', 'three_quarter', 'side'] loop
    if not exists (
      select 1 from public.character_reference_assets r
      where r.status = 'approved' and r.asset_kind = 'rendered_reference' and r.view = v_view and r.variant_id is null and r.outfit_key is null
        and (v_version is null or r.spec_version = v_version)
        and ((v_custom is not null and r.custom_character_id = v_custom and r.organization_id = p_organization_id)
          or (v_custom is null and r.catalog_character_id = p_character))
    ) then v_out := array_append(v_out, 'missing_' || v_view); end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.save_animation_shots(p_project_id uuid, p_shots jsonb, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.animation_projects%rowtype;
  s jsonb;
  cur public.animation_shots%rowtype;
  v_ids uuid[] := '{}';
  v_total integer := 0;
  v_chars text[];
  v_refs uuid[];
  v_line jsonb;
  v_ch text;
  v_e text;
  v_changed boolean;
  v_n integer := 0;
  v_expr text[] := array['neutral', 'happy', 'laughing', 'surprised', 'sad', 'thinking', 'determined', 'worried'];
  v_ov jsonb;
  v_dur integer;
  v_vars jsonb;
  v_vkey text;
  v_vexpr text;
begin
  select * into p from public.animation_projects where id = p_project_id for update;
  if not found then raise exception 'Animation project not found'; end if;
  if not public.can_edit_org(p.organization_id) then raise exception 'Not authorized'; end if;
  if p_expected_revision is not null and p_expected_revision <> p.revision then raise exception 'The storyboard changed in another window; reload'; end if;
  if jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 15 then raise exception 'At most 15 shots'; end if;
  for s in select * from jsonb_array_elements(p_shots) loop
    v_n := v_n + 1;
    v_total := v_total + coalesce((s ->> 'duration_seconds')::integer, 0);
    if (s ->> 'duration_seconds')::integer not in (4, 6, 8) then raise exception 'Each shot lasts 4, 6 or 8 seconds'; end if;
    v_chars := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'characters', '[]'::jsonb))), '{}');
    if cardinality(v_chars) > 5 then raise exception 'At most 5 characters per shot'; end if;
    foreach v_ch in array v_chars loop
      if 'unknown_character' = any(public.animation_character_gaps(p.organization_id, v_ch)) then raise exception 'Unknown character %', v_ch; end if;
    end loop;
    for v_line in select * from jsonb_array_elements(coalesce(s -> 'dialogue', '[]'::jsonb)) loop
      if not ((v_line ->> 'speaker') = any(v_chars)) then raise exception 'A speaker must be in the shot'; end if;
      if nullif(btrim(coalesce(v_line ->> 'text', '')), '') is null then raise exception 'Empty dialogue line'; end if;
      -- A line's emotion is canonical, or the expression of the approved variant selected for its speaker.
      if v_line ? 'emotion' and nullif(v_line ->> 'emotion', '') is not null and not ((v_line ->> 'emotion') = any(v_expr) or exists (
          select 1 from public.character_variants cv where cv.status = 'approved' and cv.expression ->> 'key' = v_line ->> 'emotion'
            and cv.variant_key = (coalesce(s -> 'character_variants', '{}'::jsonb) ->> (v_line ->> 'speaker')))) then raise exception 'Unknown expression'; end if;
    end loop;
    v_vars := coalesce(s -> 'character_variants', '{}'::jsonb);
    if jsonb_typeof(v_vars) <> 'object' then raise exception 'Invalid variant'; end if;
    for v_ch, v_vkey in select key, value #>> '{}' from jsonb_each(v_vars) loop
      if not (v_ch = any(v_chars)) or not exists (select 1 from public.character_variants cv where cv.variant_key = v_vkey and cv.status = 'approved'
          and ((cv.catalog_character_id = v_ch) or ('custom:' || cv.custom_character_id::text = v_ch and cv.organization_id = p.organization_id))) then
        raise exception 'Variant is not approved for this character';
      end if;
    end loop;
    for v_ch, v_e in select key, value #>> '{}' from jsonb_each(coalesce(s -> 'expressions', '{}'::jsonb)) loop
      select cv.expression ->> 'key' into v_vexpr from public.character_variants cv where cv.variant_key = (v_vars ->> v_ch) and cv.status = 'approved';
      if not (v_ch = any(v_chars)) or not (v_e = any(v_expr) or coalesce(v_e = v_vexpr, false)) then raise exception 'Invalid expression'; end if;
    end loop;
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'reference_asset_ids', '[]'::jsonb))::uuid), '{}');
    if exists (
      select 1 from unnest(v_refs) rid
      where not exists (
        select 1 from public.character_reference_assets r
        where r.id = rid and r.status = 'approved'
          and (r.variant_id is null or exists (select 1 from public.character_variants cv where cv.id = r.variant_id and cv.status = 'approved'))
          and ((r.catalog_character_id is not null and r.catalog_character_id = any(v_chars))
            or (r.custom_character_id is not null and r.organization_id = p.organization_id and ('custom:' || r.custom_character_id::text) = any(v_chars)))
      )
    ) then raise exception 'References must be approved references of the shot''s characters'; end if;
    -- Post-production: timed text overlays (≤ 5), freeze frame (≤ half the shot), transition into the next shot.
    v_dur := (s ->> 'duration_seconds')::integer * 1000;
    if jsonb_typeof(coalesce(s -> 'overlays', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(s -> 'overlays', '[]'::jsonb)) > 5 then raise exception 'At most 5 text overlays per shot'; end if;
    for v_ov in select * from jsonb_array_elements(coalesce(s -> 'overlays', '[]'::jsonb)) loop
      if char_length(btrim(coalesce(v_ov ->> 'text', ''))) not between 1 and 120 then raise exception 'Overlay text must be 1 to 120 characters'; end if;
      if coalesce((v_ov ->> 'start_ms')::integer, -1) < 0 or coalesce((v_ov ->> 'end_ms')::integer, 0) <= (v_ov ->> 'start_ms')::integer or (v_ov ->> 'end_ms')::integer > v_dur then
        raise exception 'Overlay times must be inside the shot';
      end if;
      if coalesce(v_ov ->> 'position', 'bottom') not in ('top', 'center', 'bottom') or coalesce(v_ov ->> 'size', 'medium') not in ('small', 'medium', 'large')
         or coalesce(v_ov ->> 'style', 'plain') not in ('plain', 'price', 'tagline') then raise exception 'Invalid overlay style'; end if;
    end loop;
    if coalesce((s ->> 'freeze_ms')::integer, 0) < 0 or coalesce((s ->> 'freeze_ms')::integer, 0) > v_dur / 2 then raise exception 'A freeze frame lasts at most half the shot'; end if;
    if coalesce(s ->> 'transition_out', 'cut') not in ('cut', 'fade', 'crossfade', 'slide', 'wipe') then raise exception 'Invalid transition'; end if;
    if s ? 'id' and nullif(s ->> 'id', '') is not null then v_ids := v_ids || (s ->> 'id')::uuid; end if;
  end loop;
  if v_total > public.limo_video_max_duration_ms(p.organization_id) / 1000 then
    raise exception 'Videos are limited to % seconds', public.limo_video_max_duration_ms(p.organization_id) / 1000;
  end if;
  if exists (select 1 from public.animation_shots where project_id = p.id and status in ('keyframe_queued', 'clip_queued') and not (id = any(v_ids))) then
    raise exception 'A shot that is being generated cannot be removed';
  end if;
  delete from public.animation_shots where project_id = p.id and not (id = any(v_ids));

  v_n := 0;
  for s in select * from jsonb_array_elements(p_shots) loop
    v_n := v_n + 1;
    v_chars := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'characters', '[]'::jsonb))), '{}');
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'reference_asset_ids', '[]'::jsonb))::uuid), '{}');
    cur := null;
    if s ? 'id' and nullif(s ->> 'id', '') is not null then
      select * into cur from public.animation_shots where id = (s ->> 'id')::uuid and project_id = p.id for update;
      if cur.id is null then raise exception 'Shot not found'; end if;
    end if;
    if cur.id is null then
      insert into public.animation_shots(project_id, organization_id, shot_number, duration_seconds, description, environment, camera, characters, actions, expressions,
                                         dialogue, narration, sound, continuity, reference_asset_ids, clip_audio, overlays, freeze_ms, transition_out, character_variants)
      values (p.id, p.organization_id, v_n, (s ->> 'duration_seconds')::integer, coalesce(s ->> 'description', ''), coalesce(s ->> 'environment', ''), coalesce(s ->> 'camera', ''),
              v_chars, coalesce(s -> 'actions', '{}'::jsonb), coalesce(s -> 'expressions', '{}'::jsonb), coalesce(s -> 'dialogue', '[]'::jsonb), coalesce(s ->> 'narration', ''),
              coalesce(s ->> 'sound', ''), coalesce(s -> 'continuity', '{}'::jsonb), v_refs, coalesce(nullif(s ->> 'clip_audio', ''), 'keep'),
              coalesce(s -> 'overlays', '[]'::jsonb), coalesce((s ->> 'freeze_ms')::integer, 0), coalesce(nullif(s ->> 'transition_out', ''), 'cut'),
              coalesce(s -> 'character_variants', '{}'::jsonb))
      returning * into cur;
      perform public.animation_log(cur, 'created', null, null, null);
    else
      v_changed := cur.duration_seconds <> (s ->> 'duration_seconds')::integer or cur.description <> coalesce(s ->> 'description', '') or cur.environment <> coalesce(s ->> 'environment', '')
        or cur.camera <> coalesce(s ->> 'camera', '') or cur.characters <> v_chars or cur.actions <> coalesce(s -> 'actions', '{}'::jsonb)
        or cur.expressions <> coalesce(s -> 'expressions', '{}'::jsonb) or cur.dialogue <> coalesce(s -> 'dialogue', '[]'::jsonb) or cur.narration <> coalesce(s ->> 'narration', '')
        or cur.sound <> coalesce(s ->> 'sound', '') or cur.continuity <> coalesce(s -> 'continuity', '{}'::jsonb) or cur.reference_asset_ids <> v_refs
        or cur.character_variants <> coalesce(s -> 'character_variants', '{}'::jsonb);
      if v_changed and cur.status in ('keyframe_queued', 'clip_queued') then raise exception 'Shot % is being generated', cur.shot_number; end if;
      update public.animation_shots set shot_number = v_n, duration_seconds = (s ->> 'duration_seconds')::integer, description = coalesce(s ->> 'description', ''),
        environment = coalesce(s ->> 'environment', ''), camera = coalesce(s ->> 'camera', ''), characters = v_chars, actions = coalesce(s -> 'actions', '{}'::jsonb),
        expressions = coalesce(s -> 'expressions', '{}'::jsonb), dialogue = coalesce(s -> 'dialogue', '[]'::jsonb), narration = coalesce(s ->> 'narration', ''),
        sound = coalesce(s ->> 'sound', ''), continuity = coalesce(s -> 'continuity', '{}'::jsonb), reference_asset_ids = v_refs,
        clip_audio = coalesce(nullif(s ->> 'clip_audio', ''), clip_audio),
        overlays = coalesce(s -> 'overlays', '[]'::jsonb), freeze_ms = coalesce((s ->> 'freeze_ms')::integer, 0),
        character_variants = coalesce(s -> 'character_variants', '{}'::jsonb),
        transition_out = coalesce(nullif(s ->> 'transition_out', ''), 'cut'),
        media_source = case when v_changed then 'ai' else media_source end,
        status = case when v_changed then 'draft' else status end,
        keyframe_asset_id = case when v_changed then null else keyframe_asset_id end,
        first_frame_asset_id = case when v_changed then null else first_frame_asset_id end,
        clip_asset_id = case when v_changed then null else clip_asset_id end,
        voice_tracks = case when v_changed then '[]'::jsonb else voice_tracks end,
        revision = revision + case when v_changed then 1 else 0 end,
        updated_at = now()
      where id = cur.id returning * into cur;
      if v_changed then perform public.animation_log(cur, 'edited', null, null, null); end if;
    end if;
  end loop;
  update public.animation_projects set revision = revision + 1, updated_at = now(),
    status = case when status = 'archived' then status when exists (select 1 from public.animation_shots where project_id = p.id and status <> 'draft') then 'in_production' else 'draft' end
  where id = p.id returning * into p;
  return jsonb_build_object('id', p.id, 'revision', p.revision, 'total_seconds', v_total);
end;
$$;

create or replace function public.request_animation_job(p_shot_id uuid, p_kind text, p_request_key text, p_confirmed_cents integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.animation_shots%rowtype;
  p public.animation_projects%rowtype;
  j public.ai_jobs%rowtype;
  v_ch text;
  v_gaps text[];
  v_vkey text;
begin
  select * into s from public.animation_shots where id = p_shot_id for update;
  if not found then raise exception 'Shot not found'; end if;
  if not public.can_edit_org(s.organization_id) then raise exception 'Not authorized'; end if;
  if p_kind not in ('animation_keyframe', 'animation_clip', 'animation_voice') then raise exception 'Invalid job'; end if;
  select * into j from public.ai_jobs where organization_id = s.organization_id and request_key = p_request_key;
  if found then return jsonb_build_object('id', j.id, 'status', j.status, 'reused', true); end if;
  if not public.animation_flag('animation_generation') then raise exception 'AI animation is not enabled'; end if;
  select * into p from public.animation_projects where id = s.project_id;
  foreach v_ch in array s.characters loop
    v_gaps := public.animation_character_gaps(s.organization_id, v_ch);
    if cardinality(v_gaps) > 0 then raise exception 'Character % is not ready: %', v_ch, array_to_string(v_gaps, ', '); end if;
  end loop;
  for v_ch, v_vkey in select key, value #>> '{}' from jsonb_each(s.character_variants) loop
    if not exists (select 1 from public.character_reference_assets r join public.character_variants cv on cv.id = r.variant_id
                   where cv.variant_key = v_vkey and cv.status = 'approved' and r.status = 'approved' and r.view = 'front') then
      raise exception 'Character % is not ready: missing_variant_front (%)', v_ch, v_vkey;
    end if;
  end loop;
  if p_kind = 'animation_keyframe' and s.status not in ('draft', 'keyframe_review') then raise exception 'This shot already has an approved keyframe'; end if;
  if p_kind = 'animation_clip' and (s.status <> 'keyframe_approved' or s.first_frame_asset_id is null) then raise exception 'Approve the keyframe first'; end if;
  if p_kind = 'animation_voice' and jsonb_array_length(s.dialogue) = 0 and s.narration = '' then raise exception 'Nothing to speak in this shot'; end if;
  if exists (select 1 from public.ai_jobs where shot_id = s.id and kind = p_kind and status in ('queued', 'processing', 'waiting_provider')) then raise exception 'Already in progress'; end if;
  -- Cost control: at most 5 attempts per job kind for one revision of a shot (edit the shot to start a new revision).
  if (select count(*) from public.ai_jobs where shot_id = s.id and kind = p_kind and shot_revision = s.revision and status <> 'cancelled') >= 5 then
    raise exception 'Attempt limit reached for this shot (5)';
  end if;
  update public.animation_shots set attempts = jsonb_set(attempts, array[p_kind], to_jsonb(coalesce((attempts ->> p_kind)::integer, 0) + 1)) where id = s.id returning * into s;
  insert into public.ai_jobs(organization_id, requested_by, kind, shot_id, shot_revision, request_key, input, confirmed_cents)
  values (s.organization_id, auth.uid(), p_kind, s.id, s.revision, p_request_key,
          jsonb_build_object('project_id', p.id, 'language', p.language_code, 'aspect', p.aspect), greatest(0, coalesce(p_confirmed_cents, 0)))
  returning * into j;
  if p_kind = 'animation_keyframe' then update public.animation_shots set status = 'keyframe_queued', last_error = null, updated_at = now() where id = s.id returning * into s;
  elsif p_kind = 'animation_clip' then update public.animation_shots set status = 'clip_queued', last_error = null, updated_at = now() where id = s.id returning * into s;
  end if;
  perform public.animation_log(s, 'job_requested', replace(p_kind, 'animation_', ''), null, null);
  return jsonb_build_object('id', j.id, 'status', j.status, 'reused', false);
end;
$$;

revoke all on function public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb, uuid) from public, anon;
grant execute on function public.register_character_reference(text, uuid, text, text, text, text, text, text, bigint, integer, integer, text, text, jsonb, uuid) to authenticated;
