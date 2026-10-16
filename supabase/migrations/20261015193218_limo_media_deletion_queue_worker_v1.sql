-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.claim_media_deletions(
  p_worker_id text,
  p_limit integer default 50
)
returns setof public.media_deletion_queue
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'Worker id required';
  end if;
  if p_limit<1 or p_limit>200 then
    raise exception 'Invalid limit';
  end if;

  return query
  with picked as (
    select q.id
    from public.media_deletion_queue q
    where q.status in ('pending','failed')
      and q.attempts<10
    order by q.created_at
    for update skip locked
    limit p_limit
  )
  update public.media_deletion_queue q
  set status='processing',
      attempts=q.attempts+1,
      last_error=null
  from picked
  where q.id=picked.id
  returning q.*;
end;
$$;

create or replace function public.settle_media_deletion(
  p_deletion_id uuid,
  p_success boolean,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.media_deletion_queue
  set status=case when p_success then 'deleted' else 'failed' end,
      deleted_at=case when p_success then now() else null end,
      last_error=case when p_success then null else left(coalesce(p_error,'unknown_error'),2000) end
  where id=p_deletion_id
    and status='processing';

  if not found then
    raise exception 'Deletion item not processing';
  end if;

  return case when p_success then 'deleted' else 'failed' end;
end;
$$;

revoke all on function public.claim_media_deletions(text,integer)
from public,anon,authenticated;
revoke all on function public.settle_media_deletion(uuid,boolean,text)
from public,anon,authenticated;

grant execute on function public.claim_media_deletions(text,integer) to service_role;
grant execute on function public.settle_media_deletion(uuid,boolean,text) to service_role;
