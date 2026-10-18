import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 8: Facebook composer → approval → scheduling → SIMULATED publishing through the UI, with the
 * real publisher process running (worker/src/publisher.ts). Nothing is sent to Facebook: Pages are
 * simulated. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const admin = () => createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });

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

/** Simulates time passing: the scheduled publication becomes due now (the publisher picks it up). */
async function makeDue(postId: string) {
  await admin().from('publish_jobs').update({ run_at: new Date().toISOString() }).eq('post_id', postId).eq('status', 'queued');
}

async function waitForStatus(page: Page, text: string) {
  for (let i = 0; i < 30; i++) {
    await page.reload();
    if ((await page.getByTestId('post-status').textContent())?.includes(text)) return;
    await page.waitForTimeout(1500);
  }
  await expect(page.getByTestId('post-status')).toHaveText(text);
}

test('Facebook post: Mock AI draft, editing, review, approval, scheduling, simulated publishing, planner, isolation, RTL', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(360_000);
  const email = `e2e+social-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // A product photo and a simulated Page.
  await page.goto('/app/assets');
  await page.locator('input[type=file]').setInputFiles({ name: 'chicken.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(/1 files? uploaded/)).toBeVisible();
  await page.goto('/app/social');
  await expect(page.getByRole('button', { name: 'Connect Facebook' })).toBeDisabled();
  await expect(page.getByTestId('automation-unavailable')).toBeVisible();
  await page.getByLabel('Simulated Page name').fill('Dar Lemon (test)');
  await page.getByRole('button', { name: 'Add simulated Page' }).click();
  await expect(page.getByTestId('page-list')).toContainText('Dar Lemon (test)');
  await expect(page.getByTestId('page-list')).toContainText('Simulated');

  // Product brief → post without leaving the platform: the composer starts from the project's facts.
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(`Chicken box ${info.project.name}`);
  await page.getByLabel('Product name').fill('Chicken Box');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  await page.getByTestId('project-create-post').click();
  await page.waitForURL(/\/app\/posts\/new\?project=/);
  await expect(page.getByTestId('facts').getByLabel('Product')).toHaveValue('Chicken Box');

  // Mock AI: a request that needs a price the customer did not give → visible placeholder that blocks approval.
  await page.getByLabel('What should the post say?').fill('Create a Facebook post promoting our new Chicken Box with the price, friendly tone and a call to action.');
  await page.getByLabel('Business type').selectOption('restaurant');
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('missing-facts')).toContainText('Price');
  await page.getByTestId('proposal-standard').getByRole('button', { name: 'Use this…' }).click();
  await page.getByTestId('apply-proposal').click();
  await expect(page.getByTestId('post-caption')).toHaveValue(/\[Price\]/);
  await expect(page.getByTestId('post-cta')).toHaveValue('Order now');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);
  const postUrl = page.url();
  const postId = postUrl.split('/').pop()!;
  await expect(page.getByTestId('post-issues')).toContainText('[placeholder]');
  await expect(page.getByRole('button', { name: 'Approve post' })).toBeDisabled();

  // The customer adds the real price and edits the caption; accepting a new draft does not silently overwrite it.
  await page.getByTestId('post-caption').fill('Our new Chicken Box is here. Price: [Price]');
  await page.getByLabel('What should the post say?').fill('Create a Facebook post promoting our new Chicken Box with the price, friendly tone and a call to action.');
  await page.getByLabel('Business type').selectOption('restaurant');
  await page.getByRole('button', { name: 'Add facts (price, offer…)' }).click();
  await page.getByTestId('facts').getByLabel('Product').fill('Chicken Box');
  await page.getByTestId('facts').getByLabel('Price').fill('850 DA');
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('missing-facts')).toHaveCount(0);
  await page.getByTestId('proposal-standard').getByRole('button', { name: 'Use this…' }).click();
  const choose = page.getByTestId('accept-fields');
  await expect(choose.getByRole('checkbox', { name: /Caption/ })).not.toBeChecked();
  await expect(choose).toContainText('replaces your text');
  await choose.getByRole('checkbox', { name: /Caption/ }).check();
  await page.getByTestId('apply-proposal').click();
  await expect(page.getByTestId('post-caption')).toHaveValue(/Price: 850 DA/);
  await expect(page.getByTestId('post-caption')).not.toHaveValue(/\[Price\]/);

  // Rewrite one paragraph: reject a suggestion, accept another.
  const before = await page.getByTestId('post-caption').inputValue();
  await page.getByTestId('paragraph-tools').getByRole('button', { name: 'Rewrite' }).click();
  await page.getByTestId('paragraph-proposal').getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByTestId('post-caption')).toHaveValue(before);
  await page.getByTestId('paragraph-tools').getByRole('button', { name: '2' }).click();
  await page.getByTestId('paragraph-tools').getByRole('button', { name: 'Apply tone' }).click();
  await page.getByTestId('paragraph-proposal').getByRole('button', { name: 'Replace paragraph' }).click();
  await expect(page.getByTestId('post-caption')).not.toHaveValue(before);
  await page.getByTestId('post-headline').fill('Chicken Box — new at Dar Lemon');

  // Media from the library, then save.
  await page.getByRole('button', { name: 'Use a library image' }).click();
  const picker = page.getByRole('dialog', { name: 'Add from library' });
  await picker.getByRole('button', { name: /chicken\.png/ }).click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('post-preview').locator('img')).toBeVisible();
  await expect(page.getByTestId('post-preview')).toContainText('Chicken Box — new at Dar Lemon');
  await expect(page.getByTestId('post-preview')).toContainText('simulated Page');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // Review: send, reject with a note, approve.
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Awaiting review');
  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByTestId('reject-box').getByLabel('What must change?').fill('Mention it is spicy');
  await page.getByTestId('reject-box').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Draft');
  await expect(page.getByTestId('review-note')).toContainText('Mention it is spicy');
  await page.getByRole('button', { name: 'Approve post' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Approved');
  await expect(page.getByTestId('post-caption')).toBeDisabled();

  // Revisions: created, AI suggestion accepted, approval.
  await page.getByRole('button', { name: 'Revisions' }).click();
  const revs = page.getByTestId('post-revisions');
  await expect(revs).toContainText('AI suggestion accepted');
  await expect(revs).toContainText('Approved');
  await page.getByRole('dialog', { name: 'Revisions' }).getByRole('button', { name: 'Close' }).click();

  // Schedule in a chosen time zone (2 minutes ahead), then "time passes" and the publisher publishes it.
  await page.getByTestId('open-schedule').click();
  const dialog = page.getByRole('dialog', { name: 'Schedule publication' });
  await dialog.getByTestId('schedule-zone').selectOption('Africa/Algiers');
  const local = await page.evaluate(() => {
    const d = new Date(Date.now() + 120_000);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)!.value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  });
  await dialog.getByTestId('schedule-time').fill(local);
  await dialog.getByTestId('confirm-schedule').click();
  await expect(page.getByTestId('post-status')).toHaveText('Scheduled');
  await expect(page.getByTestId('scheduled-info')).toContainText('Africa/Algiers');
  await expect(page.getByTestId('scheduled-info')).toContainText('Dar Lemon (test)');
  await makeDue(postId);
  await waitForStatus(page, 'Published');
  await expect(page.getByTestId('post-ready')).toContainText('Nothing was posted on Facebook');
  await expect(page.getByTestId('post-payload')).toContainText('"published": false');
  await expect(page.getByTestId('post-payload')).toContainText('"simulated": true');

  // Planner: list and calendar.
  await page.goto('/app/posts');
  await expect(page.getByTestId('post-list')).toContainText('Published');
  await page.getByRole('radio', { name: 'Calendar' }).click();
  await expect(page.getByTestId('calendar').locator('.calendar-item.published')).toHaveCount(1);

  // Emergency stop blocks scheduling; resuming allows "Publish now".
  await page.goto('/app/posts/new');
  await page.getByLabel('Internal name').fill('Opening hours');
  await page.getByTestId('post-caption').fill('We are open every day.');
  await page.getByRole('button', { name: 'Use a library image' }).click();
  await picker.getByRole('button', { name: /chicken\.png/ }).click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);
  const post2 = page.url();
  await page.getByRole('button', { name: 'Approve post' }).click();
  await expect(page.getByTestId('post-status')).toHaveText('Approved');
  await page.goto('/app/social');
  await page.getByTestId('pause-publishing').click();
  await page.getByRole('dialog', { name: 'Pause all publishing' }).getByRole('button', { name: 'Pause all publishing' }).click();
  await expect(page.getByTestId('resume-publishing')).toBeVisible();
  await page.goto(post2);
  await expect(page.getByTestId('open-schedule')).toBeDisabled();
  await page.goto('/app/social');
  await page.getByTestId('resume-publishing').click();
  await expect(page.getByTestId('pause-publishing')).toBeVisible();
  await page.goto(post2);
  await page.getByTestId('open-schedule').click();
  await page.getByRole('dialog', { name: 'Schedule publication' }).getByTestId('publish-now').click();
  await waitForStatus(page, 'Published');

  // Another workspace: 404 page, refused actions, nothing visible.
  const other = await signIn(browser, baseURL!, process.env.E2E_EMAIL!, process.env.E2E_PASSWORD!);
  expect((await other.goto(postUrl))?.status()).toBe(404);
  expect([403, 404]).toContain((await other.request.post(`/api/posts/${postId}`, { data: { action: 'cancel' } })).status());
  expect(((await (await other.request.get(`/api/posts/${postId}/revisions`)).json()) as { revisions: unknown[] }).revisions).toHaveLength(0);
  await other.context().close();

  // Arabic, right to left.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(postUrl);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('post-status')).toHaveText('منشور');
  await page.goto('/app/posts/new');
  await page.getByLabel('ماذا يجب أن يقول المنشور؟').fill('أنشئ منشوراً على فيسبوك للترويج لوجبة الدجاج الجديدة مع السعر');
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('proposal-standard')).toContainText('وجبة الدجاج الجديدة');
  await expect(page.getByTestId('missing-facts')).toContainText('السعر');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
