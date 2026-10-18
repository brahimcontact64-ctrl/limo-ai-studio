import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 9: complete customer journeys through the UI, end to end, with the render worker and the
 * publisher running. Generation is Mock AI / layout-only and Facebook is simulated — the tests assert that
 * these labels are shown, so the journeys prove the product flow, not AI quality.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

async function startWorkspace(page: Page, tag: string, project: string) {
  const email = `e2e+journey-${tag}-${project}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  return email;
}

async function photo(page: Page, color: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((c) => {
    const el = document.createElement('canvas');
    el.width = 600;
    el.height = 450;
    const g = el.getContext('2d')!;
    g.fillStyle = c;
    g.fillRect(0, 0, 600, 450);
    return el.toDataURL('image/png');
  }, color);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

async function simulatedPage(page: Page) {
  await page.goto('/app/social');
  await page.getByLabel('Simulated Page name').fill('My Page (test)');
  await page.getByRole('button', { name: 'Add simulated Page' }).click();
  await expect(page.getByTestId('page-list')).toContainText('My Page (test)');
}

async function approveScript(page: Page) {
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
}

async function exportVideo(page: Page) {
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByTestId('video-honesty')).toContainText('Nothing is AI-generated footage');
  await page.getByLabel('Resolution').selectOption('480');
  await page.getByLabel('Quality').selectOption('draft');
  await page.getByTestId('start-export').click();
  const row = page.getByTestId('render-list').locator('li').first();
  await expect(row.getByTestId('render-status')).toHaveText('Ready', { timeout: 240_000 });
  return row;
}

async function publishNow(page: Page) {
  await page.getByTestId('open-schedule').click();
  await page.getByRole('dialog', { name: 'Schedule publication' }).getByTestId('publish-now').click();
  for (let i = 0; i < 30; i++) {
    await page.reload();
    if ((await page.getByTestId('post-status').textContent())?.includes('Published')) break;
    await page.waitForTimeout(1500);
  }
  await expect(page.getByTestId('post-status')).toHaveText('Published');
  await expect(page.getByTestId('post-ready')).toContainText('Nothing was posted on Facebook');
}

test('product seller: product details → script → image → video → export → social post → approval → simulated publishing', async ({ page }, info) => {
  test.setTimeout(600_000);
  await startWorkspace(page, 'seller', info.project.name);
  await simulatedPage(page);
  await page.goto('/app/assets');
  await page.locator('input[type=file]').setInputFiles({ name: 'perfume.png', mimeType: 'image/png', buffer: await photo(page, '#c03060') });
  await expect(page.getByText(/1 files? uploaded/)).toBeVisible();

  // Product details → project with the product photo in its scenes.
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(`Rose perfume ${info.project.name}`);
  await page.getByLabel('Product name').fill('Rose Perfume');
  await page.getByLabel(/Price/).fill('3 900 DA');
  await page.getByRole('button', { name: 'Add from library' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /perfume\.png/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Script → approval.
  await approveScript(page);

  // Image: mock layout from the product photo → approve.
  await page.getByTestId('project-create-image').click();
  await page.waitForURL(/\/app\/images\/new\?project=/);
  await expect(page.getByTestId('picked-photos')).toContainText('perfume.png');
  await page.getByRole('button', { name: 'Create variations (mock)' }).click();
  await expect(page.getByTestId('mock-label')).toHaveText('Mock layout — not AI artwork');
  await page.getByRole('button', { name: 'Edit this layout' }).first().click();
  await page.waitForURL(/\/app\/images\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preview' }).getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('image-status')).toHaveText('Approved');

  // Video → MP4 export of the approved script.
  await page.goto(projectUrl);
  const row = await exportVideo(page);
  await expect(row.getByTestId('render-output')).toContainText('H.264 + AAC');

  // Social post from the project, using the exported video.
  await page.goto(projectUrl);
  await page.getByTestId('project-create-post').click();
  await page.waitForURL(/\/app\/posts\/new\?project=/);
  await expect(page.getByTestId('facts').getByLabel('Price')).toHaveValue('3 900 DA');
  await page.getByTestId('ai-generate').click();
  await page.getByTestId('proposal-standard').getByRole('button', { name: 'Use this…' }).click();
  await page.getByTestId('apply-proposal').click();
  await expect(page.getByTestId('post-caption')).toHaveValue(/3 900 DA/);
  await page.getByRole('radio', { name: 'MP4 videos' }).click();
  await page.getByTestId('video-pick').getByRole('button', { name: /Use video/ }).first().click();
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Approve post' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Approved');
  await publishNow(page);
});

test('story creator: series → Story Bible → episode → approved ending → Continue Story → illustration → video export', async ({ page }, info) => {
  test.setTimeout(600_000);
  await startWorkspace(page, 'story', info.project.name);
  await page.goto('/app/stories');
  await page.getByRole('button', { name: 'New series' }).click();
  const form = page.getByRole('dialog', { name: 'New series' });
  await form.getByLabel('Series title').fill(`Garden days ${info.project.name}`);
  await form.getByLabel('Premise').fill('Limo and Grandma grow vegetables together.');
  await form.getByLabel('First location').fill('Garden');
  await form.getByLabel('Limo · Boy').check();
  await form.getByLabel('Nova · Grandmother').check();
  await form.getByRole('button', { name: 'Create series' }).click();
  await page.waitForURL(/\/app\/stories\/[0-9a-f-]{36}\?tab=bible/);
  const seriesUrl = page.url().split('?')[0]!;
  await expect(page.getByText('Version 1')).toBeVisible();

  // Episode 1 → approved script → approved ending.
  await page.goto(`${seriesUrl}?tab=episodes`);
  await page.getByRole('button', { name: 'Start episode 1' }).click();
  await page.waitForURL(/\/episodes\/1$/);
  await page.getByRole('link', { name: 'Open script' }).click();
  await page.waitForURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const episodeProject = page.url();
  await approveScript(page);
  await page.getByRole('link', { name: 'Open story page' }).click();
  await expect(page.getByTestId('episode-script-status')).toHaveText('Approved');
  await page.getByRole('button', { name: /Suggest from script/ }).click();
  await expect(page.getByText('Mock AI suggestion loaded', { exact: false })).toBeVisible();
  await page.getByLabel('Summary').fill('They plant tomatoes.');
  await page.getByLabel('Ending hook').fill('A strange sprout appears.');
  await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Garden' });
  await page.getByRole('button', { name: 'Save ending' }).click();
  await expect(page.getByText('Ending saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve episode' }).click();
  await expect(page.getByTestId('episode-status')).toHaveText('Episode approved');

  // Continue Story → episode 2 starts from that ending.
  await page.goto(`${seriesUrl}?tab=episodes`);
  await page.getByRole('button', { name: 'Continue story' }).click();
  await page.waitForURL(/\/episodes\/2$/);
  await expect(page.getByTestId('starting-point')).toContainText('A strange sprout appears.');

  // Illustration keeps the canonical characters' identity and says the artwork is pending.
  await page.goto(seriesUrl);
  await page.getByTestId('series-create-illustration').click();
  await page.getByRole('button', { name: 'Create variations (mock)' }).click();
  await page.getByRole('button', { name: 'Edit this layout' }).first().click();
  await page.waitForURL(/\/app\/images\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('character-meta')).toContainText('artwork pending');

  // Video export of the approved episode (text cards and a "characters not animated" note).
  await page.goto(episodeProject);
  const row = await exportVideo(page);
  await expect(row).toContainText('Characters are not animated');
});

test('business owner: Brand Kit → content brief → Mock AI draft → review → scheduling → simulated publishing', async ({ page }, info) => {
  test.setTimeout(600_000);
  await startWorkspace(page, 'business', info.project.name);
  await simulatedPage(page);
  await page.goto('/app/assets?tab=brand');
  await page.getByLabel('Brand name').fill('Atlas Bakery');
  await page.getByLabel('Default call to action').fill('Visit us today');
  await page.getByRole('button', { name: 'Save brand kit' }).click();
  await expect(page.getByText('Brand kit saved.')).toBeVisible();
  await page.goto('/app/assets');
  await page.locator('input[type=file]').setInputFiles({ name: 'bread.png', mimeType: 'image/png', buffer: await photo(page, '#d0a050') });
  await expect(page.getByText(/1 files? uploaded/)).toBeVisible();

  await page.goto('/app/create/business_promo');
  await page.getByLabel('Project name').fill(`Bakery week ${info.project.name}`);
  await page.getByLabel('Business name').fill('Atlas Bakery');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  await page.getByTestId('project-create-post').click();
  await page.waitForURL(/\/app\/posts\/new\?project=/);

  // Mock AI draft uses the brand kit (name, call to action) and invents nothing.
  await page.getByLabel('What should the post say?').fill('Announce our fresh bread every morning, friendly tone.');
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('proposal-standard')).toContainText('Atlas Bakery');
  await expect(page.getByTestId('proposal-standard')).toContainText('Visit us today');
  await page.getByTestId('proposal-standard').getByRole('button', { name: 'Use this…' }).click();
  await page.getByTestId('apply-proposal').click();
  await page.getByRole('button', { name: 'Use a library image' }).click();
  const picker = page.getByRole('dialog', { name: 'Add from library' });
  await picker.getByRole('button', { name: /bread\.png/ }).click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);

  // Review → approve → schedule (then "time passes") → simulated publishing.
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Awaiting review');
  await page.getByRole('button', { name: 'Approve post' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Approved');
  await page.getByTestId('open-schedule').click();
  const dialog = page.getByRole('dialog', { name: 'Schedule publication' });
  const local = await page.evaluate(() => {
    const d = new Date(Date.now() + 3 * 3_600_000);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  });
  await dialog.getByTestId('schedule-time').fill(local);
  await dialog.getByTestId('confirm-schedule').click();
  await expect(page.getByTestId('post-status')).toHaveText('Scheduled');
  const postId = page.url().split('/').pop()!;
  await createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } }).from('publish_jobs').update({ run_at: new Date().toISOString() }).eq('post_id', postId).eq('status', 'queued');
  for (let i = 0; i < 30; i++) {
    await page.reload();
    if ((await page.getByTestId('post-status').textContent())?.includes('Published')) break;
    await page.waitForTimeout(1500);
  }
  await expect(page.getByTestId('post-status')).toHaveText('Published');
  await expect(page.getByTestId('post-ready')).toContainText('Nothing was posted on Facebook');
});
