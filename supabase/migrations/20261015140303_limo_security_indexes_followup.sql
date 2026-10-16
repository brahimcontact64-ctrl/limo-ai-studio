-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

revoke execute on function public.sync_subscription_retention() from public, anon, authenticated;
revoke execute on function public.complete_registration_profile(text,text,text,text,date,text,text,text) from public, anon, authenticated;
revoke execute on function public.bootstrap_limo_user() from public, anon, authenticated;

create index if not exists content_episodes_created_by_idx on public.content_episodes(created_by);
create index if not exists content_episodes_previous_episode_idx on public.content_episodes(previous_episode_id);
create index if not exists content_safety_reviews_user_idx on public.content_safety_reviews(user_id);
create index if not exists content_series_created_by_idx on public.content_series(created_by);
create index if not exists media_assets_episode_idx on public.media_assets(episode_id);
create index if not exists media_deletion_queue_org_idx on public.media_deletion_queue(organization_id);
create index if not exists notification_outbox_org_idx on public.notification_outbox(organization_id);
create index if not exists notification_outbox_user_idx on public.notification_outbox(user_id);
create index if not exists payment_method_settings_updated_by_idx on public.payment_method_settings(updated_by);
create index if not exists social_oauth_states_user_idx on public.social_oauth_states(user_id);
