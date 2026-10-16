-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.guard_generation_run_provider_readiness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_has_dialogue boolean;
  v_has_exports boolean;
  v_snapshot jsonb;
  v_missing text[];
begin
  if new.status<>'awaiting_safety' then
    return new;
  end if;

  if not exists(
    select 1 from public.generation_cost_policies p
    where p.code=new.cost_policy_code
      and p.enabled=true
      and p.verified_at is not null
  ) then
    raise exception 'Generation cost policy is not enabled and verified';
  end if;

  select exists(
    select 1 from public.project_scenes s
    where s.project_id=new.project_id
      and nullif(btrim(coalesce(s.dialogue,'')),'') is not null
  ) into v_has_dialogue;

  select exists(
    select 1 from public.project_export_choices e
    where e.project_id=new.project_id
  ) into v_has_exports;

  with required(stage_type) as (
    values ('safety'::text),('script'::text),('scene_video'::text),('render'::text)
    union all
    select 'voice' where v_has_dialogue
    union all
    select 'export' where v_has_exports
  )
  select array_agg(r.stage_type order by r.stage_type)
  into v_missing
  from required r
  where not exists(
    select 1
    from public.ai_provider_registry p
    where p.stage_type=r.stage_type
      and p.enabled=true
      and p.is_default=true
      and p.verified_at is not null
  );

  if coalesce(cardinality(v_missing),0)>0 then
    raise exception 'Generation providers are not enabled yet: %',
      array_to_string(v_missing,', ');
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
      p.stage_type in ('safety','script','scene_video','render')
      or (p.stage_type='voice' and v_has_dialogue)
      or (p.stage_type='export' and v_has_exports)
    );

  new.provider_snapshot:=v_snapshot;
  return new;
end;
$$;

drop trigger if exists trg_generation_provider_readiness on public.generation_runs;
create trigger trg_generation_provider_readiness
before insert on public.generation_runs
for each row execute function public.guard_generation_run_provider_readiness();

revoke execute on function public.guard_generation_run_provider_readiness()
from public,anon,authenticated;
