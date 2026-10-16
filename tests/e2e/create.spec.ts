import { test, expect } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 2: a product advertisement with no characters — upload a product photo, create from the
 * Create content flow, then reload and edit. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('product ad without characters, with an uploaded photo', async ({ page }, info) => {
  // Sign-up, upload, create and reload: longer than the default budget on a cold `next dev`.
  test.setTimeout(150_000);
  const email = `e2e+create-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // Upload a product photo to the workspace library.
  await page.goto('/app/assets');
  await page.getByLabel('Type').first().selectOption('product');
  await page.locator('input[type=file]').setInputFiles({ name: 'serum.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(/1 files? uploaded/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'serum.png' })).toBeVisible();

  // Create content → Product advertisement.
  await page.goto('/app/create');
  await page.getByRole('link', { name: /Product advertisement/ }).click();
  await page.waitForURL('**/app/create/product_ad');
  const title = `Glow serum ${info.project.name}`;
  await page.getByLabel('Project name').fill(title);
  await page.getByLabel('Product name').fill('Glow Serum');
  await page.getByLabel(/Price/).fill('2 400 DA');
  const points = page.getByLabel(/Selling points/);
  await points.fill('Vitamin C');
  await points.press('Enter');
  await points.fill('Fragrance free');
  await points.press('Enter');
  await expect(page.locator('.tag')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add from library' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /serum\.png/ }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.create-form .scene-assets img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Reload: mode, brief, scenes and media come back from Supabase.
  // Saved projects open on the Scenes step.
  await page.reload();
  await expect(page.locator('.scene-name')).toHaveText(['Hook', 'Product reveal', 'Benefits', 'Offer', 'Call to action']);
  await expect(page.locator('.scene-assets img[alt="serum.png"]')).toBeVisible();
  // No character picker in a character-free product ad.
  await expect(page.getByText('Characters in this scene')).toHaveCount(0);
  await page.getByRole('tab', { name: /Cast/ }).click();
  await expect(page.getByText(/Characters are optional/)).toBeVisible();
  await page.getByRole('tab', { name: /Brief/ }).click();
  await expect(page.locator('#creation-mode')).toHaveValue('product_ad');
  await expect(page.getByLabel('Product name')).toHaveValue('Glow Serum');
  await expect(page.getByText('Vitamin C')).toBeVisible();

  // Edit the brief and save again with no cast.
  await page.getByLabel(/Price/).fill('1 990 DA');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.goto(projectUrl);
  await page.getByRole('tab', { name: /Brief/ }).click();
  await expect(page.getByLabel(/Price/)).toHaveValue('1 990 DA');

  // Listed with its type.
  await page.goto('/app/projects');
  const row = page.locator('.project-row', { has: page.getByRole('link', { name: title }) });
  await expect(row.getByText('Product advertisement')).toBeVisible();
});
