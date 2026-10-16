-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.claim_notification_outbox(p_worker_id text,p_limit integer default 20)
  returns setof public.notification_outbox
  language plpgsql
  security definer
  set search_path=''
  as $$
  begin
    if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
    if p_limit<1 or p_limit>100 then raise exception 'Invalid limit'; end if;
    return query
    with picked as (
      select n.id
      from public.notification_outbox n
      where n.status='pending' and n.scheduled_for<=now()
      order by n.scheduled_for,n.created_at
      for update skip locked
      limit p_limit
    )
    update public.notification_outbox n
    set status='processing',
        locked_at=now(),
        locked_by=left(p_worker_id,120),
        attempts=n.attempts+1
    from picked
    where n.id=picked.id
    returning n.*;
  end;
  $$;
  revoke all on function public.claim_notification_outbox(text,integer) from public,anon,authenticated;
  grant execute on function public.claim_notification_outbox(text,integer) to service_role;
