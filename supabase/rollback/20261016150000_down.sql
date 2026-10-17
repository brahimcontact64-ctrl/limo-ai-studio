-- Rollback of 20261016150000_limo_subscription_activation_v1. Requires 20261017090000_down.sql first
-- (admin hardening uses is_platform_admin_mfa). Payment rows and receipts are kept.
drop function if exists public.admin_update_payment_method(text, boolean, text, text, text, text, text, text);
drop function if exists public.admin_list_payment_submissions(text);
drop function if exists public.admin_review_payment(uuid, boolean, text);
drop function if exists public.submit_payment(uuid, text, text, text, text, text);
drop policy if exists payment_receipts_insert on storage.objects;
drop policy if exists payment_receipts_read on storage.objects;
drop function if exists public.is_platform_admin_mfa();

-- Previous behaviour: members insert their own payment claims directly
-- (20261015130556_limo_security_performance_hardening).
drop policy if exists payment_member_insert on public.payment_submissions;
create policy payment_member_insert on public.payment_submissions
for insert to authenticated
with check (
  public.is_org_member(organization_id)
  and submitted_by=(select auth.uid())
  and purchase_type in ('subscription','addon')
  and method in ('redotpay','baridimob','ccp')
);
