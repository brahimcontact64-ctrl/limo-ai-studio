import { test, expect, type Browser, type Page } from '@playwright/test';
import { MAILPIT, linkFrom, waitForMail } from './mail';

/**
 * Email confirmation and password recovery through real emails.
 * Needs a Supabase stack with email confirmation ON, the LIMO templates (supabase/templates),
 * and a Mailpit inbox: E2E_MAILPIT_URL (e.g. http://127.0.0.1:58024). Local stack only.
 */
test.skip(!MAILPIT, 'E2E_MAILPIT_URL not set');

async function freshPage(browser: Browser, baseURL: string, locale = 'en'): Promise<Page> {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'limo_locale', value: locale, url: baseURL }]);
  return ctx.newPage();
}

const PASSWORD = 'Limo-e2e-Passw0rd!';

test('sign-up confirmation works from another device, in the customer language', async ({ browser, baseURL }) => {
  const email = `confirm-${Date.now()}@limo.test`;
  const page = await freshPage(browser, baseURL!, 'fr');
  const started = Date.now();
  await page.goto('/signup');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await expect(page.getByText('Consultez votre boîte de réception')).toBeVisible();

  // Not confirmed yet: sign-in is refused and offers to resend.
  const signin = await freshPage(browser, baseURL!, 'en');
  await signin.goto('/login');
  await signin.getByLabel('Email').fill(email);
  await signin.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await signin.getByRole('button', { name: 'Sign in' }).click();
  await expect(signin.getByText('Please confirm your email address before signing in.')).toBeVisible();
  await expect(signin.getByRole('button', { name: 'Resend confirmation email' })).toBeVisible();

  const mail = await waitForMail(email, /confirm/i, started);
  expect(mail.html).toContain('Confirmez votre adresse e-mail'); // French template branch

  // Open the link in a different browser context (another device): token_hash must still work.
  const other = await freshPage(browser, baseURL!, 'fr');
  await other.goto(linkFrom(mail.html));
  await other.waitForURL('**/app/onboarding');
  await expect(other.getByRole('heading', { name: 'Complétez votre profil' })).toBeVisible();
});

test('resend confirmation sends a new email', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const email = `resend-${Date.now()}@limo.test`;
  const page = await freshPage(browser, baseURL!);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();
  await waitForMail(email, /confirm/i, Date.now() - 10_000);
  // Supabase allows one email per address per 60 s; the button starts in cooldown.
  await expect(page.getByRole('button', { name: /You can resend in \d+ s\./ })).toBeDisabled();
  const resend = page.getByRole('button', { name: 'Resend confirmation email' });
  await expect(resend).toBeEnabled({ timeout: 75_000 });
  const before = Date.now();
  await resend.click();
  await expect(page.getByText(`A new confirmation email is on its way to ${email}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: /You can resend in \d+ s\./ })).toBeDisabled();
  const again = await waitForMail(email, /confirm/i, before);
  expect(linkFrom(again.html)).toContain('type=email');
});

test('password recovery: email link → new password → sign in with it', async ({ browser, baseURL }) => {
  const email = `recover-${Date.now()}@limo.test`;
  // Create and confirm an account through the UI first.
  const page = await freshPage(browser, baseURL!);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  const confirm = await waitForMail(email, /confirm/i, Date.now() - 10_000);
  await page.goto(linkFrom(confirm.html));
  await page.waitForURL('**/app/onboarding');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');

  // Reset page without a recovery session shows a clear state.
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'This reset link is no longer valid' })).toBeVisible();

  const started = Date.now();
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
  const mail = await waitForMail(email, /reset/i, started);

  const device = await freshPage(browser, baseURL!);
  await device.goto(linkFrom(mail.html));
  await device.waitForURL('**/reset-password');
  const newPassword = 'Limo-new-Passw0rd!';
  await device.getByLabel('New password').fill(newPassword);
  await device.getByLabel('Confirm password').fill(newPassword);
  await device.getByRole('button', { name: 'Update password' }).click();
  await device.waitForURL(/\/app/);

  // Old password no longer works, new one does.
  const check = await freshPage(browser, baseURL!);
  await check.goto('/login');
  await check.getByLabel('Email').fill(email);
  await check.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await check.getByRole('button', { name: 'Sign in' }).click();
  await expect(check.getByText('Email or password is incorrect.')).toBeVisible();
  await check.getByLabel('Password', { exact: true }).fill(newPassword);
  await check.getByRole('button', { name: 'Sign in' }).click();
  await check.waitForURL(/\/app/);

  // A used reset link cannot be replayed.
  const replay = await freshPage(browser, baseURL!);
  await replay.goto(linkFrom(mail.html));
  await replay.waitForURL('**/forgot-password?error=link');
  await expect(replay.getByText('This link is invalid or has expired. Request a new one.')).toBeVisible();
});
