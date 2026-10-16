-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

update public.generation_cost_policies
set script_flat_cents=5,
    image_per_scene_cents=2,
    video_per_second_cents=3,
    voice_per_minute_cents=0,
    render_flat_cents=0,
    retry_buffer_percent=50,
    enabled=false,
    verified_at=null,
    updated_at=now()
where code='standard_v1';

create or replace function public.guard_generation_cost_policy_completeness()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_policy public.generation_cost_policies%rowtype;
  v_has_dialogue boolean;
begin
  if new.status<>'awaiting_safety' then return new; end if;

  select * into v_policy
  from public.generation_cost_policies
  where code=new.cost_policy_code;

  if not found or not v_policy.enabled or v_policy.verified_at is null then
    raise exception 'Generation cost policy is not enabled and verified';
  end if;

  if v_policy.script_flat_cents<=0 then
    raise exception 'Script pricing is not verified';
  end if;

  if v_policy.image_per_scene_cents<=0 then
    raise exception 'Scene image pricing is not verified';
  end if;

  if v_policy.video_per_second_cents<=0 then
    raise exception 'Video pricing is not verified';
  end if;

  select exists(
    select 1 from public.project_scenes
    where project_id=new.project_id
      and nullif(btrim(coalesce(dialogue,'')),'') is not null
  ) into v_has_dialogue;

  if v_has_dialogue and v_policy.voice_per_minute_cents<=0 then
    raise exception 'Voice pricing is not verified';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generation_cost_policy_completeness on public.generation_runs;
create trigger trg_generation_cost_policy_completeness
before insert on public.generation_runs
for each row execute function public.guard_generation_cost_policy_completeness();

revoke execute on function public.guard_generation_cost_policy_completeness()
from public,anon,authenticated;
