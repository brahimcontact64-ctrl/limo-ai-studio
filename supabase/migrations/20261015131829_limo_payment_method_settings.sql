-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.payment_method_settings (
  method text primary key check (method in ('redotpay','baridimob','ccp')),
  display_name text not null,
  enabled boolean not null default false,
  account_holder text,
  account_number text,
  ccp_key text,
  redotpay_uid text,
  instructions text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.payment_method_settings(method,display_name)
values
 ('redotpay','RedotPay / USDT'),
 ('baridimob','BaridiMob'),
 ('ccp','CCP')
on conflict (method) do nothing;

alter table public.payment_method_settings enable row level security;

drop policy if exists payment_method_authenticated_read on public.payment_method_settings;
create policy payment_method_authenticated_read on public.payment_method_settings
for select to authenticated using (true);

drop policy if exists platform_admin_self_read on public.platform_admins;
create policy platform_admin_self_read on public.platform_admins
for select to authenticated using (user_id=(select auth.uid()));

revoke all on public.payment_method_settings from anon,authenticated;
grant select on public.payment_method_settings to authenticated;

revoke all on public.platform_admins from anon,authenticated;
grant select on public.platform_admins to authenticated;

grant all on public.payment_method_settings to service_role;
