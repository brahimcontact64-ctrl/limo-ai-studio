-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.create_series_episode_draft(
  p_series_id uuid,
  p_title text default null,
  p_summary text default null,
  p_script text default null,
  p_ending_hook text default null,
  p_last_scene_state jsonb default '{}'::jsonb,
  p_last_frame_path text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_series public.content_series%rowtype;
  v_prev public.content_episodes%rowtype;
  v_next_number integer;
  v_id uuid;
begin
  select * into v_series from public.content_series where id=p_series_id for update;
  if not found then raise exception 'Series not found'; end if;
  if not public.can_edit_org(v_series.organization_id) then raise exception 'Not authorized'; end if;

  select * into v_prev
  from public.content_episodes
  where series_id=p_series_id
  order by episode_number desc
  limit 1;

  v_next_number:=coalesce(v_prev.episode_number,0)+1;

  insert into public.content_episodes(
    organization_id,series_id,episode_number,title,summary,script,ending_hook,
    last_scene_state,last_frame_path,previous_episode_id,status,created_by
  )
  values(
    v_series.organization_id,p_series_id,v_next_number,
    nullif(left(coalesce(p_title,''),200),''),
    nullif(coalesce(p_summary,''),''),
    nullif(coalesce(p_script,''),''),
    nullif(coalesce(p_ending_hook,''),''),
    coalesce(p_last_scene_state,'{}'::jsonb),
    nullif(left(coalesce(p_last_frame_path,''),500),''),
    v_prev.id,'draft',auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_series_episode_draft(uuid,text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.create_series_episode_draft(uuid,text,text,text,text,jsonb,text) to authenticated,service_role;
