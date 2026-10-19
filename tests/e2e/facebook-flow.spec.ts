import { spawn } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Facebook Content Studio, complete workflow in the browser (local stack, MOCK AI worker, simulated Page):
 *   Brand Kit → business brief + facts → AI caption proposal (job, labelled mock) → promotional image proposal
 *   (job, labelled mock) in Image Studio → into the media library → post with the image → review/edit → approval →
 *   calendar → scheduled → simulated publishing by the publisher → history (revisions).
 * Paid AI stays off (`paid_generation`); the AI flags are switched on locally for the test and restored. Nothing is
 * posted on Facebook. Needs the publisher running (like social.spec.ts).
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

function runGenerator(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['worker/src/generator.ts', '--once'], {
      env: { ...process.env, SUPABASE_URL: SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY!, WORKER_ID: `e2e-generator-${Date.now()}`, LIMO_GENERATION_MODE: 'mock', POLL_MS: '200' },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => resolve(out));
  });
}

async function waitForStatus(page: Page, status: string) {
  for (let i = 0; i < 40; i++) {
    await page.reload();
    if ((await page.getByTestId('post-status').textContent())?.includes(status)) return;
    await page.waitForTimeout(1500);
  }
  await expect(page.getByTestId('post-status')).toHaveText(status);
}

