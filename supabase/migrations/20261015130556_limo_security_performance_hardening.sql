-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

revoke execute on function public.bootstrap_limo_user() from public, anon;
grant execute on function public.bootstrap_limo_user() to authenticated, service_role;

revoke execute on function public.can_edit_org(uuid) from public, anon;
grant execute on function public.can_edit_org(uuid) to authenticated, service_role;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

revoke execute on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

drop policy if exists payment_member_insert on public.payment_submissions;
create policy payment_member_insert on public.payment_submissions
for insert to authenticated
with check (
  public.is_org_member(organization_id)
  and submitted_by=(select auth.uid())
  and purchase_type in ('subscription','addon')
  and method in ('redotpay','baridimob','ccp')
);

drop policy if exists feedback_member_read on public.feedback_items;
create policy feedback_member_read on public.feedback_items
for select to authenticated
using (
  (organization_id is null and user_id=(select auth.uid()))
  or public.is_org_member(organization_id)
);

drop policy if exists feedback_member_insert on public.feedback_items;
create policy feedback_member_insert on public.feedback_items
for insert to authenticated
with check (
  user_id=(select auth.uid())
  and (organization_id is null or public.is_org_member(organization_id))
);

create index if not exists organization_members_user_idx on public.organization_members(user_id);
create index if not exists brands_org_idx on public.brands(organization_id);
create index if not exists characters_org_idx on public.characters(organization_id);
create index if not exists content_projects_org_idx on public.content_projects(organization_id);
create index if not exists content_projects_brand_org_idx on public.content_projects(brand_id,organization_id);
create index if not exists content_projects_character_org_idx on public.content_projects(character_id,organization_id);
create index if not exists content_projects_created_by_idx on public.content_projects(created_by);
create index if not exists video_jobs_org_idx on public.video_jobs(organization_id);
create index if not exists video_jobs_project_org_idx on public.video_jobs(content_project_id,organization_id);
create index if not exists publishing_approvals_org_idx on public.publishing_approvals(organization_id);
create index if not exists publishing_approvals_project_org_idx on public.publishing_approvals(content_project_id,organization_id);
create index if not exists publishing_approvals_reviewed_by_idx on public.publishing_approvals(reviewed_by);

create index if not exists content_jobs_requested_by_idx on public.content_jobs(requested_by);
create index if not exists facebook_pages_connection_idx on public.facebook_pages(connection_id);
create index if not exists feedback_items_user_idx on public.feedback_items(user_id);
create index if not exists organization_subscriptions_plan_idx on public.organization_subscriptions(plan_code);
create index if not exists organization_subscriptions_payment_idx on public.organization_subscriptions(source_payment_id);
create index if not exists payment_submissions_submitted_by_idx on public.payment_submissions(submitted_by);
create index if not exists payment_submissions_reviewed_by_idx on public.payment_submissions(reviewed_by);
create index if not exists social_connections_connected_by_idx on public.social_connections(connected_by);
create index if not exists usage_ledger_created_by_idx on public.usage_ledger(created_by);
