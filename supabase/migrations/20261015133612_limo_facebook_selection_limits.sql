-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.select_facebook_pages(
  p_organization_id uuid,
  p_page_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage public.usage_balances%rowtype;
  v_count integer := coalesce(cardinality(p_page_ids),0);
  v_owned integer := 0;
  v_limit integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;

  perform 1
  from public.organization_subscriptions s
  where s.organization_id=p_organization_id
    and s.status='active'
    and s.renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  select * into v_usage
  from public.usage_balances
  where organization_id=p_organization_id
  for update;
  if not found or v_usage.cycle_end<=now() then raise exception 'Billing cycle unavailable'; end if;

  v_limit := v_usage.base_facebook_pages + v_usage.extra_facebook_pages;
  if v_count > v_limit then raise exception 'Facebook page limit reached'; end if;

  if v_count > 0 then
    select count(*) into v_owned
    from public.facebook_pages p
    where p.organization_id=p_organization_id
      and p.page_id = any(p_page_ids);
    if v_owned <> v_count then raise exception 'One or more pages do not belong to this workspace'; end if;
  end if;

  update public.facebook_pages
  set selected = case when v_count=0 then false else page_id=any(p_page_ids) end,
      updated_at=now()
  where organization_id=p_organization_id;

  update public.usage_balances
  set used_facebook_pages=v_count,
      updated_at=now()
  where organization_id=p_organization_id;

  insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,created_by)
  values(
    p_organization_id,
    'facebook_page',
    v_count-v_usage.used_facebook_pages,
    'facebook_selection_changed',
    'facebook_pages',
    auth.uid()
  );

  return v_count;
end;
$$;
revoke all on function public.select_facebook_pages(uuid,text[]) from public,anon;
grant execute on function public.select_facebook_pages(uuid,text[]) to authenticated,service_role;

create or replace function public.consume_social_oauth_state(p_state_hash text)
returns table(
  organization_id uuid,
  user_id uuid,
  redirect_uri text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.social_oauth_states s
  set used_at=now()
  where s.state_hash=p_state_hash
    and s.provider='facebook'
    and s.used_at is null
    and s.expires_at>now()
  returning s.organization_id,s.user_id,s.redirect_uri;
end;
$$;
revoke all on function public.consume_social_oauth_state(text) from public,anon,authenticated;
grant execute on function public.consume_social_oauth_state(text) to service_role;
