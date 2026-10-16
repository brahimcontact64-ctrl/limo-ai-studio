-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.guard_project_scene_duration_v1()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.duration_seconds<1 or new.duration_seconds>15 then
    raise exception 'Each scene must be between 1 and 15 seconds in LIMO v1';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_scene_duration_v1 on public.project_scenes;
create trigger trg_project_scene_duration_v1
before insert or update of duration_seconds on public.project_scenes
for each row execute function public.guard_project_scene_duration_v1();

revoke execute on function public.guard_project_scene_duration_v1()
from public,anon,authenticated;

update public.ai_provider_registry
set is_default=false,updated_at=now()
where stage_type='scene_video' and is_default=true;

insert into public.ai_provider_registry(
 code,provider,stage_type,model_id,credential_env_key,enabled,is_default,
 pricing_unit,pricing_metadata,official_reference,verified_at
) values (
 'runway_video_economy_v1',
 'runway',
 'scene_video',
 'grok_imagine_1_5_lite',
 'RUNWAYML_API_SECRET',
 false,
 true,
 'second',
 '{"resolution":"720p","credits_per_second":3,"start_frame_credits":1,"usd_per_credit":0.01,"max_duration_seconds":15,"api_version":"2024-11-06"}'::jsonb,
 'https://docs.dev.runwayml.com/api-details/api_changelog/',
 now()
)
on conflict(code) do update set
 provider=excluded.provider,
 stage_type=excluded.stage_type,
 model_id=excluded.model_id,
 credential_env_key=excluded.credential_env_key,
 pricing_unit=excluded.pricing_unit,
 pricing_metadata=excluded.pricing_metadata,
 official_reference=excluded.official_reference,
 verified_at=excluded.verified_at,
 is_default=true,
 updated_at=now();

create or replace function public.guard_generation_run_provider_readiness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.studio_projects%rowtype;
  v_has_dialogue boolean;
  v_has_exports boolean;
  v_snapshot jsonb;
  v_missing text[];
  v_character_id text;
begin
  if new.status<>'awaiting_safety' then return new; end if;

  select * into v_project
  from public.studio_projects
  where id=new.project_id;

  if not found then raise exception 'Project not found for generation readiness'; end if;

  if not exists(
    select 1 from public.generation_cost_policies p
    where p.code=new.cost_policy_code and p.enabled=true and p.verified_at is not null
  ) then
    raise exception 'Generation cost policy is not enabled and verified';
  end if;

  select exists(
    select 1 from public.project_scenes s
    where s.project_id=new.project_id
      and nullif(btrim(coalesce(s.dialogue,'')),'') is not null
  ) into v_has_dialogue;

  select exists(
    select 1 from public.project_export_choices e where e.project_id=new.project_id
  ) into v_has_exports;

  with required(stage_type) as (
    values ('safety'::text),('script'::text),('scene_image'::text),
           ('scene_video'::text),('render'::text)
    union all select 'voice' where v_has_dialogue
    union all select 'export' where v_has_exports
  )
  select array_agg(r.stage_type order by r.stage_type)
  into v_missing
  from required r
  where not exists(
    select 1 from public.ai_provider_registry p
    where p.stage_type=r.stage_type
      and p.enabled=true and p.is_default=true and p.verified_at is not null
  );

  if coalesce(cardinality(v_missing),0)>0 then
    raise exception 'Generation providers are not enabled yet: %',
      array_to_string(v_missing,', ');
  end if;

  select elem->>'id'
  into v_character_id
  from jsonb_array_elements(v_project.project_cast) elem
  left join public.character_catalog c on c.id=elem->>'id'
  where c.id is null
     or nullif(btrim(coalesce(c.visual_ref,'')),'') is null
  limit 1;

  if v_character_id is not null then
    raise exception 'Character visual reference is not configured: %',v_character_id;
  end if;

  if v_has_dialogue then
    select elem->>'id'
    into v_character_id
    from jsonb_array_elements(v_project.project_cast) elem
    join public.character_catalog c on c.id=elem->>'id'
    where nullif(btrim(coalesce(c.voice_ref,'')),'') is null
      and not exists(
        select 1
        from public.character_voice_profiles vp
        where vp.character_id=c.id
          and vp.language_code=v_project.language_code
          and vp.active=true
          and nullif(btrim(vp.voice_ref),'') is not null
      )
    limit 1;

    if v_character_id is not null then
      raise exception 'Character voice is not configured: %',v_character_id;
    end if;
  end if;

  select coalesce(
    jsonb_object_agg(
      p.stage_type,
      jsonb_build_object(
        'code',p.code,
        'provider',p.provider,
        'model_id',p.model_id,
        'pricing_unit',p.pricing_unit,
        'pricing_metadata',p.pricing_metadata,
        'verified_at',p.verified_at
      )
    ),
    '{}'::jsonb
  )
  into v_snapshot
  from public.ai_provider_registry p
  where p.enabled=true and p.is_default=true
    and (
      p.stage_type in ('safety','script','scene_image','scene_video','render')
      or (p.stage_type='voice' and v_has_dialogue)
      or (p.stage_type='export' and v_has_exports)
    );

  new.provider_snapshot:=v_snapshot;
  return new;
end;
$$;

revoke execute on function public.guard_generation_run_provider_readiness()
from public,anon,authenticated;
