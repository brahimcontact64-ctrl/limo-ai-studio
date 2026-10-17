import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { linkFrom, waitForMail } from './mail';

/** Shared sign-up helpers. Only point these at a local/staging stack, never production. */
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
export const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY;

export async function activateSubscription(email: string) {
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error('test user not found');
  const { data: m } = await admin.from('organization_members').select('organization_id').eq('user_id', user.id).single();
  const renews = new Date(Date.now() + 30 * 864e5).toISOString();
  const { error } = await admin
    .from('organization_subscriptions')
    .upsert({ organization_id: m!.organization_id, plan_code: 'creator', status: 'active', started_at: new Date().toISOString(), renews_at: renews });
  if (error) throw error;
  // Real activation (payment approval / admin) also opens the usage cycle with the plan's allowances.
  const { data: plan } = await admin.from('plan_definitions').select('video_slots, posts, ai_images, facebook_pages').eq('code', 'creator').single();
  const { error: usageError } = await admin.from('usage_balances').upsert({
    organization_id: m!.organization_id, cycle_start: new Date().toISOString(), cycle_end: renews,
    base_video_slots: plan!.video_slots, base_posts: plan!.posts, base_images: plan!.ai_images, base_facebook_pages: plan!.facebook_pages,
  });
  if (usageError) throw usageError;
}

export async function signUpAndOnboard(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Limo-e2e-Passw0rd!');
  const started = Date.now();
  await page.getByRole('button', { name: 'Create account' }).click();
  // With email confirmation on (production behaviour), confirm through the email link.
  const inbox = page.getByText('Check your inbox');
  await Promise.race([page.waitForURL('**/app/onboarding'), inbox.waitFor()]);
  if (await inbox.isVisible()) {
    const mail = await waitForMail(email, /confirm/i, started);
    await page.goto(linkFrom(mail.html));
    await page.waitForURL('**/app/onboarding');
  }

  await page.getByLabel('First name').fill('Test');
  await page.getByLabel('Last name').fill('Creator');
  await page.getByLabel('Country').selectOption('DZ');
  await page.getByLabel('State or region').fill('Oran');
  await page.getByLabel('Date of birth').fill('1990-05-17');
  await page.getByRole('radio', { name: 'Business' }).click();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await page.waitForURL(/\/app$/);
}
