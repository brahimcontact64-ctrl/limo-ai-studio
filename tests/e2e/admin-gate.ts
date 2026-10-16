import { expect, type Page } from '@playwright/test';
import { totp } from '../../scripts/lib/totp';

/** Completes the admin two-factor gate using E2E_ADMIN_TOTP_SECRET (local stack only). */
export async function passAdminGate(page: Page) {
  const secret = process.env.E2E_ADMIN_TOTP_SECRET;
  const gate = page.getByRole('heading', { name: 'Confirm it’s you' });
  if (!(await gate.isVisible().catch(() => false))) return;
  if (!secret) throw new Error('E2E_ADMIN_TOTP_SECRET not set');
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(gate).toHaveCount(0);
}
