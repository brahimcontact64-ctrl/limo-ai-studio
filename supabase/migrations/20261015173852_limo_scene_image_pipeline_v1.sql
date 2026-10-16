-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.generation_run_stages
  drop constraint generation_run_stages_stage_type_check;
alter table public.generation_run_stages
  add constraint generation_run_stages_stage_type_check
  check(stage_type in ('safety','script','voice','scene_image','scene_video','render','export'));

alter table public.ai_provider_registry
  drop constraint ai_provider_registry_stage_type_check;
alter table public.ai_provider_registry
  add constraint ai_provider_registry_stage_type_check
  check(stage_type in ('safety','script','voice','scene_image','scene_video','render','export'));

alter table public.generation_cost_policies
  add column if not exists image_per_scene_cents integer not null default 0
  check(image_per_scene_cents>=0);

update public.generation_cost_policies
set image_per_scene_cents=2
where code='standard_v1';

insert into public.ai_provider_registry(
 code,provider,stage_type,model_id,credential_env_key,enabled,is_default,
 pricing_unit,pricing_metadata,official_reference,verified_at
) values (
 'runway_image_standard_v1','runway','scene_image','gen4_image_turbo','RUNWAYML_API_SECRET',
 false,true,'request',
 '{"credits_per_image":2,"usd_per_credit":0.01,"api_version":"2024-11-06","purpose":"scene_reference_frame"}'::jsonb,
 'https://docs.dev.runwayml.com/guides/pricing/',now()
)
on conflict(code) do update set
 provider=excluded.provider,stage_type=excluded.stage_type,model_id=excluded.model_id,
 credential_env_key=excluded.credential_env_key,pricing_unit=excluded.pricing_unit,
 pricing_metadata=excluded.pricing_metadata,official_reference=excluded.official_reference,
 verified_at=excluded.verified_at,updated_at=now();

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
  if new.status<>'awaiting_safety' then return new; end if;

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

  select coalesce(
    jsonb_object_agg(
      p.stage_type,
      jsonb_build_object(
        'code',p.code,'provider',p.provider,'model_id',p.model_id,
        'pricing_unit',p.pricing_unit,'pricing_metadata',p.pricing_metadata,
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

create or replace function public.claim_generation_stages(
  p_worker_id text,
  p_stage_type text default null,
  p_limit integer default 5
)
returns setof public.generation_run_stages
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
  if p_limit<1 or p_limit>25 then raise exception 'Invalid claim limit'; end if;
  if p_stage_type is not null
     and p_stage_type not in ('safety','script','voice','scene_image','scene_video','render','export')
  then raise exception 'Invalid stage type'; end if;

  return query
  with picked as (
    select s.id
    from public.generation_run_stages s
    join public.generation_runs r on r.id=s.run_id
    where s.status='ready'
      and (p_stage_type is null or s.stage_type=p_stage_type)
      and (
        (s.stage_type='safety' and r.status='awaiting_safety')
        or
        (s.stage_type<>'safety' and r.status='processing')
      )
    order by s.sort_order,s.created_at
    for update of s skip locked
    limit p_limit
  )
  update public.generation_run_stages s
  set status='processing',locked_at=now(),locked_by=left(p_worker_id,120),
      attempt_count=s.attempt_count+1,updated_at=now()
  from picked
  where s.id=picked.id
  returning s.*;
end;
$$;

create or replace function public.request_studio_generation(
  p_project_id uuid,
  p_request_key text,
  p_policy_code text default 'standard_v1'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.studio_projects%rowtype;
  v_policy public.generation_cost_policies%rowtype;
  v_existing uuid;
  v_run_id uuid;
  v_job_id uuid;
  v_reservation_id uuid;
  v_slots integer;
  v_voice_minutes integer;
  v_scene_count integer;
  v_base_cost bigint;
  v_estimated_cost integer;
  v_scene record;
  v_export record;
  v_has_dialogue boolean;
  v_order integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_project_id is null then raise exception 'Project required'; end if;
  if p_request_key is null or btrim(p_request_key)='' or char_length(p_request_key)>160 then
    raise exception 'Invalid request key';
  end if;

  select * into v_project
  from public.studio_projects
  where id=p_project_id
  for update;

  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_project.organization_id) then raise exception 'Not authorized'; end if;

  select id into v_existing
  from public.generation_runs
  where organization_id=v_project.organization_id and request_key=p_request_key;
  if found then return v_existing; end if;

  perform 1 from public.organization_subscriptions
  where organization_id=v_project.organization_id
    and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  if v_project.status not in ('draft','ready') then
    raise exception 'Project is not ready for a new generation request';
  end if;

  select count(*) into v_scene_count
  from public.project_scenes where project_id=p_project_id;
  if v_scene_count<1 then raise exception 'Project has no scenes'; end if;

  v_slots:=greatest(1,ceil(v_project.total_duration_seconds::numeric/30)::integer);
  if v_slots>100 then raise exception 'Project exceeds generation slot limit'; end if;

  select * into v_policy
  from public.generation_cost_policies
  where code=p_policy_code;
  if not found then raise exception 'Generation cost policy not found'; end if;
  if not v_policy.enabled or v_policy.verified_at is null then
    raise exception 'Generation providers are not enabled yet';
  end if;

  v_voice_minutes:=greatest(1,ceil(v_project.total_duration_seconds::numeric/60)::integer);
  v_base_cost :=
      v_policy.script_flat_cents::bigint
    + (v_voice_minutes::bigint*v_policy.voice_per_minute_cents::bigint)
    + (v_scene_count::bigint*v_policy.image_per_scene_cents::bigint)
    + (v_project.total_duration_seconds::bigint*v_policy.video_per_second_cents::bigint)
    + v_policy.render_flat_cents::bigint;

  if v_base_cost<=0 then raise exception 'Generation cost policy is invalid'; end if;

  v_estimated_cost:=ceil(
    (v_base_cost::numeric*(100+v_policy.retry_buffer_percent)::numeric)/100
  )::integer;
  if v_estimated_cost<=0 then raise exception 'Invalid generation estimate'; end if;

  v_reservation_id:=public.reserve_ai_budget(
    v_project.organization_id,'gen:'||p_request_key,v_estimated_cost
  );

  v_job_id:=public.enqueue_content_job(
    v_project.organization_id,'gen:'||p_request_key,'video',v_slots,
    'studio_video_generation',
    jsonb_build_object(
      'project_id',v_project.id,
      'language_code',v_project.language_code,
      'total_duration_seconds',v_project.total_duration_seconds,
      'slots_reserved',v_slots,
      'continuation_mode',v_project.continuation_mode,
      'series_id',v_project.series_id,
      'scene_count',v_scene_count
    )
  );

  insert into public.generation_runs(
    organization_id,project_id,requested_by,request_key,status,cost_policy_code,
    slots_reserved,estimated_cost_cents,ai_reservation_id,root_job_id
  )
  values(
    v_project.organization_id,v_project.id,auth.uid(),p_request_key,'awaiting_safety',
    v_policy.code,v_slots,v_estimated_cost,v_reservation_id,v_job_id
  )
  returning id into v_run_id;

  update public.content_jobs
  set payload=payload||jsonb_build_object('generation_run_id',v_run_id)
  where id=v_job_id;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(v_run_id,v_project.organization_id,'safety','safety',0,'ready',0);

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'script','script',10,'pending',
    v_policy.script_flat_cents
  );

  select exists(
    select 1 from public.project_scenes
    where project_id=p_project_id
      and nullif(btrim(coalesce(dialogue,'')),'') is not null
  ) into v_has_dialogue;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'voice','voice',20,
    case when v_has_dialogue then 'pending' else 'skipped' end,
    case when v_has_dialogue then v_voice_minutes*v_policy.voice_per_minute_cents else 0 end
  );

  for v_scene in
    select scene_number,duration_seconds
    from public.project_scenes
    where project_id=p_project_id
    order by scene_number
  loop
    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      scene_number,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'scene-image:'||v_scene.scene_number::text,
      'scene_image',50+v_scene.scene_number,'pending',
      v_scene.scene_number,v_policy.image_per_scene_cents
    );

    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      scene_number,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'scene-video:'||v_scene.scene_number::text,
      'scene_video',100+v_scene.scene_number,'pending',
      v_scene.scene_number,v_scene.duration_seconds*v_policy.video_per_second_cents
    );
  end loop;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'render','render',500,'pending',
    v_policy.render_flat_cents
  );

  v_order:=0;
  for v_export in
    select preset_code from public.project_export_choices
    where project_id=p_project_id order by preset_code
  loop
    v_order:=v_order+1;
    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      preset_code,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'export:'||v_export.preset_code,'export',600+v_order,'pending',
      v_export.preset_code,0
    );
  end loop;

  update public.studio_projects
  set status='queued',last_generation_run_id=v_run_id,
      estimated_slots=v_slots,updated_at=now()
  where id=p_project_id;

  return v_run_id;
