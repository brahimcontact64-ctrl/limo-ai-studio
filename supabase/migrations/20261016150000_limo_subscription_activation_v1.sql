-- LIMO AI Studio — secure subscription activation v1
-- Status: PENDING OWNER APPROVAL for production.
--
-- Manual-payment activation, hardened:
-- 1. submit_payment(): customers (workspace owner/admin) submit a payment claim. The amount is
--    taken from the catalog on the server, never from the browser; the method must be enabled;
--    at most 3 pending claims per workspace; the receipt must live in the workspace's own folder.
-- 2. The direct INSERT policy on payment_submissions is replaced by submit_payment(), so clients
--    can no longer write arbitrary amounts or statuses.
-- 3. admin_review_payment(): platform admins approve (delegates to approve_payment_submission,
--    which activates the plan for 30 days and resets usage) or reject with a note. Audited.
-- 4. admin_list_payment_submissions(): admin queue with workspace name and submitter email.
-- 5. admin_update_payment_method(): admins manage the payment destinations shown to customers.
-- 6. Storage policies for the private payment-receipts bucket:
--    upload by workspace owner/admin into "<organization_id>/…", read by members and platform admins.
-- Nothing is deleted; no existing row changes.

drop policy if exists payment_member_insert on public.payment_submissions;

create or replace function public.submit_payment(
  p_organization_id uuid,
  p_purchase_type text,
  p_item_code text,
  p_method text,
  p_transaction_ref text,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_dzd integer;
  v_usdt numeric;
  v_ref text := btrim(coalesce(p_transaction_ref, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'Not authorized'; end if;
  if char_length(v_ref) not between 3 and 200 then raise exception 'Transaction reference must be 3 to 200 characters'; end if;

  if not exists (select 1 from public.payment_method_settings where method = p_method and enabled = true) then
    raise exception 'Payment method unavailable';
  end if;

  if p_purchase_type = 'subscription' then
    select monthly_dzd, redotpay_usdt into v_dzd, v_usdt from public.plan_definitions where code = p_item_code and active = true;
  elsif p_purchase_type = 'addon' then
    if not exists (
      select 1 from public.usage_balances where organization_id = p_organization_id and cycle_end > now()
    ) then
      raise exception 'Add-ons require an active billing cycle';
    end if;
    select price_dzd, price_usdt into v_dzd, v_usdt from public.addon_definitions where code = p_item_code and active = true;
  else
    raise exception 'Unsupported purchase type';
  end if;
  if v_dzd is null and v_usdt is null then raise exception 'Unknown plan or add-on'; end if;

  if (select count(*) from public.payment_submissions where organization_id = p_organization_id and status = 'pending') >= 3 then
    raise exception 'Too many pending payments; wait for review';
  end if;

  if p_receipt_path is not null and split_part(p_receipt_path, '/', 1) <> p_organization_id::text then
    raise exception 'Invalid receipt path';
  end if;

  insert into public.payment_submissions(
    organization_id, submitted_by, purchase_type, item_code, method,
    amount_dzd, amount_usdt, transaction_ref, receipt_path
  ) values (
    p_organization_id, auth.uid(), p_purchase_type, p_item_code, p_method,
    case when p_method = 'redotpay' then null else v_dzd end,
    case when p_method = 'redotpay' then v_usdt else null end,
    v_ref, nullif(btrim(coalesce(p_receipt_path, '')), '')
  ) returning id into v_id;

  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'payment.submitted', 'payment_submission', v_id,
          jsonb_build_object('purchase_type', p_purchase_type, 'item_code', p_item_code, 'method', p_method));
  return v_id;
end;
$function$;

create or replace function public.admin_review_payment(p_payment_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment public.payment_submissions%rowtype;
  v_result text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;

  select * into v_payment from public.payment_submissions where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.status <> 'pending' then raise exception 'Payment already reviewed'; end if;

  if p_approve then
    perform public.approve_payment_submission(p_payment_id, auth.uid(), p_note);
    v_result := 'approved';
  else
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'A rejection reason is required'; end if;
    update public.payment_submissions
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = left(btrim(p_note), 1000), updated_at = now()
    where id = p_payment_id;
    v_result := 'rejected';
  end if;

  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_payment.organization_id, auth.uid(), 'payment.' || v_result, 'payment_submission', p_payment_id,
          jsonb_build_object('item_code', v_payment.item_code, 'purchase_type', v_payment.purchase_type, 'method', v_payment.method));
  return v_result;
end;
$function$;

create or replace function public.admin_list_payment_submissions(p_status text default null)
returns table (
  id uuid, organization_id uuid, organization_name text, submitter_email text,
  purchase_type text, item_code text, method text, amount_dzd integer, amount_usdt numeric,
  transaction_ref text, receipt_path text, status text, review_note text,
  created_at timestamptz, reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  return query
    select p.id, p.organization_id, o.name, u.email::text,
           p.purchase_type, p.item_code, p.method, p.amount_dzd, p.amount_usdt,
           p.transaction_ref, p.receipt_path, p.status, p.review_note, p.created_at, p.reviewed_at
    from public.payment_submissions p
    join public.organizations o on o.id = p.organization_id
    left join auth.users u on u.id = p.submitted_by
    where p_status is null or p.status = p_status
    order by (p.status = 'pending') desc, p.created_at desc
    limit 200;
end;
$function$;

create or replace function public.admin_update_payment_method(
  p_method text, p_enabled boolean, p_display_name text, p_account_holder text,
  p_account_number text, p_ccp_key text, p_redotpay_uid text, p_instructions text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  update public.payment_method_settings set
    enabled = coalesce(p_enabled, false),
    display_name = left(btrim(coalesce(p_display_name, display_name)), 80),
    account_holder = nullif(left(btrim(coalesce(p_account_holder, '')), 120), ''),
    account_number = nullif(left(btrim(coalesce(p_account_number, '')), 120), ''),
    ccp_key = nullif(left(btrim(coalesce(p_ccp_key, '')), 40), ''),
    redotpay_uid = nullif(left(btrim(coalesce(p_redotpay_uid, '')), 120), ''),
    instructions = nullif(left(btrim(coalesce(p_instructions, '')), 2000), ''),
    updated_by = auth.uid(),
    updated_at = now()
  where method = p_method;
  if not found then raise exception 'Unknown payment method'; end if;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'payment_method.updated', 'payment_method', null,
          jsonb_build_object('method', p_method, 'enabled', coalesce(p_enabled, false)));
end;
$function$;

revoke all on function public.submit_payment(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.admin_review_payment(uuid, boolean, text) from public, anon;
revoke all on function public.admin_list_payment_submissions(text) from public, anon;
revoke all on function public.admin_update_payment_method(text, boolean, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_payment(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_review_payment(uuid, boolean, text) to authenticated;
grant execute on function public.admin_list_payment_submissions(text) to authenticated;
grant execute on function public.admin_update_payment_method(text, boolean, text, text, text, text, text, text) to authenticated;

-- Receipts: "<organization_id>/<random>.<ext>" in the private payment-receipts bucket.
drop policy if exists payment_receipts_insert on storage.objects;
create policy payment_receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists payment_receipts_read on storage.objects;
create policy payment_receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (
      public.is_platform_admin()
      or ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_org_member(((storage.foldername(name))[1])::uuid))
    )
  );
