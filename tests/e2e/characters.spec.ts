import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';
import { passAdminGate } from './admin-gate';

/**
 * Milestone 4: canonical characters, reference review and workspace characters. Local/staging stack only.
 * Uploaded images are generated test fixtures, never character artwork; every approved canonical fixture
 * is withdrawn again at the end of the test, so no character is left "approved".
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

// 1×1 PNG fixture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

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

async function uploadFixture(dialog: ReturnType<Page['getByRole']>, view: string) {
  await dialog.getByLabel('Type', { exact: true }).selectOption('rendered_reference');
  await dialog.getByLabel('View', { exact: true }).selectOption(view);
  await dialog.getByLabel('Source', { exact: true }).selectOption('uploaded_artwork');
  await dialog.getByLabel('Source note').fill('E2E test fixture, not artwork');
  await dialog.locator('input[type=file]:enabled').setInputFiles({ name: `${view}.png`, mimeType: 'image/png', buffer: PNG });
  await dialog.getByRole('button', { name: 'Upload for review' }).click();
}

test('admin reviews a canonical reference: open, checklist, approve, withdraw', async ({ browser, baseURL }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_TOTP_SECRET, 'admin credentials not set');
  test.setTimeout(150_000);
  const page = await signIn(browser, baseURL!, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await page.goto('/admin/characters');
  await passAdminGate(page);
  await expect(page.getByRole('heading', { name: 'Character references' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(18);
  await page.getByRole('button', { name: 'Open: Nova · Girl' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova · Girl' });
  await expect(dialog.getByText('Spec v1 · Proposed, awaiting review')).toBeVisible();
  await expect(dialog.getByTestId('char-readiness')).toHaveText('Not ready for generation');
  await expect(dialog.getByTestId('slot-front')).toContainText('Artwork pending');
  await expect(dialog.getByText('No rigged 3D model has been uploaded.')).toBeVisible();
  await expect(dialog.getByText('Family illustration, not a reference')).toBeVisible();

  await uploadFixture(dialog, 'front');
  await expect(page.getByText('Uploaded. It now waits for review.')).toBeVisible();
  const item = dialog.getByTestId('review-item');
  await expect(item).toBeVisible();
  const approve = item.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  await expect(item.getByText('Opened for review')).toBeVisible();
  for (const label of ['Matches the design spec (crown, face, colours)', 'Proportions match the spec', 'Colours match the palette', 'Family-friendly and on-brand', 'Shows the selected view']) {
    await item.getByLabel(label).check();
    await expect(approve).toBeDisabled();
  }
  await item.getByLabel('No text, logos or watermarks').check();
  await approve.click();
  await expect(page.getByText('Reference approved.')).toBeVisible();
  await expect(dialog.getByTestId('slot-front')).toContainText('Approved');
  await expect(dialog.getByTestId('slot-front').getByRole('img')).toBeVisible();
  // One approved view and an unapproved spec: still not ready.
  await expect(dialog.getByTestId('char-readiness')).toHaveText('Not ready for generation');

  // Withdraw the fixture so nothing stays approved.
  await dialog.getByText(/^Approved \(/).click();
  await dialog.getByRole('button', { name: 'Withdraw' }).first().click();
  await dialog.getByPlaceholder('Note').fill('E2E cleanup of a test fixture');
  await dialog.getByRole('button', { name: 'Withdraw' }).first().click();
  await expect(page.getByText('Reference withdrawn.')).toBeVisible();
  await expect(dialog.getByTestId('slot-front')).toContainText('Artwork pending');
  await page.context().close();
});

test('customers see specs and pending artwork, create a character, review its reference and cast it', async ({ page }, info) => {
  test.setTimeout(200_000);
  const email = `e2e+chars-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // Canonical library: 18 characters, none approved, details show the written spec and pending artwork.
  await page.goto('/app/characters');
  await expect(page.getByTestId('approved-count')).toContainText('0/18');
  await page.getByRole('button', { name: 'Details: Limo · Boy' }).click();
  const details = page.getByRole('dialog', { name: 'Limo · Boy' });
  await expect(details.getByRole('heading', { name: 'Design specification' })).toBeVisible();
  await expect(details.locator('.swatches').getByText('#E8412C')).toBeVisible();
  await expect(details.getByTestId('slot-three_quarter')).toContainText('Artwork pending');
  await expect(details.getByRole('button', { name: 'Upload for review' })).toHaveCount(0);
  await expect(details.getByRole('img')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close' }).click();

  // Workspace character.
  await page.getByRole('link', { name: 'Your characters' }).click();
  await page.getByRole('button', { name: 'New character' }).click();
  const form = page.getByRole('dialog', { name: 'New character' });
  await form.getByLabel('Name').fill('Zed');
  await form.getByLabel('Appearance').fill('Round blue mascot with a star badge.');
  await form.getByLabel('Family style').selectOption('nova');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Character saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Details: Zed' }).click();
  const zed = page.getByRole('dialog', { name: 'Zed' });
  await uploadFixture(zed, 'front');
  await expect(page.getByText('Uploaded. It now waits for review.')).toBeVisible();
  const item = zed.getByTestId('review-item');
  await expect(item.getByText('Opened for review')).toBeVisible();
  for (const box of await item.getByRole('checkbox').all()) await box.check();
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Reference approved.')).toBeVisible();
  await expect(zed.getByTestId('slot-front')).toContainText('Approved');
  await zed.getByRole('button', { name: 'Close' }).click();

  // Cast it in a story next to a canonical character.
  await page.goto('/app/projects/new');
  await page.getByLabel('Project title', { exact: true }).first().fill(`Zed story ${info.project.name}`);
  await page.getByRole('tab', { name: /Cast/ }).click();
  await expect(page.getByRole('heading', { name: 'Your characters' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Zed to cast' }).click();
  await page.getByRole('button', { name: 'Add Limo · Boy to cast' }).click();
  await page.getByRole('tab', { name: /Scenes/ }).click();
  await page.getByLabel(/Scene title/).fill('Zed meets Limo');
  await page.getByRole('button', { name: 'Zed', exact: true }).click();
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect(page.getByText('Project created.')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Cast/ }).click();
  await expect(page.locator('.cast-tray')).toContainText('Zed');
  await expect(page.locator('.cast-tray')).toContainText('Limo · Boy');
});

test('Arabic: character library and details are right-to-left and fit the screen', async ({ page }, info) => {
  test.setTimeout(150_000);
  const email = `e2e+chars-ar-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto('/app/characters');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: /^التفاصيل: / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'بطاقة التصميم' })).toBeVisible();
  await expect(dialog.getByText('الرسم قيد الانتظار').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
