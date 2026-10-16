# LIMO AI Studio v0.4

Backend-staging milestone for a Facebook-first AI content SaaS.

## Included
- Supabase auth shell and tenant-aware dashboard
- API routes for catalog, feedback, usage, payments, job enqueueing
- SQL migration for plans, add-ons, characters, languages, subscriptions, usage, payments, feedback, social accounts and durable content jobs
- Idempotent usage reservation through `enqueue_content_job`
- Manual payment approval RPC that activates plans or add-ons
- RLS for tenant isolation and server-side security headers
- Facebook OAuth, provider APIs and worker execution intentionally remain disabled until secrets and review gates are configured

## Required next step
Run `supabase/migrations/20261015_limo_backend_v1.sql` in the LIMO Supabase project. Do not run it on an unrelated project.

## Secrets
Never commit service-role, Meta, AI provider or payment secrets. Use Vercel encrypted environment variables.
