import { test, expect, type Browser, type Page } from '@playwright/test';
import { MAILPIT, linkFrom, waitForMail } from './mail';
import { passAdminGate } from './admin-gate';

/**
 * Manual subscription activation, customer + platform admin, through the UI.
 * Local stack only: needs E2E_MAILPIT_URL, E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (a platform admin),
 * and an enabled CCP method (scripts/e2e-local-setup.ts prepares both).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
test.skip(!MAILPIT || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'needs E2E_MAILPIT_URL and admin credentials');

async function newPage(browser: Browser, baseURL: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'limo_locale', value: 'en', url: baseURL }]);
  return ctx.newPage();
}

async function signUpConfirmed(page: Page, email: string) {
  const started = Date.now();
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Limo-e2e-Passw0rd!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();
  await page.goto(linkFrom((await waitForMail(email, /confirm/i, started)).html));
  await page.waitForURL('**/app/onboarding');
  await page.getByLabel('First name').fill('Pay');
  await page.getByLabel('Last name').fill('Customer');
  await page.getByLabel('Country').selectOption('DZ');
  await page.getByLabel('State or region').fill('Algiers');
  await page.getByLabel('Date of birth').fill('1988-03-02');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Continue to workspace' }).click();
  await page.waitForURL(/\/app$/);
}

async function submitPayment(page: Page, reference: string, withReceipt: boolean) {
  await page.goto('/app/billing');
  await page.getByRole('radio', { name: /Creator/ }).click();
  await page.getByRole('radio', { name: 'CCP' }).click();
  await expect(page.locator('.pay-details')).toContainText('12,900 DZD');
  await expect(page.locator('.pay-details')).toContainText('00799999 TEST');
  await page.getByLabel('Transaction reference').fill(reference);
  if (withReceipt) {
    await page.getByLabel('Receipt').setInputFiles({ name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 limo e2e receipt') });
  }
  await page.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(page.getByText('Payment submitted.', { exact: false })).toBeVisible();
  await expect(page.locator('tr', { hasText: reference })).toContainText('Under review');
}

async function adminReview(browser: Browser, baseURL: string, reference: string, approve: boolean, note: string) {
  const admin = await newPage(browser, baseURL);
  await admin.goto('/login');
  await admin.getByLabel('Email').fill(ADMIN_EMAIL!);
  await admin.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD!);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.waitForURL(/\/app/);
  await admin.goto('/admin/payments');
  await passAdminGate(admin);
  const item = admin.locator('.queue-item', { hasText: reference });
  await expect(item).toBeVisible();
  await expect(item).toContainText('12900 DZD');
  if (approve) await expect(item.getByRole('link', { name: 'View receipt' })).toBeVisible();
  await item.getByRole('button', { name: approve ? 'Approve' : 'Reject' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('textbox').fill(note);
  await dialog.getByRole('button', { name: approve ? 'Approve' : 'Reject' }).click();
  await expect(admin.getByText(approve ? 'Payment approved. The plan is active.' : 'Payment rejected.')).toBeVisible();
  await admin.context().close();
}

test('customer pays, admin approves, plan becomes active; a rejection shows its reason', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const customer = await newPage(browser, baseURL!);
  await signUpConfirmed(customer, `payer-${Date.now()}@limo.test`);

  await customer.goto('/app/billing');
  await expect(customer.locator('.badge', { hasText: 'No subscription' }).first()).toBeVisible();

  const ref1 = `CCP-${Date.now()}`;
  await submitPayment(customer, ref1, true);
  await adminReview(browser, baseURL!, ref1, true, 'Seen on statement');

  await customer.reload();
  await expect(customer.locator('#cur-h').locator('..').locator('.badge')).toHaveText('Active');
  await expect(customer.locator('tr', { hasText: ref1 })).toContainText('Approved');
  await customer.goto('/app');
  await expect(customer.getByText('Saving requires an active plan')).toHaveCount(0);

  const ref2 = `CCP-${Date.now()}-B`;
  await submitPayment(customer, ref2, false);
  await adminReview(browser, baseURL!, ref2, false, 'Reference not found on statement');
  await customer.goto('/app/billing');
  const row = customer.locator('tr', { hasText: ref2 });
  await expect(row).toContainText('Rejected');
  await expect(row).toContainText('Reference not found on statement');
});