test('Facebook Content Studio end to end: Brand Kit → AI caption → AI image → review/edit → approval → calendar → scheduled mock publishing → history', async ({ page }, info) => {
  test.setTimeout(420_000);
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const A_ = (t: string) => (admin as any).from(t);
  const email = `e2e+fbflow-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const { data: flagsBefore } = await A_('feature_flags').select('key, enabled').in('key', ['ai_social_text', 'ai_social_images', 'paid_generation']);
  await A_('feature_flags').update({ enabled: true }).in('key', ['ai_social_text', 'ai_social_images']);
  try {
    expect(((flagsBefore ?? []) as Array<{ key: string; enabled: boolean }>).find((f) => f.key === 'paid_generation')?.enabled).toBe(false);
    // Brand Kit and a simulated Page.
    await page.goto('/app/assets?tab=brand');
    await page.getByLabel('Brand name').fill('Dar Couscous');
    await page.getByLabel('Default call to action').fill('Réservez votre table');
    await page.getByRole('button', { name: 'Save brand kit' }).click();
    await expect(page.getByText('Brand kit saved.')).toBeVisible();
    await page.goto('/app/social');
    await page.getByLabel('Simulated Page name').fill('Dar Couscous (test)');
    await page.getByRole('button', { name: 'Add simulated Page' }).click();
    await expect(page.getByTestId('page-list')).toContainText('Dar Couscous (test)');

    // Promotional image proposal (AI job, mock) → added to the photos → kept privately in the library.
    await page.goto('/app/images/new');
    await page.getByLabel('Name', { exact: true }).fill(`Couscous visual ${info.project.name}`);
    await page.getByTestId('ai-image').getByLabel('Describe the picture (no text inside the image)').fill('A steaming plate of couscous on a wooden table');
    await page.getByTestId('ai-image-generate').click();
    await expect(page.getByTestId('ai-image')).toContainText('Waiting for the AI worker');
    await runGenerator();
    const img = page.getByTestId('ai-image-result');
    await expect(img).toContainText('Mock — not AI', { timeout: 20_000 });
    await img.getByRole('button', { name: 'Add to my photos' }).click();
    await expect(page.getByTestId('picked-photos')).toContainText('AI picture');

    // Business brief → AI caption proposal (job) with the Brand Kit → review and apply.
    await page.goto('/app/posts/new');
    await page.getByLabel('Internal name').fill(`Lunch menu ${info.project.name}`);
    await page.getByLabel('What should the post say?').fill('Promote our Friday couscous lunch menu, warm tone.');
    await page.getByLabel('Business type').selectOption('restaurant');
    await page.getByRole('button', { name: 'Add facts (price, offer…)' }).click();
    await page.getByTestId('facts').getByLabel('Price').fill('1500 DA');
    await page.getByTestId('ai-real-generate').click();
    await runGenerator();
    const prop = page.getByTestId('ai-real-result');
    await expect(prop).toContainText('Mock result — no AI was used', { timeout: 20_000 });
    await expect(prop).toContainText('Dar Couscous');
    await expect(prop).toContainText('1500 DA');
    await prop.getByRole('button', { name: 'Use this proposal' }).click();
    await page.getByTestId('apply-proposal').click();
    await expect(page.getByTestId('post-caption')).toHaveValue(/1500 DA/);
    await expect(page.getByTestId('post-cta')).toHaveValue('Réservez votre table');
    // Mock text keeps a visible [Mock …] marker that blocks approval until a person rewrites it.
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.waitForURL(/\/app\/posts\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('post-issues')).toContainText('[placeholder]');
    // Human edit of the headline and caption, then the AI picture from the library.
    await page.getByTestId('post-headline').fill('Couscous du vendredi');
    await page.getByTestId('post-caption').fill('Couscous du vendredi — 1500 DA. Réservez votre table !');
    await page.getByRole('button', { name: 'Use a library image' }).click();
    const picker = page.getByRole('dialog', { name: 'Add from library' });
    await picker.getByRole('button', { name: /promotional image/ }).first().click();
    await picker.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(page.getByTestId('post-issues')).toHaveCount(0);
    const postId = page.url().split('/').pop()!;

    // AI rewrite of the saved caption (job, labelled mock) → accepted → recorded as an AI suggestion in the history;
    // its [Mock …] marker blocks approval until the person rewrites the text again.
    await page.getByLabel('Rewrite the caption with AI').selectOption('warmer');
    await page.getByTestId('ai-real-rewrite').click();
    await runGenerator();
    const rewritten = page.getByTestId('ai-real-rewritten');
    await expect(rewritten).toContainText('Mock result — no AI was used', { timeout: 20_000 });
    await rewritten.getByRole('button', { name: 'Use this text' }).click();
    await expect(page.getByTestId('post-caption')).toHaveValue(/^\[Mock rewrite — no AI was used\]/);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(page.getByTestId('post-issues')).toContainText('[placeholder]');
    await page.getByTestId('post-caption').fill('Couscous du vendredi, fait maison — 1500 DA. Réservez votre table !');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(page.getByTestId('post-issues')).toHaveCount(0);

    // Review → approval → schedule → simulated publishing → history → calendar.
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByTestId('post-status')).toHaveText('Awaiting review');
    await page.getByRole('button', { name: 'Approve post' }).click();
    await expect(page.getByTestId('post-status')).toHaveText('Approved');
    await page.getByTestId('open-schedule').click();
    const dialog = page.getByRole('dialog', { name: 'Schedule publication' });
    const local = await page.evaluate(() => {
      const d = new Date(Date.now() + 2 * 3_600_000);
      const z = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
    });
    await dialog.getByTestId('schedule-time').fill(local);
    await dialog.getByTestId('confirm-schedule').click();
    await expect(page.getByTestId('post-status')).toHaveText('Scheduled');
    await page.goto('/app/posts');
    await page.getByRole('radio', { name: 'Calendar' }).click();
    await expect(page.getByTestId('calendar')).toContainText(`Lunch menu ${info.project.name}`);
    await A_('publish_jobs').update({ run_at: new Date().toISOString() }).eq('post_id', postId).eq('status', 'queued');
    await page.goto(`/app/posts/${postId}`);
    await waitForStatus(page, 'Published');
    await expect(page.getByTestId('post-ready')).toContainText('Nothing was posted on Facebook');
    await page.getByRole('button', { name: 'Revisions' }).click();
    const revs = page.getByTestId('post-revisions');
    await expect(revs).toContainText('AI suggestion accepted');
    await expect(revs).toContainText('Approved');
  } finally {
    for (const f of (flagsBefore ?? []) as Array<{ key: string; enabled: boolean }>) await A_('feature_flags').update({ enabled: f.enabled }).eq('key', f.key);
  }
});
