-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.studio_projects add column if not exists estimated_slots integer not null default 1 check (estimated_slots between 1 and 100);
alter table public.studio_projects add column if not exists total_duration_seconds integer not null default 0 check (total_duration_seconds between 0 and 3600);

create or replace function public.save_studio_project(
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_content_type text,
  p_language_code text,
  p_brief text,
  p_goal text,
  p_visual_style text,
  p_series_id uuid,
  p_continuation_mode boolean,
  p_project_cast jsonb,
  p_scenes jsonb,
  p_export_presets text[]
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project_id uuid;
  v_cast_count integer;
  v_scene_count integer;
  v_total_duration integer;
  v_valid_cast_count integer;
  v_cast_ids text[];
  v_scene jsonb;
  v_scene_number integer;
  v_duration integer;
  v_participants text[];
  v_invalid_participant text;
  v_preset text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;

  perform 1 from public.organization_subscriptions
  where organization_id=p_organization_id and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  if char_length(btrim(coalesce(p_title,''))) not between 1 and 200 then raise exception 'Project title required'; end if;
  if not exists(select 1 from public.content_type_catalog where code=p_content_type and active=true) then raise exception 'Invalid content type'; end if;
  if not exists(select 1 from public.language_catalog where code=p_language_code and active=true) then raise exception 'Invalid language'; end if;
  if p_series_id is not null and not exists(
    select 1 from public.content_series
    where id=p_series_id and organization_id=p_organization_id
  ) then raise exception 'Series does not belong to this workspace'; end if;

  if jsonb_typeof(p_project_cast)<>'array' then raise exception 'Project cast must be an array'; end if;
  v_cast_count:=jsonb_array_length(p_project_cast);
  if v_cast_count<1 or v_cast_count>3 then raise exception 'Choose between 1 and 3 characters'; end if;

  select array_agg(distinct elem->>'id') into v_cast_ids
  from jsonb_array_elements(p_project_cast) elem
  where nullif(elem->>'id','') is not null;

  if coalesce(cardinality(v_cast_ids),0)<>v_cast_count then raise exception 'Character IDs must be unique and present'; end if;

  select count(*) into v_valid_cast_count
  from public.character_catalog c
  where c.active=true and c.id=any(v_cast_ids);

  if v_valid_cast_count<>v_cast_count then raise exception 'One or more characters are unavailable'; end if;

  if jsonb_typeof(p_scenes)<>'array' then raise exception 'Scenes must be an array'; end if;
  v_scene_count:=jsonb_array_length(p_scenes);
  if v_scene_count<1 or v_scene_count>25 then raise exception 'A project must contain 1 to 25 scenes'; end if;

  v_total_duration:=0;
  for v_scene in select value from jsonb_array_elements(p_scenes)
  loop
    v_scene_number:=coalesce((v_scene->>'scene_number')::integer,0);
    v_duration:=coalesce((v_scene->>'duration_seconds')::integer,0);
    if v_scene_number<1 or v_scene_number>25 then raise exception 'Invalid scene number'; end if;
    if v_duration<1 or v_duration>120 then raise exception 'Scene duration must be 1 to 120 seconds'; end if;
    v_total_duration:=v_total_duration+v_duration;
    if v_total_duration>600 then raise exception 'Customer MVP projects are limited to 10 minutes per draft'; end if;

    select coalesce(array_agg(x),array[]::text[]) into v_participants
    from jsonb_array_elements_text(coalesce(v_scene->'participants','[]'::jsonb)) x;

    select x into v_invalid_participant
    from unnest(v_participants) x
    where not (x=any(v_cast_ids))
    limit 1;

    if v_invalid_participant is not null then
      raise exception 'Scene participant % is not in the project cast',v_invalid_participant;
    end if;
  end loop;

  if (select count(distinct (x->>'scene_number')::integer) from jsonb_array_elements(p_scenes) x)<>v_scene_count then
    raise exception 'Scene numbers must be unique';
  end if;

  if p_project_id is null then
    insert into public.studio_projects(
      organization_id,title,content_type,language_code,brief,goal,visual_style,series_id,
      continuation_mode,project_cast,status,total_duration_seconds,estimated_slots,created_by
    ) values(
      p_organization_id,left(btrim(p_title),200),p_content_type,p_language_code,
      left(coalesce(p_brief,''),8000),left(coalesce(p_goal,''),1000),left(coalesce(p_visual_style,''),1000),
      p_series_id,coalesce(p_continuation_mode,false),p_project_cast,'draft',v_total_duration,
      greatest(1,ceil(v_total_duration::numeric/45)::integer),auth.uid()
    ) returning id into v_project_id;
  else
    update public.studio_projects set
      title=left(btrim(p_title),200),
      content_type=p_content_type,
      language_code=p_language_code,
      brief=left(coalesce(p_brief,''),8000),
      goal=left(coalesce(p_goal,''),1000),
      visual_style=left(coalesce(p_visual_style,''),1000),
      series_id=p_series_id,
      continuation_mode=coalesce(p_continuation_mode,false),
      project_cast=p_project_cast,
      total_duration_seconds=v_total_duration,
      estimated_slots=greatest(1,ceil(v_total_duration::numeric/45)::integer),
      updated_at=now()
    where id=p_project_id and organization_id=p_organization_id and status in ('draft','ready')
    returning id into v_project_id;
    if v_project_id is null then raise exception 'Project not found or no longer editable'; end if;
    delete from public.project_scenes where project_id=v_project_id;
    delete from public.project_export_choices where project_id=v_project_id;
  end if;

  for v_scene in select value from jsonb_array_elements(p_scenes)
  loop
    insert into public.project_scenes(
      project_id,organization_id,scene_number,title,duration_seconds,location_prompt,environment_prompt,
      camera_prompt,lighting_prompt,action_prompt,dialogue,on_screen_text,effects_prompt,music_prompt,
      participants,transition_out,continuity_notes
    ) values(
      v_project_id,p_organization_id,(v_scene->>'scene_number')::integer,
      nullif(left(coalesce(v_scene->>'title',''),200),''),
      (v_scene->>'duration_seconds')::integer,
      nullif(left(coalesce(v_scene->>'location_prompt',''),1500),''),
      nullif(left(coalesce(v_scene->>'environment_prompt',''),1500),''),
      nullif(left(coalesce(v_scene->>'camera_prompt',''),1000),''),
      nullif(left(coalesce(v_scene->>'lighting_prompt',''),1000),''),
      nullif(left(coalesce(v_scene->>'action_prompt',''),2500),''),
      nullif(left(coalesce(v_scene->>'dialogue',''),4000),''),
      nullif(left(coalesce(v_scene->>'on_screen_text',''),1500),''),
      nullif(left(coalesce(v_scene->>'effects_prompt',''),1500),''),
      nullif(left(coalesce(v_scene->>'music_prompt',''),1000),''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_scene->'participants','[]'::jsonb)) x),array[]::text[]),
      nullif(left(coalesce(v_scene->>'transition_out',''),500),''),
      nullif(left(coalesce(v_scene->>'continuity_notes',''),1500),'')
    );
  end loop;

  if p_export_presets is not null then
    foreach v_preset in array p_export_presets loop
      if not exists(select 1 from public.export_presets where code=v_preset and active=true) then
        raise exception 'Invalid export preset %',v_preset;
      end if;
      insert into public.project_export_choices(project_id,organization_id,preset_code)
      values(v_project_id,p_organization_id,v_preset)
      on conflict(project_id,preset_code) do nothing;
    end loop;
  end if;

  return v_project_id;
end;
$$;

revoke all on function public.save_studio_project(uuid,uuid,text,text,text,text,text,text,uuid,boolean,jsonb,jsonb,text[]) from public,anon;
grant execute on function public.save_studio_project(uuid,uuid,text,text,text,text,text,text,uuid,boolean,jsonb,jsonb,text[]) to authenticated,service_role;
