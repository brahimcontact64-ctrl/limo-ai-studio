import { test, expect } from '@playwright/test';

/**
 * Signed-in smoke test for any environment (including production) using an EXISTING account
 * with a completed profile and an active subscription. Creates one project and deletes it again.
 * Env: E2E_EMAIL, E2E_PASSWORD
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL / E2E_PASSWORD not set');

test('sign in → create → save → reload → edit → dashboard → delete → sign out', async ({ page }, info) => {
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app$/);

  const title = `E2E smoke ${info.project.name} ${Date.now()}`;
  await page.goto('/app/projects/new?cast=limo_girl,nova_man,adam_woman,adam_elder_woman');
  await page.locator('#project-title-bar').fill(title);
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await page.getByLabel(/Scene title/).fill('Smoke scene one');
  await page.getByRole('button', { name: 'Limo · Girl', exact: true }).click();
  await page.getByRole('button', { name: 'Adam · Grandmother', exact: true }).click();
  await page.locator('.scene-rail').getByRole('button', { name: 'Add scene' }).click();
  await page.getByLabel(/Scene title/).fill('Smoke scene two');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);

  await page.reload();
  await expect(page.locator('#project-title-bar')).toHaveValue(title);
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await expect(page.locator('.scene-name')).toHaveText(['Smoke scene one', 'Smoke scene two']);
  await page.getByRole('tab', { name: /Cast/ }).click();
  await expect(page.getByText('4 of 18 selected')).toBeVisible();

  await page.getByRole('tab', { name: /Scenes/ }).click();
  await page.locator('.scene-select').nth(1).click();
  await page.getByLabel(/Scene title/).fill('Smoke scene two (edited)');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await expect(page.locator('.scene-name').nth(1)).toHaveText('Smoke scene two (edited)');

  await page.goto('/app');
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  // Delete through the UI (lifecycle migration)
  await page.goto('/app/projects');
  const row = page.locator('.project-row', { hasText: title });
  await row.getByRole('button', { name: 'Project actions' }).click();
  await row.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Project deleted.')).toBeVisible();
  await expect(page.locator('.project-row', { hasText: title })).toHaveCount(0);

  await page.getByLabel('Account').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
});
