import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { linkFrom, waitForMail } from './mail';

/**
 * Milestone flow: sign up → onboarding → create project → cast → scenes → save → reload → edit → save
 * → dashboard → sign out.
 *
 * Needs E2E_SUPABASE_URL + E2E_SERVICE_ROLE_KEY to grant the new test workspace an active subscription
 * (save_studio_project requires one). Only point this at a local/staging stack, never production.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY;

test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

async function activateSubscription(email: string) {
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
}

async function signUpAndOnboard(page: Page, email: string) {
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

test('create, save, reload and edit a studio project', async ({ page }, info) => {
  const email = `e2e+${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);

  await signUpAndOnboard(page, email);
  await expect(page.getByText('Saving requires an active plan')).toBeVisible();
  await activateSubscription(email);
  await page.reload();
  await expect(page.getByText('Saving requires an active plan')).toHaveCount(0);

  // New project — brief
  await page.goto('/app/projects/new');
  const title = `Market day ${info.project.name}`;
  await page.getByLabel('Project title', { exact: true }).first().fill(title);
  await page.getByLabel(/Creative brief/).fill('Two neighbours compare seasonal fruit.');
  await page.getByRole('radio', { name: 'Français' }).click();

  // Cast: 4 characters (exceeds the old 3-character DB constraint)
  await page.getByRole('tab', { name: /Cast/ }).click();
  for (const name of ['Limo · Boy', 'Nova · Girl', 'Adam · Man', 'Nova · Grandmother']) {
    await page.getByRole('button', { name: `Add ${name} to cast` }).click();
  }
  await expect(page.getByText('4 of 18 selected')).toBeVisible();

  // Scenes
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await page.getByLabel(/Scene title/).fill('Opening at the market');
  await page.getByRole('button', { name: 'Limo · Boy', exact: true }).click();
  await page.getByRole('button', { name: 'Nova · Girl', exact: true }).click();
  await page.getByLabel(/^Dialogue/).fill('LIMO: Look how fresh this is!');
  await page.locator('.scene-rail').getByRole('button', { name: 'Add scene' }).click();
  await page.getByLabel(/Scene title/).fill('Grandma explains');
  await page.getByRole('button', { name: 'Nova · Grandmother', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Duration' }).fill('12');

  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Reload: everything comes back from Supabase
  await page.reload();
  await expect(page.locator('#project-title-bar')).toHaveValue(title);
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await expect(page.locator('.scene-name')).toHaveText(['Opening at the market', 'Grandma explains']);
  await page.locator('.scene-select').nth(1).click();
  await expect(page.getByRole('spinbutton', { name: 'Duration' })).toHaveValue('12');
  await page.locator('.scene-select').nth(0).click();
  await expect(page.getByLabel(/^Dialogue/)).toHaveValue('LIMO: Look how fresh this is!');
  await expect(page.getByRole('button', { name: 'Nova · Girl', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: /Cast/ }).click();
  await expect(page.getByText('4 of 18 selected')).toBeVisible();

  // Edit + save again
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await page.locator('.scene-select').nth(1).click();
  await page.getByLabel(/Scene title/).fill('Grandma explains the season');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();

  await page.goto(projectUrl);
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await expect(page.locator('.scene-name').nth(1)).toHaveText('Grandma explains the season');

  // Dashboard lists it
  await page.goto('/app');
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  // Sign out
  await page.getByLabel('Account').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('protected routes and unknown projects', async ({ page }) => {
  await page.goto('/app/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fprojects/);
  const res = await page.request.post('/api/projects', { data: {} });
  expect(res.status()).toBe(401);
});
