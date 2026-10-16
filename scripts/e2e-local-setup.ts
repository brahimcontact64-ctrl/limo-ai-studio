/**
 * Prepares a LOCAL Supabase stack for scripts/e2e-backend.ts:
 * two confirmed users (separate workspaces via bootstrap_limo_user), completed profiles,
 * and an active subscription for user A only.
 *
 * Refuses to run against anything other than localhost — never use a service-role key for production here.
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_A_EMAIL, E2E_A_PASSWORD, E2E_B_EMAIL, E2E_B_PASSWORD
 */
import { createClient } from '@supabase/supabase-js';

const e = (k: string) => process.env[k] ?? (console.error(`Missing ${k}`), process.exit(2));
const url = e('SUPABASE_URL');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error('Refusing to run: SUPABASE_URL is not a local stack.');
  process.exit(2);
}
const admin = createClient(url, e('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

async function ensureUser(email: string, password: string, subscribe: boolean) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const client = createClient(url, e('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  const { error: profErr } = await client.rpc('complete_registration_profile_v2', {
    p_first_name: 'E2E',
    p_last_name: subscribe ? 'Alpha' : 'Beta',
    p_country_name: 'Algeria',
    p_country_code: 'DZ',
    p_state_region: 'Oran',
    p_date_of_birth: '1990-01-01',
    p_account_type: 'business',
    p_terms_version: 'terms-2026-10',
    p_safety_policy_version: 'safety-2026-10',
  });
  if (profErr) throw profErr;
  const { data: m, error: mErr } = await admin.from('organization_members').select('organization_id').eq('user_id', user!.id).single();
  if (mErr) throw mErr;
  if (subscribe) {
    const { error } = await admin.from('organization_subscriptions').upsert({
      organization_id: m.organization_id,
      plan_code: 'creator',
      status: 'active',
      started_at: new Date().toISOString(),
      renews_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    if (error) throw error;
  }
  console.log(`${email}: org ${m.organization_id}${subscribe ? ' (active subscription)' : ''}`);
}

await ensureUser(e('E2E_A_EMAIL'), e('E2E_A_PASSWORD'), true);
await ensureUser(e('E2E_B_EMAIL'), e('E2E_B_PASSWORD'), false);
