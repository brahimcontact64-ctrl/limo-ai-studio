-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('facebook')),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists social_oauth_states_expiry_idx on public.social_oauth_states(provider,expires_at);
create index if not exists social_oauth_states_org_idx on public.social_oauth_states(organization_id,created_at desc);

alter table public.social_oauth_states enable row level security;
revoke all on public.social_oauth_states from public,anon,authenticated;
grant all on public.social_oauth_states to service_role;

create or replace function public.store_oauth_secret(
  p_secret text,
  p_name text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_secret is null or char_length(p_secret)=0 then raise exception 'Secret required'; end if;
  select vault.create_secret(p_secret,p_name,p_description) into v_id;
  return v_id;
end;
$$;
revoke all on function public.store_oauth_secret(text,text,text) from public,anon,authenticated;
grant execute on function public.store_oauth_secret(text,text,text) to service_role;

create or replace function public.update_oauth_secret(
  p_secret_id uuid,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or char_length(p_secret)=0 then raise exception 'Secret required'; end if;
  perform vault.update_secret(p_secret_id,p_secret);
end;
$$;
revoke all on function public.update_oauth_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.update_oauth_secret(uuid,text) to service_role;

create or replace function public.read_oauth_secret(p_secret_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select v.decrypted_secret
  from vault.decrypted_secrets v
  where v.id=p_secret_id
  limit 1;
$$;
revoke all on function public.read_oauth_secret(uuid) from public,anon,authenticated;
grant execute on function public.read_oauth_secret(uuid) to service_role;
