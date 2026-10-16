-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.studio_projects
  add column if not exists last_generation_run_id uuid;

alter table public.studio_projects
  drop constraint if exists studio_projects_last_generation_run_id_fkey;

alter table public.studio_projects
  add constraint studio_projects_last_generation_run_id_fkey
  foreign key(last_generation_run_id)
  references public.generation_runs(id)
  on delete set null;

create index if not exists studio_projects_last_generation_run_idx
  on public.studio_projects(last_generation_run_id);

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
  where organization_id=v_project.organization_id
    and request_key=p_request_key;

  if found then return v_existing; end if;

  perform 1
  from public.organization_subscriptions
  where organization_id=v_project.organization_id
    and status='active'
    and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  if v_project.status not in ('draft','ready') then
    raise exception 'Project is not ready for a new generation request';
  end if;

  if not exists(
    select 1 from public.project_scenes
    where project_id=p_project_id
  ) then
    raise exception 'Project has no scenes';
  end if;

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
    + (v_voice_minutes::bigint * v_policy.voice_per_minute_cents::bigint)
    + (v_project.total_duration_seconds::bigint * v_policy.video_per_second_cents::bigint)
    + v_policy.render_flat_cents::bigint;

  if v_base_cost<=0 then raise exception 'Generation cost policy is invalid'; end if;

  v_estimated_cost:=ceil(
    (v_base_cost::numeric * (100+v_policy.retry_buffer_percent)::numeric) / 100
  )::integer;

  if v_estimated_cost<=0 then raise exception 'Invalid generation estimate'; end if;

  v_reservation_id:=public.reserve_ai_budget(
    v_project.organization_id,
    'gen:'||p_request_key,
    v_estimated_cost
  );

  v_job_id:=public.enqueue_content_job(
    v_project.organization_id,
    'gen:'||p_request_key,
    'video',
    v_slots,
    'studio_video_generation',
    jsonb_build_object(
      'project_id',v_project.id,
      'language_code',v_project.language_code,
      'total_duration_seconds',v_project.total_duration_seconds,
      'slots_reserved',v_slots,
      'continuation_mode',v_project.continuation_mode,
      'series_id',v_project.series_id
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
  )
  values(
    v_run_id,v_project.organization_id,'safety','safety',0,'ready',0
  );

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  )
  values(
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
  )
  values(
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
    )
    values(
      v_run_id,v_project.organization_id,
      'scene:'||v_scene.scene_number::text,
      'scene_video',
      100+v_scene.scene_number,
      'pending',
      v_scene.scene_number,
      v_scene.duration_seconds*v_policy.video_per_second_cents
    );
  end loop;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  )
  values(
    v_run_id,v_project.organization_id,'render','render',500,'pending',
    v_policy.render_flat_cents
  );

  v_order:=0;
  for v_export in
    select preset_code
    from public.project_export_choices
    where project_id=p_project_id
    order by preset_code
  loop
    v_order:=v_order+1;
    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,preset_code,estimated_cost_cents
    )
    values(
      v_run_id,v_project.organization_id,
      'export:'||v_export.preset_code,
      'export',
      600+v_order,
      'pending',
      v_export.preset_code,
      0
    );
  end loop;

  update public.studio_projects
  set status='queued',
      last_generation_run_id=v_run_id,
      estimated_slots=v_slots,
      updated_at=now()
  where id=p_project_id;

  return v_run_id;
end;
$$;

revoke all on function public.request_studio_generation(uuid,text,text) from public,anon;
grant execute on function public.request_studio_generation(uuid,text,text) to authenticated,service_role;

create or replace function public.cancel_studio_generation(p_run_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run public.generation_runs%rowtype;
  v_job_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_run
  from public.generation_runs
  where id=p_run_id
  for update;

  if not found then raise exception 'Generation run not found'; end if;
  if not public.can_edit_org(v_run.organization_id) then raise exception 'Not authorized'; end if;
  if v_run.status not in ('awaiting_safety','queued') then
    raise exception 'Generation can no longer be canceled safely';
  end if;

  select status into v_job_status
  from public.content_jobs
  where id=v_run.root_job_id
  for update;

  if v_job_status<>'queued' then
    raise exception 'Generation job has already started';
  end if;

  perform public.fail_content_job(v_run.root_job_id,'user_canceled',0,true);
  perform public.settle_ai_budget(v_run.ai_reservation_id,'released',0);

  update public.generation_run_stages
  set status=case when status in ('pending','ready') then 'skipped' else status end,
      updated_at=now()
  where run_id=p_run_id;

  update public.generation_runs
  set status='canceled',failure_code='user_canceled',updated_at=now()
  where id=p_run_id;

  update public.studio_projects
  set status='draft',updated_at=now()
  where id=v_run.project_id and last_generation_run_id=p_run_id;

  return 'canceled';
end;
$$;

revoke all on function public.cancel_studio_generation(uuid) from public,anon;
grant execute on function public.cancel_studio_generation(uuid) to authenticated,service_role;
