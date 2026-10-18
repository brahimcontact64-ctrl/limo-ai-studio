import { spawn } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 10: AI scenes in the Video step.
 *  1. Default (as in production today): the panel says AI generation is not enabled; there is no button and the
 *     API refuses a request — no paid provider can be reached.
 *  2. Local MOCK setup (restored afterwards): exact estimate → explicit confirmation → generation by the mock
 *     generator worker → proposals labelled "Mock — not AI" → the customer uses one for a scene → real MP4 export.
 * Needs the render worker running (like video.spec.ts). Local stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

const STAGES = ['safety', 'script', 'voice', 'scene_image', 'scene_video', 'render', 'export'];

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

async function newApprovedAd(page: Page, title: string) {
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(title);
  await page.getByLabel('Product name').fill('Rose Perfume');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
  return page.url().split('/').pop()!;
}

test('AI scenes: off by default; with mock providers: estimate → confirm → proposals → use → export', async ({ page }, info) => {
  test.setTimeout(420_000);
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const A_ = (t: string) => (admin as any).from(t);
  const email = `e2e+ai-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const orgId = ((await A_('organization_members').select('organization_id').eq('user_id', userId).single()).data as { organization_id: string }).organization_id;

  // 1. Default: not enabled, no button, API refuses.
  const projectId = await newApprovedAd(page, `AI scenes ${info.project.name}`);
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByTestId('ai-unavailable')).toContainText('AI generation is not enabled yet');
  await expect(page.getByTestId('ai-generate')).toHaveCount(0);
  const refused = await page.request.post(`/api/projects/${projectId}/generation`, { data: { confirm_cents: 1, idempotency_key: `try-${Date.now()}` } });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toBe('not_enabled');

  // 2. Local mock setup (restored in finally).
  const { data: registryBefore } = await A_('ai_provider_registry').select('code, is_default, enabled');
  const { data: policyBefore } = await A_('generation_cost_policies').select('*').eq('code', 'standard_v1').single();
  try {
    await A_('ai_provider_registry').update({ is_default: false }).eq('is_default', true);
    for (const stage of STAGES) await A_('ai_provider_registry').upsert({ code: `limo_mock_${stage}`, provider: 'limo-mock', stage_type: stage, model_id: `mock-${stage}`, credential_env_key: 'NONE', enabled: true, is_default: true, pricing_unit: 'internal', pricing_metadata: { test_only: true }, verified_at: new Date().toISOString() });
    await A_('generation_cost_policies').update({ enabled: true, verified_at: new Date().toISOString(), script_flat_cents: 1, voice_per_minute_cents: 1, image_per_scene_cents: 1, video_per_second_cents: 1, render_flat_cents: 1 }).eq('code', 'standard_v1');
    await A_('organizations').update({ ai_enabled: true, monthly_budget_cents: 100_000 }).eq('id', orgId);

    await page.reload();
    await page.getByRole('tab', { name: /Video/ }).click();
    await expect(page.getByTestId('ai-estimate')).toContainText('Estimated AI cost: $');
    await expect(page.getByTestId('ai-estimate')).toContainText('No video credit is used until you export');
    await page.getByTestId('ai-generate').click();
    await expect(page.getByTestId('ai-confirm')).toContainText('is reserved from the AI budget now');
    await page.getByTestId('ai-confirm').getByRole('button', { name: /Confirm \$/ }).click();
    await expect(page.getByText('AI generation started.', { exact: false })).toBeVisible();
    const log = await runGenerator();
    expect(log).toContain('stage completed');
    await page.reload();
    await page.getByRole('tab', { name: /Video/ }).click();
    await expect(page.getByTestId('ai-run-status')).toContainText('Last generation: ready');
    const proposals = page.getByTestId('ai-proposals');
    await expect(proposals).toContainText('Mock — not AI');
    const firstPicture = proposals.locator('li').filter({ hasText: '· picture' }).first();
    const sceneLabel = (await firstPicture.textContent())!.match(/Scene (\d+)/)![1];
    await firstPicture.getByRole('button', { name: `Use for scene ${sceneLabel}` }).click();
    await expect(page.getByText(`Used for scene ${sceneLabel}.`)).toBeVisible();
    await expect(firstPicture).toContainText('used');

    // The generated picture is now that scene's media; the export renders it (one credit, real MP4).
    await expect.poll(async () => ((await A_('video_settings').select('settings').eq('project_id', projectId).single()).data as { settings: { scenes?: Record<string, { media_asset_id?: string }> } } | null)?.settings?.scenes?.[sceneLabel]?.media_asset_id ?? null, { timeout: 10_000 }).not.toBeNull();
    await page.getByLabel('Resolution').selectOption('480');
    await page.getByLabel('Quality').selectOption('draft');
    await page.getByTestId('start-export').click();
    await expect(page.getByTestId('render-list').locator(':scope > li').first().getByTestId('render-status')).toHaveText('Ready', { timeout: 240_000 });
  } finally {
    for (const stage of STAGES) await A_('ai_provider_registry').delete().eq('code', `limo_mock_${stage}`);
    for (const r of (registryBefore ?? []) as Array<{ code: string; is_default: boolean; enabled: boolean }>) await A_('ai_provider_registry').update({ is_default: r.is_default, enabled: r.enabled }).eq('code', r.code);
    await A_('generation_cost_policies').update(policyBefore).eq('code', 'standard_v1');
  }

  // Arabic: the panel is right to left and fits the screen.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.reload();
  await page.getByRole('tab', { name: /الفيديو/ }).click();
  await expect(page.getByTestId('ai-panel')).toContainText('مشاهد الذكاء الاصطناعي');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
