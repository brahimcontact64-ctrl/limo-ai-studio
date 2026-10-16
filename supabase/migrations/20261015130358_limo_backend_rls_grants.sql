-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.plan_definitions enable row level security;
alter table public.addon_definitions enable row level security;
alter table public.character_catalog enable row level security;
alter table public.language_catalog enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.usage_balances enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.platform_admins enable row level security;
alter table public.feedback_items enable row level security;
alter table public.social_connections enable row level security;
alter table public.facebook_pages enable row level security;
alter table public.content_jobs enable row level security;

drop policy if exists plan_catalog_read on public.plan_definitions;
create policy plan_catalog_read on public.plan_definitions
for select to anon,authenticated using (active=true);

drop policy if exists addon_catalog_read on public.addon_definitions;
create policy addon_catalog_read on public.addon_definitions
for select to anon,authenticated using (active=true);

drop policy if exists character_catalog_read on public.character_catalog;
create policy character_catalog_read on public.character_catalog
for select to anon,authenticated using (active=true);

drop policy if exists language_catalog_read on public.language_catalog;
create policy language_catalog_read on public.language_catalog
for select to anon,authenticated using (active=true);

drop policy if exists subscription_member_read on public.organization_subscriptions;
create policy subscription_member_read on public.organization_subscriptions
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists usage_member_read on public.usage_balances;
create policy usage_member_read on public.usage_balances
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists usage_ledger_member_read on public.usage_ledger;
create policy usage_ledger_member_read on public.usage_ledger
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists payment_member_read on public.payment_submissions;
create policy payment_member_read on public.payment_submissions
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists payment_member_insert on public.payment_submissions;
create policy payment_member_insert on public.payment_submissions
for insert to authenticated
with check (
  public.is_org_member(organization_id)
  and submitted_by=auth.uid()
  and purchase_type in ('subscription','addon')
  and method in ('redotpay','baridimob','ccp')
);

drop policy if exists feedback_member_read on public.feedback_items;
create policy feedback_member_read on public.feedback_items
for select to authenticated
using ((organization_id is null and user_id=auth.uid()) or public.is_org_member(organization_id));

drop policy if exists feedback_member_insert on public.feedback_items;
create policy feedback_member_insert on public.feedback_items
for insert to authenticated
with check (user_id=auth.uid() and (organization_id is null or public.is_org_member(organization_id)));

drop policy if exists social_member_read on public.social_connections;
create policy social_member_read on public.social_connections
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists pages_member_read on public.facebook_pages;
create policy pages_member_read on public.facebook_pages
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists jobs_member_read on public.content_jobs;
create policy jobs_member_read on public.content_jobs
for select to authenticated using (public.is_org_member(organization_id));

revoke all on public.plan_definitions,public.addon_definitions,public.character_catalog,public.language_catalog from anon,authenticated;
grant select on public.plan_definitions,public.addon_definitions,public.character_catalog,public.language_catalog to anon,authenticated;

revoke all on public.organization_subscriptions,public.usage_balances,public.usage_ledger from anon,authenticated;
grant select on public.organization_subscriptions,public.usage_balances,public.usage_ledger to authenticated;

revoke all on public.payment_submissions from anon,authenticated;
grant select,insert on public.payment_submissions to authenticated;

revoke all on public.feedback_items from anon,authenticated;
grant select,insert on public.feedback_items to authenticated;

revoke all on public.social_connections,public.facebook_pages from anon,authenticated;
grant select on public.social_connections,public.facebook_pages to authenticated;

revoke all on public.content_jobs from anon,authenticated;
grant select on public.content_jobs to authenticated;

revoke all on public.platform_admins from anon,authenticated;

grant all on public.plan_definitions,public.addon_definitions,public.character_catalog,public.language_catalog,
 public.organization_subscriptions,public.usage_balances,public.usage_ledger,public.payment_submissions,
 public.platform_admins,public.feedback_items,public.social_connections,public.facebook_pages,public.content_jobs
to service_role;
