-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

revoke all on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) to service_role;

revoke all on function public.claim_generation_stages(text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_generation_stages(text,text,integer) to service_role;

revoke all on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb) to service_role;

revoke all on function public.fail_generation_stage(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.fail_generation_stage(uuid,text,text,text,integer) to service_role;

revoke all on function public.apply_generation_safety_decision(uuid,text,jsonb,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.apply_generation_safety_decision(uuid,text,jsonb,text,text,text,integer) to service_role;

revoke all on function public.refund_generation_usage_once(uuid) from public,anon,authenticated;
grant execute on function public.refund_generation_usage_once(uuid) to service_role;
