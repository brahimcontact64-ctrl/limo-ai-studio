import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';
import { sniffImage } from '../../lib/images/formats';

/**
 * Milestone 6: Image Studio and social posts through the UI — product photo → mock layouts (labelled,
 * nothing invented) → layer editing with undo/redo → revisions and restore → approval lock → real PNG,
 * JPG and WebP downloads (decoded) → social post with caption, approved image, preview and approval →
 * workspace isolation (HTTP 404) → Arabic RTL. Local/staging stack only; nothing is published.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

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

/** A real 640×480 product-style photo (drawn in the browser, encoded as PNG). */
async function productPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4efe6';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#7a4fd6';
    g.fillRect(260, 90, 120, 300);
    g.fillStyle = '#ffffff';
    g.fillRect(280, 180, 80, 60);
    return c.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

const layerX = (page: Page) => page.getByTestId('layer-props').getByLabel('X', { exact: true });
const layerW = (page: Page) => page.getByTestId('layer-props').getByLabel('Width');

async function download(page: Page, format: 'PNG' | 'JPG' | 'WebP') {
  const dialog = page.getByRole('dialog', { name: 'Download image' });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Download', exact: true }).click();
  await dialog.getByRole('radio', { name: format }).click();
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('export-download').click()]);
  await expect(page.getByText('Downloaded and saved to your library', { exact: false }).last()).toBeVisible();
  const bytes = readFileSync((await file.path())!);
  return { name: file.suggestedFilename(), info: sniffImage(new Uint8Array(bytes)), size: bytes.length };
}

