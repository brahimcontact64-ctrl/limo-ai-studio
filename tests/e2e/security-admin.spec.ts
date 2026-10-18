import { test, expect, type Browser, type Page } from '@playwright/test';
import { totp } from '../../scripts/lib/totp';
import { passAdminGate } from './admin-gate';

/**
 * Two-factor enrolment through the real UI, and the admin area's server-side gates.
 * Local stack only: E2E_EMAIL/E2E_PASSWORD (a regular subscribed user) and
 * E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD/E2E_ADMIN_TOTP_SECRET (scripts/e2e-local-setup.ts).
 */
const USER = process.env.E2E_EMAIL;
const USER_PW = process.env.E2E_PASSWORD;
const ADMIN = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD;
test.skip(!USER || !USER_PW || !ADMIN || !ADMIN_PW || !process.env.E2E_ADMIN_TOTP_SECRET, 'needs user and admin credentials');

async function signIn(browser: Browser, baseURL: string, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'limo_locale', value: 'en', url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
  return page;
}

test('a user turns two-factor authentication on and off from settings', async ({ browser, baseURL }) => {
  const page = await signIn(browser, baseURL!, USER!, USER_PW!);
  await page.goto('/app/settings#security');
  const panel = page.locator('#security');
  await expect(panel.getByText('Two-factor authentication is off.')).toBeVisible();
  await panel.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(panel.locator('img')).toBeVisible(); // QR code
  const secret = (await panel.locator('code').innerText()).trim();
  await panel.getByLabel('6-digit code').fill('000000');
  await panel.getByRole('button', { name: 'Verify and turn on' }).click();
  await expect(panel.getByText('That code is not valid.', { exact: false })).toBeVisible();
  await panel.getByLabel('6-digit code').fill(totp(secret));
  await panel.getByRole('button', { name: 'Verify and turn on' }).click();
  await expect(panel.getByText('Two-factor authentication is on.')).toBeVisible();

  await panel.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
  await expect(panel.getByText('Two-factor authentication is off.')).toBeVisible();
});

test('non-admins get 404 from the admin area and admin APIs', async ({ browser, baseURL }) => {
  const page = await signIn(browser, baseURL!, USER!, USER_PW!);
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(404);
  for (const path of ['/admin/workspaces', '/admin/payments', '/admin/payment-methods']) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
  const api = await page.request.post('/api/admin/flags', { data: { key: 'custom_characters', enabled: false } });
  expect(api.status()).toBe(404);
  const sub = await page.request.post('/api/admin/workspaces/00000000-0000-4000-8000-000000000000/subscription', { data: { plan_code: 'business', status: 'active', days: 366, reason: 'escalation attempt' } });
  expect(sub.status()).toBe(404);
});

test('the admin passes the two-factor gate and changes a workspace plan (audited)', async ({ browser, baseURL }) => {
  const page = await signIn(browser, baseURL!, ADMIN!, ADMIN_PW!);
  await page.goto('/admin/workspaces');
  await expect(page.getByRole('heading', { name: 'Confirm it’s you' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0); // nothing leaks before the second factor
  await passAdminGate(page);

  // The list shows the newest 500 workspaces; search finds any workspace by owner email.
  await page.getByRole('searchbox', { name: 'Search workspaces' }).fill(USER!);
  await page.getByRole('button', { name: 'Search workspaces' }).click();
  await page.waitForURL(/\/admin\/workspaces\?q=/);
  const row = page.locator('tr', { hasText: USER! });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Manage plan' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Plan').selectOption({ label: 'Business' });
  await dialog.getByLabel('Days from today').fill('45');
  await dialog.getByRole('button', { name: 'Save change' }).click();
  await expect(dialog.getByText('Enter a reason of at least 5 characters.')).toBeVisible();
  await dialog.getByLabel(/Reason/).fill('E2E: goodwill upgrade');
  await dialog.getByRole('button', { name: 'Save change' }).click();
  await expect(page.getByText('Subscription updated.')).toBeVisible();
  await expect(page.locator('tr', { hasText: USER! })).toContainText('Business');

  await page.goto('/admin');
  await expect(page.getByRole('cell', { name: 'subscription.admin_set' }).first()).toBeVisible();
});
