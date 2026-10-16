-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.character_voice_profiles (
  character_id text not null references public.character_catalog(id) on delete cascade,
  language_code text not null references public.language_catalog(code),
  provider text not null,
  voice_ref text not null,
  model_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(character_id,language_code)
);

alter table public.character_voice_profiles enable row level security;

drop policy if exists character_voice_profiles_read on public.character_voice_profiles;
create policy character_voice_profiles_read
on public.character_voice_profiles for select
to authenticated
using(active=true);

revoke all on public.character_voice_profiles from public,anon,authenticated;
grant select on public.character_voice_profiles to authenticated;
grant all on public.character_voice_profiles to service_role;
