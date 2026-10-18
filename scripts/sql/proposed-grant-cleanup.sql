-- PROPOSED (Milestone 9) — NOT a migration and NOT applied anywhere. Owner decision.
-- Older tables still carry Supabase's default TRUNCATE / REFERENCES / TRIGGER grants for anon and
-- authenticated (46 / 49 tables on the replica of production + pending migrations). PostgREST cannot issue
-- these statements, so they are not reachable through the API today, but TRUNCATE bypasses RLS: if the
-- database were ever reachable with those roles another way, a whole table could be emptied. Removing
-- them is defence in depth. SELECT/INSERT/UPDATE/DELETE grants (governed by RLS) are untouched.
-- Dry run (rolled back): see docs/PRODUCTION_ROLLOUT_PLAN.md, gate G6.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- Future tables created by the migration role get no such grants either.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
