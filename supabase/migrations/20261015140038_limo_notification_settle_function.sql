-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

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
  begin
    update public.notification_outbox
    set status=case when p_success then 'sent' else 'failed' end,
        sent_at=case when p_success then now() else null end,
        provider_message_id=case when p_success then left(coalesce(p_provider_message_id,''),300) else null end,
        last_error=case when p_success then null else left(coalesce(p_error,'unknown_error'),2000) end
    where id=p_notification_id and status='processing';
    if not found then raise exception 'Notification not processing'; end if;
    return case when p_success then 'sent' else 'failed' end;
  end;
  $$;
  revoke all on function public.settle_notification(uuid,boolean,text,text) from public,anon,authenticated;
  grant execute on function public.settle_notification(uuid,boolean,text,text) to service_role;
