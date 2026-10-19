import { spawn } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Animation Studio storyboard editor + Facebook Content Studio AI hooks in the browser.
 *  1. Animation Studio: create → write shots (placeholder text — the flagship scenario is the owner's) → canonical
 *     character, dialogue, continuity → save → reload keeps it; 30-second limit; generation buttons stay disabled
 *     and the API refuses while `animation_generation` is off (the default).
 *  2. Composer and Image Studio: by default the real-AI sections say "not enabled". With `ai_social_text` on locally
 *     and the MOCK generator worker, a caption request returns a labelled mock proposal that the customer reviews and
 *     applies through the per-field choice. Flags are restored afterwards. Local stack only.
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

test('Animation Studio storyboard: write, save, 30 s limit, generation gated; Facebook AI hooks off by default, mock caption with review', async ({ page }, info) => {
  test.setTimeout(300_000);
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const A_ = (t: string) => (admin as any).from(t);
  const email = `e2e+anim-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // ---- Animation Studio ----------------------------------------------------------------------------------------
  await page.goto('/app/animation');
  await expect(page.getByRole('heading', { name: 'Animation Studio' })).toBeVisible();
  await page.getByTestId('new-animation').click();
  await page.getByTestId('new-animation-form').getByLabel('Title').fill(`Storyboard ${info.project.name}`);
  await page.getByTestId('new-animation-form').getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/animation\/[0-9a-f-]{36}$/);
  const projectId = page.url().split('/').pop()!;
  await expect(page.getByTestId('anim-flag-off')).toContainText('AI animation is not enabled');

  await page.getByTestId('add-shot').click();
  const s1 = page.getByTestId('shot-1');
  await s1.getByTestId('shot-description').fill('[scene placeholder]');
  await s1.getByTestId('shot-environment').fill('[setting placeholder]');
  await s1.getByTestId('shot-add-character').selectOption('limo_man');
  await expect(s1.getByTestId('shot-char-limo_man')).toBeVisible();
  await s1.getByRole('button', { name: 'Add line' }).click();
  await s1.getByRole('textbox', { name: 'Line', exact: true }).fill('[line placeholder]');
  await expect(s1.getByTestId('shot-references')).toContainText('No approved artwork exists');
  await expect(page.getByTestId('anim-total')).toHaveText('8 / 30 s');
  await page.getByTestId('anim-save').click();
  await expect(page.getByText('Storyboard saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('shot-1').getByTestId('shot-description')).toHaveValue('[scene placeholder]');
  await expect(page.getByTestId('shot-1').getByTestId('shot-status')).toHaveText('Draft');
  await expect(page.getByTestId('anim-blockers')).toContainText('design spec not approved');
  await expect(page.getByTestId('req-keyframe')).toBeDisabled();

  // The API refuses generation while the flag is off (same as production today).
  const shotId = ((await A_('animation_shots').select('id').eq('project_id', projectId).single()).data as { id: string }).id;
  const refused = await page.evaluate(async ([p, s]) => {
    const r = await fetch(`/api/animation/${p}/shots/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'job', kind: 'animation_keyframe', idempotency_key: 'browser-test-key-1', confirm_cents: 0 }) });
    return { status: r.status, body: await r.json() };
  }, [projectId, shotId]);
  expect(refused).toEqual({ status: 403, body: expect.objectContaining({ error: 'not_enabled' }) });

  // 30-second limit: four more 8 s shots (40 s) cannot be saved.
  for (let i = 0; i < 3; i++) await page.getByTestId('add-shot').click();
  await expect(page.getByTestId('anim-total')).toHaveText('32 / 30 s');
  await expect(page.getByRole('alert').filter({ hasText: 'Over the 30-second limit' })).toBeVisible();
  await expect(page.getByTestId('anim-save')).toBeDisabled();
  await page.getByTestId('shot-4').getByLabel('Length').selectOption('6');
  await expect(page.getByTestId('anim-total')).toHaveText('30 / 30 s');
  await expect(page.getByTestId('anim-save')).toBeEnabled();

  // ---- Facebook Content Studio AI hooks --------------------------------------------------------------------------
  const { data: flagsBefore } = await A_('feature_flags').select('key, enabled').in('key', ['ai_social_text', 'ai_social_images']);
  try {
    await page.goto('/app/posts/new');
    await expect(page.getByTestId('ai-real-disabled')).toContainText('Real AI captions are not enabled yet');
    await page.goto('/app/images/new');
    await expect(page.getByTestId('ai-image-disabled')).toContainText('AI pictures are not enabled yet');

    await A_('feature_flags').update({ enabled: true }).eq('key', 'ai_social_text');
    await page.goto('/app/posts/new');
    await page.getByLabel('What should the post say?').fill('Promote our lunch menu, friendly tone.');
    await page.getByRole('button', { name: 'Add facts (price, offer…)' }).click();
    await page.getByTestId('facts').getByLabel('Price').fill('1200 DA');
    await page.getByTestId('ai-real-generate').click();
    await expect(page.getByText('Waiting for the AI worker…')).toBeVisible();
    await runGenerator();
    const result = page.getByTestId('ai-real-result');
    await expect(result).toContainText('Mock result — no AI was used', { timeout: 20_000 });
    await expect(result).toContainText('1200 DA');
    await result.getByRole('button', { name: 'Use this proposal' }).click();
    await page.getByTestId('apply-proposal').click();
    await expect(page.getByTestId('post-caption')).toHaveValue(/Mock AI caption — no AI was used.*1200 DA/);
  } finally {
    for (const f of (flagsBefore ?? []) as Array<{ key: string; enabled: boolean }>) await A_('feature_flags').update({ enabled: f.enabled }).eq('key', f.key);
    await A_('animation_projects').delete().eq('id', projectId);
  }
});
