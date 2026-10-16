-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

insert into public.notification_templates(template_key,subject_template,body_template) values
  ('subscription_expired','Your LIMO subscription has expired','Your LIMO Studio is read-only. Renew during the 30-day grace period to keep access to generated content.'),
  ('renewal_reminder_7d','LIMO renewal reminder','Your workspace is still in the grace period. Renew to restore generation and publishing.'),
  ('renewal_reminder_21d','LIMO renewal reminder: grace period ending soon','Your 30-day grace period is close to ending. Renew to keep generated content.'),
  ('final_deletion_warning','Final LIMO renewal warning','Your grace period ends in 3 days. Renew now if you want to keep generated content.'),
  ('content_deleted_after_nonpayment','LIMO grace period ended','The grace period ended without renewal. Generated content associated with the expired workspace was purged; billing and audit records remain separate.')
  on conflict(template_key) do update set
    subject_template=excluded.subject_template,
    body_template=excluded.body_template,
    active=true,
    updated_at=now();
