#!/usr/bin/env bash
# Dry-runs every rollback script (newest first) against a LOCAL database inside one transaction that is
# always rolled back, then checks that the pending objects are gone inside that transaction.
# Usage: scripts/sql/rollback-dry-run.sh <local db container>   (never point this at production)
set -euo pipefail
DB="${1:?local database container name}"
DIR="$(cd "$(dirname "$0")/../../supabase/rollback" && pwd)"
{
  echo "begin;"
  cat "$DIR/20261018090000_down.sql"
  cat "$DIR/20261017220000_down.sql"
  cat "$DIR/20261017200000_down.sql"
  cat "$DIR/20261017180000_down.sql"
  cat "$DIR/20261017160000_down.sql"
  # Simulates the owner resolving projects that cast workspace characters before the character rollback.
  echo "delete from public.studio_projects p where exists (select 1 from jsonb_array_elements(p.project_cast) e where e->>'id' like 'custom:%');"
  cat "$DIR/20261017140000_down.sql"
  cat "$DIR/20261017120000_down.sql"
  # Simulates the owner resolving character-free projects before the universal-creation rollback.
  echo "delete from public.studio_projects where jsonb_array_length(project_cast) = 0;"
  cat "$DIR/20261017100000_down.sql" "$DIR/20261017090000_down.sql" "$DIR/20261016150000_down.sql" "$DIR/20261016140000_down.sql"
  cat <<'SQL'
select 'ROLLBACK-CHECK ' || string_agg(name || '=' || present::text, ' ' order by name) from (
  select 'project_revisions' as name, to_regclass('public.project_revisions') is not null as present
  union all select 'video_policy', exists (select 1 from pg_proc where proname = 'limo_video_max_duration_ms')
  union all select 'brand_kits', to_regclass('public.brand_kits') is not null
  union all select 'feature_flags', to_regclass('public.feature_flags') is not null
  union all select 'rate_limit_hits', to_regclass('public.rate_limit_hits') is not null
  union all select 'character_design_specs', to_regclass('public.character_design_specs') is not null
  union all select 'character_reference_assets', to_regclass('public.character_reference_assets') is not null
  union all select 'publish_jobs', to_regclass('public.publish_jobs') is not null
  union all select 'automation_policies', to_regclass('public.automation_policies') is not null
  union all select 'schedule_social_post', exists (select 1 from pg_proc where proname = 'schedule_social_post')
  union all select 'render_jobs', to_regclass('public.render_jobs') is not null
  union all select 'enqueue_render_job', exists (select 1 from pg_proc where proname = 'enqueue_render_job')
  union all select 'image_projects', to_regclass('public.image_projects') is not null
  union all select 'social_posts', to_regclass('public.social_posts') is not null
  union all select 'save_image_project', exists (select 1 from pg_proc where proname = 'save_image_project')
  union all select 'story_bible_versions', to_regclass('public.story_bible_versions') is not null
  union all select 'content_series_write_policy', exists (select 1 from pg_policies where policyname = 'content_series_write')
  union all select 'save_studio_project_v2', to_regprocedure('public.save_studio_project_v2(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text[])') is not null
  union all select 'submit_payment', to_regprocedure('public.submit_payment(uuid,text,text,text,text,text)') is not null
  union all select 'creation_mode_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'studio_projects' and column_name = 'creation_mode')
  union all select 'payment_member_insert_policy', exists (select 1 from pg_policies where policyname = 'payment_member_insert')
) t;
select 'ROLLBACK-CHECK v1 save still present=' || (to_regprocedure('public.save_studio_project(uuid,uuid,text,text,text,text,text,text,uuid,boolean,jsonb,jsonb,text[])') is not null)::text;
rollback;
SQL
} | docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q -At