test('product ad: mock layouts, layer editing, undo/redo, revisions, approval, real downloads, social post', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(300_000);
  const email = `e2e+images-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // 1. Describe the ad, upload the real product photo, type the facts that may appear.
  await page.goto('/app/images');
  await expect(page.getByRole('heading', { name: 'Image Studio' })).toBeVisible();
  await page.getByRole('link', { name: 'New image' }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Serum ad ${info.project.name}`);
  await page.getByLabel('Describe the image').fill('Clean ad for our new serum. White background, price visible.');
  await page.getByLabel('Product name').fill('Glow Serum');
  await page.getByLabel('Price', { exact: true }).fill('2 400 DA');
  await page.getByLabel('Call to action').fill('Order now');
  await page.getByTestId('photo-upload').setInputFiles({ name: 'serum.png', mimeType: 'image/png', buffer: await productPhoto(page) });
  await expect(page.getByTestId('picked-photos')).toContainText('serum.png');

  // 2. Mock variations: clearly labelled, built only from the user's own photo and text.
  await page.getByRole('button', { name: 'Create variations (mock)' }).click();
  await expect(page.getByTestId('mock-label')).toHaveText('Mock layout — not AI artwork');
  await expect(page.getByRole('button', { name: 'Edit this layout' })).toHaveCount(4);
  await page.getByRole('button', { name: 'Edit this layout' }).first().click();
  await page.waitForURL(/\/app\/images\/[0-9a-f-]{36}$/);
  const imageUrl = page.url();
  await expect(page.getByTestId('image-status')).toHaveText('Draft');
  const layers = page.getByTestId('layer-list');
  await expect(layers).toContainText('Glow Serum');
  await expect(layers).toContainText('2 400 DA');
  await expect(layers).toContainText('Order now');
  await expect(layers).toContainText('Product');
  // No offer was typed, so no offer is shown; no placeholder is left.
  await expect(layers.locator('li')).toHaveCount(4);
  await expect(page.getByTestId('placeholder-warning')).toHaveCount(0);

  // 3. Edit only the selected layer: text, move (drag), undo/redo, resize.
  await layers.getByRole('button', { name: 'Glow Serum', exact: true }).click();
  await page.getByTestId('text-content').fill('Glow Serum — launch week');
  await expect(layers).toContainText('Glow Serum — launch week');
  await layers.getByRole('button', { name: '2 400 DA', exact: true }).click();
  const x0 = Number(await layerX(page).inputValue());
  // On phones the layer list is below the canvas: bring the canvas back into view first.
  await page.getByTestId('editor-stage').scrollIntoViewIfNeeded();
  const sel = await page.getByTestId('selection').boundingBox();
  await page.mouse.move(sel!.x + sel!.width / 2, sel!.y + sel!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sel!.x + sel!.width / 2 - 60, sel!.y + sel!.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  const x1 = Number(await layerX(page).inputValue());
  expect(x1).toBeLessThan(x0 - 50);
  await page.getByTestId('undo').click();
  await expect(layerX(page)).toHaveValue(String(x0));
  await page.getByTestId('redo').click();
  await expect(layerX(page)).toHaveValue(String(x1));
  const w0 = Number(await layerW(page).inputValue());
  await page.getByTestId('editor-stage').scrollIntoViewIfNeeded();
  const handle = await page.locator('.sel-handle.se').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 40, handle!.y + 20, { steps: 5 });
  await page.mouse.up();
  expect(Number(await layerW(page).inputValue())).toBeGreaterThan(w0);
  // The headline was not touched by the move or resize.
  await expect(layers).toContainText('Glow Serum — launch week');

  // 4. Add a price tag: it starts as a [placeholder] that blocks approval until it is replaced.
  await page.getByRole('button', { name: 'Price', exact: true }).click();
  await expect(page.getByTestId('placeholder-warning')).toContainText('1 placeholder');
  await page.getByTestId('text-content').fill('-10% this week');
  await expect(page.getByTestId('placeholder-warning')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // 5. Revisions: restore revision 1 (the original mock layout) as a new revision.
  await page.getByRole('button', { name: 'Revisions' }).click();
  const revs = page.getByRole('dialog', { name: 'Revisions' });
  await expect(revs.getByTestId('image-revisions').locator('li')).toHaveCount(2);
  await revs.locator('li').filter({ hasText: 'Revision 1' }).getByRole('button', { name: 'Restore' }).click();
  await revs.getByRole('button', { name: 'Restore revision 1' }).click();
  await expect(page.getByText('Revision 1 restored')).toBeVisible();
  await expect(page.getByTestId('layer-list')).not.toContainText('launch week');
  await expect(page.getByTestId('layer-list')).not.toContainText('-10% this week');
  await page.getByRole('button', { name: 'Revisions' }).click();
  await expect(page.getByRole('dialog', { name: 'Revisions' }).getByTestId('image-revisions').locator('li')).toHaveCount(3);
  await page.getByRole('dialog', { name: 'Revisions' }).getByRole('button', { name: 'Close' }).click();

  // 6. Preview and approve; the approved design is locked.
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview' });
  await expect(preview.getByText('This is exactly what will be downloaded.')).toBeVisible();
  await preview.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('image-status')).toHaveText('Approved');
  await expect(page.getByTestId('approved-note')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Headline', exact: true })).toHaveCount(0);

  // 7. Real downloads, decoded: format and pixel size come from the file bytes.
  const png = await download(page, 'PNG');
  expect(png.info).toEqual({ format: 'png', width: 1080, height: 1080 });
  expect(png.name).toMatch(/\.png$/);
  const jpg = await download(page, 'JPG');
  expect(jpg.info).toEqual({ format: 'jpeg', width: 1080, height: 1080 });
  expect(jpg.name).toMatch(/\.jpg$/);
  const webp = await download(page, 'WebP');
  expect(webp.info).toEqual({ format: 'webp', width: 1080, height: 1080 });
  await expect(page.getByTestId('export-history').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('export-history')).toContainText('approved version');
  await page.getByRole('dialog', { name: 'Download image' }).getByRole('button', { name: 'Close' }).click();

  // 8. Social post: caption → approved image → preview → approve. Nothing is published.
  await page.goto('/app/posts/new');
  await page.getByLabel('Internal name').fill(`Serum launch ${info.project.name}`);
  await page.getByTestId('post-caption').fill('Our new Glow Serum is here. 2 400 DA.');
  await page.getByLabel('Hashtags').fill('#serum skincare');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);
  const postUrl = page.url();
  await expect(page.getByTestId('post-issues')).toContainText('Choose an image.');
  await expect(page.getByRole('button', { name: 'Approve post' })).toBeDisabled();
  await page.getByRole('button', { name: `Attach: Serum ad ${info.project.name}` }).click();
  await expect(page.getByTestId('post-preview').locator('img')).toBeVisible();
  await expect(page.getByTestId('post-preview')).toContainText('#serum #skincare');
  await page.getByRole('button', { name: 'Approve post' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Approved');
  await expect(page.getByTestId('post-ready')).toContainText('Facebook is not connected yet');
  await expect(page.getByTestId('post-payload')).toContainText('"published": false');
  await expect(page.getByTestId('post-caption')).toBeDisabled();

  // 9. Removing the image approval sends the post back to draft.
  await page.goto(imageUrl);
  await page.getByRole('button', { name: 'Remove approval' }).click();
  await page.getByRole('dialog', { name: 'Remove approval' }).getByRole('button', { name: 'Remove approval' }).click();
  await expect(page.getByTestId('image-status')).toHaveText('Draft');
  await page.goto(postUrl);
  await expect(page.getByTestId('post-status')).toHaveText('Draft');

  // 10. Another workspace: real HTTP 404, nothing shown, no actions.
  const other = await signIn(browser, baseURL!, process.env.E2E_EMAIL!, process.env.E2E_PASSWORD!);
  for (const url of [imageUrl, postUrl]) {
    const res = await other.goto(url);
    expect(res?.status()).toBe(404);
    await expect(other.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(other.getByText(`Serum ad ${info.project.name}`)).toHaveCount(0);
  }
  const imageId = imageUrl.split('/').pop()!;
  const api = await other.request.post(`/api/images/${imageId}`, { data: { action: 'approve' } });
  expect([403, 404]).toContain(api.status());
  const exp = await other.request.post(`/api/images/${imageId}/exports`, { data: { object_path: 'x/exports/y.png', format: 'png', width: 1080, height: 1080 } });
  expect([400, 403, 404]).toContain(exp.status());
  await other.context().close();

  // 11. Arabic, right to left: editor and composer stay usable without sideways scrolling.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(imageUrl);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الطبقات' })).toBeVisible();
  await page.getByTestId('layer-list').getByRole('button', { name: 'Glow Serum', exact: true }).click();
  await page.getByTestId('text-content').fill('سيروم التوهج');
  await expect(page.getByTestId('layer-list')).toContainText('سيروم التوهج');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('تم الحفظ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(postUrl);
  await expect(page.getByTestId('post-status')).toHaveText('مسودة');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('story illustration keeps canonical character identity and cannot be approved with pending artwork', async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e+illus-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  await page.goto('/app/stories');
  await page.getByRole('button', { name: 'New series' }).click();
  const form = page.getByRole('dialog', { name: 'New series' });
  await form.getByLabel('Series title').fill(`Garden tales ${info.project.name}`);
  await form.getByLabel('Premise').fill('Limo helps Grandma in the garden.');
  await form.getByLabel('Limo · Boy').check();
  await form.getByRole('button', { name: 'Create series' }).click();
  await page.waitForURL(/\/app\/stories\/[0-9a-f-]{36}\?tab=bible/);
  await page.getByTestId('series-create-illustration').click();
  await page.waitForURL(/\/app\/images\/new\?series=/);
  await expect(page.getByText('Illustration for the story', { exact: false })).toBeVisible();
  await expect(page.getByText('artwork pending')).toBeVisible();
  await page.getByRole('button', { name: 'Create variations (mock)' }).click();
  await page.getByRole('button', { name: 'Edit this layout' }).first().click();
  await page.waitForURL(/\/app\/images\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('character-meta')).toContainText('Limo');
  await expect(page.getByTestId('character-meta')).toContainText('artwork pending');
  await expect(page.getByTestId('layer-list')).toContainText('[Character artwork pending: Limo');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview' });
  await expect(preview.getByTestId('preview-placeholders')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
});