end;
$$;

create or replace function public.complete_generation_stage(
  p_stage_id uuid,
  p_provider text,
  p_provider_job_id text,
  p_actual_cost_cents integer default 0,
  p_output_asset_id uuid default null,
  p_output_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stage public.generation_run_stages%rowtype;
  v_run public.generation_runs%rowtype;
  v_total_actual integer;
  v_budget_result text;
  v_incomplete integer;
begin
  if p_actual_cost_cents<0 then raise exception 'Invalid provider cost'; end if;

  select * into v_stage
  from public.generation_run_stages
  where id=p_stage_id for update;

  if not found then raise exception 'Stage not found'; end if;
  if v_stage.status<>'processing' then raise exception 'Stage not processing'; end if;
  if v_stage.stage_type='safety' then raise exception 'Use safety decision function'; end if;

  select * into v_run
  from public.generation_runs
  where id=v_stage.run_id for update;

  if v_run.status<>'processing' then raise exception 'Run not processing'; end if;

  if p_output_asset_id is not null and not exists(
    select 1 from public.media_assets
    where id=p_output_asset_id and organization_id=v_run.organization_id
  ) then
    raise exception 'Output asset does not belong to this workspace';
  end if;

  update public.generation_run_stages
  set status='completed',
      provider=left(coalesce(p_provider,''),80),
      provider_job_id=left(coalesce(p_provider_job_id,''),200),
      actual_cost_cents=p_actual_cost_cents,
      output_asset_id=p_output_asset_id,
      output_payload=coalesce(p_output_payload,'{}'::jsonb),
      updated_at=now()
  where id=p_stage_id;

  if v_stage.stage_type='script' then
    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='voice' and status='pending';

    if not exists(
      select 1 from public.generation_run_stages
      where run_id=v_run.id and stage_type='voice' and status<>'skipped'
    ) then
      update public.generation_run_stages
      set status='ready',updated_at=now()
      where run_id=v_run.id and stage_type='scene_image' and status='pending';
    end if;

  elsif v_stage.stage_type='voice' then
    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='scene_image' and status='pending';

  elsif v_stage.stage_type='scene_image' then
    select count(*) into v_incomplete
    from public.generation_run_stages
    where run_id=v_run.id and stage_type='scene_image'
      and status not in ('completed','skipped');

    if v_incomplete=0 then
      update public.generation_run_stages
      set status='ready',updated_at=now()
      where run_id=v_run.id and stage_type='scene_video' and status='pending';
    end if;

  elsif v_stage.stage_type='scene_video' then
    select count(*) into v_incomplete
    from public.generation_run_stages
    where run_id=v_run.id and stage_type='scene_video'
      and status not in ('completed','skipped');

    if v_incomplete=0 then
      update public.generation_run_stages
      set status='ready',updated_at=now()
      where run_id=v_run.id and stage_type='render' and status='pending';
    end if;

  elsif v_stage.stage_type='render' then
    if p_output_asset_id is not null then
      update public.studio_projects
      set master_asset_id=p_output_asset_id,updated_at=now()
      where id=v_run.project_id;
    end if;

    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='export' and status='pending';
  end if;

  select count(*) into v_incomplete
  from public.generation_run_stages
  where run_id=v_run.id and stage_type<>'safety'
    and status not in ('completed','skipped');

  if v_incomplete=0 then
    select coalesce(sum(actual_cost_cents),0)::integer
    into v_total_actual
    from public.generation_run_stages
    where run_id=v_run.id;

    perform public.complete_content_job(
      v_run.root_job_id,'limo-orchestrator',v_run.id::text,v_total_actual
    );

    v_budget_result:=public.settle_ai_budget(
      v_run.ai_reservation_id,'completed',v_total_actual
    );

    update public.generation_runs
    set status=case when v_budget_result='needs_reconciliation'
                    then 'needs_reconciliation' else 'completed' end,
        actual_cost_cents=v_total_actual,completed_at=now(),updated_at=now()
    where id=v_run.id;

    update public.studio_projects
    set status='generated',updated_at=now()
    where id=v_run.project_id;

    return case when v_budget_result='needs_reconciliation'
                then 'completed_needs_reconciliation' else 'run_completed' end;
  end if;

  return 'stage_completed';
end;
$$;

revoke all on function public.claim_generation_stages(text,text,integer)
from public,anon,authenticated;
grant execute on function public.claim_generation_stages(text,text,integer) to service_role;

revoke all on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb)
to service_role;
