-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.claim_notification_outbox(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'Worker id required';
  end if;
  if p_limit<1 or p_limit>100 then
    raise exception 'Invalid limit';
  end if;

  return query
  with picked as (
    select n.id
    from public.notification_outbox n
    where n.status in ('pending','failed')
      and n.scheduled_for<=now()
      and n.attempts<5
    order by n.scheduled_for,n.created_at
    for update skip locked
    limit p_limit
  )
  update public.notification_outbox n
  set status='processing',
      locked_at=now(),
      locked_by=left(p_worker_id,120),
      attempts=n.attempts+1,
      last_error=null
  from picked
  where n.id=picked.id
  returning n.*;
end;
$$;

create or replace function public.settle_notification(
  p_notification_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_attempts integer;
  v_status text;
begin
  select attempts into v_attempts
  from public.notification_outbox
  where id=p_notification_id
    and status='processing'
  for update;

  if not found then
    raise exception 'Notification not processing';
  end if;

  if p_success then
    update public.notification_outbox
    set status='sent',
        sent_at=now(),
        provider_message_id=left(coalesce(p_provider_message_id,''),300),
        last_error=null,
        locked_at=null,
        locked_by=null
    where id=p_notification_id;
    return 'sent';
  end if;

  v_status:=case when v_attempts>=5 then 'failed' else 'pending' end;

  update public.notification_outbox
  set status=v_status,
      sent_at=null,
      provider_message_id=null,
      last_error=left(coalesce(p_error,'unknown_error'),2000),
      scheduled_for=case
        when v_status='pending'
          then now()+make_interval(mins=>least(60,greatest(5,v_attempts*5)))
        else scheduled_for
      end,
      locked_at=null,
      locked_by=null
  where id=p_notification_id;

  return v_status;
end;
$$;

create or replace function public.cancel_claimed_notification(
  p_notification_id uuid,
  p_reason text default 'no_longer_applicable'
)
returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.notification_outbox
  set status='canceled',
      last_error=left(coalesce(p_reason,'no_longer_applicable'),2000),
      locked_at=null,
      locked_by=null
  where id=p_notification_id
    and status='processing';

  if not found then
    raise exception 'Notification not processing';
  end if;

  return 'canceled';
end;
$$;

revoke all on function public.claim_notification_outbox(text,integer)
from public,anon,authenticated;
revoke all on function public.settle_notification(uuid,boolean,text,text)
from public,anon,authenticated;
revoke all on function public.cancel_claimed_notification(uuid,text)
from public,anon,authenticated;

grant execute on function public.claim_notification_outbox(text,integer) to service_role;
grant execute on function public.settle_notification(uuid,boolean,text,text) to service_role;
grant execute on function public.cancel_claimed_notification(uuid,text) to service_role;
