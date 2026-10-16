-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'character-library',
  'character-library',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types,
  updated_at=now();
