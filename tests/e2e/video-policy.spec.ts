import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * V1 video policy (owner decision 2026-10-18): every plan, at most 30 s per exported video; one video credit
 * per finished video. Through the UI and the HTTP API: pricing/FAQ copy, a 41 s draft is saved but cannot be
 * approved or exported (UI and server), exactly 30 s is approved, exported and rendered, the credit is used
 * once, downloads and an identical re-export use none, and a legacy over-limit approval is refused by the
 * export API. Needs the render worker running. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

test('V1 video policy: 30 s limit in the Studio, approval and API; one credit per finished video', async ({ page }, info) => {
  test.setTimeout(420_000);
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const email = `e2e+policy-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);

  // Public copy states the rule.
  await page.goto('/pricing');
  await expect(page.getByText('Every video is up to 30 seconds and uses one video credit, whatever its length.')).toBeVisible();
  await expect(page.getByText(/videos of up to 30 s/).first()).toBeVisible();
  await page.goto('/faq');
  await expect(page.getByText('How are video credits counted?')).toBeVisible();

  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: member } = await admin.from('organization_members').select('organization_id').eq('user_id', userId).single();
  const orgId = member!.organization_id as string;
  const used = async () => ((await admin.from('usage_balances').select('used_video_slots').eq('organization_id', orgId).single()).data as { used_video_slots: number }).used_video_slots;

  // A product ad (starter: 18 s) stretched to 41 s in the Video step.
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(`Policy ${info.project.name}`);
  await page.getByLabel('Product name').fill('Limit Serum');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const projectId = projectUrl.split('/').pop()!;
  await page.getByRole('tab', { name: /Video/ }).click();
  await page.getByLabel('Duration of scene 1 (seconds)').fill('15');
  await page.getByLabel('Duration of scene 2 (seconds)').fill('15');
  await expect(page.getByTestId('video-total')).toHaveText('41 s of 30 s');
  await expect(page.getByTestId('video-total')).toHaveAttribute('data-over-limit', 'true');
  await expect(page.getByTestId('export-blocker')).toContainText('Videos are limited to 30 s');
  await expect(page.getByTestId('start-export')).toBeDisabled();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();
  const { data: saved } = await admin.from('studio_projects').select('total_duration_seconds').eq('id', projectId).single();
  expect(saved?.total_duration_seconds, 'a 41 s draft is saved as it is (never truncated)').toBe(41);

  // Approval: blocked in the UI and refused by the server.
  await page.getByRole('tab', { name: /Review/ }).click();
  await expect(page.getByText('Videos are limited to 30 s and this script lasts 41 s')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve script' })).toBeDisabled();
  const { data: current } = await admin.from('studio_projects').select('updated_at').eq('id', projectId).single();
  const refused = await page.request.post(`/api/projects/${projectId}/approval`, { data: { action: 'approve', base_updated_at: current!.updated_at } });
  expect(refused.status()).toBe(422);
  expect(((await refused.json()) as { error: string }).error).toBe('video_too_long');

  // Exactly 30 s: approve, export, render.
  await page.getByRole('tab', { name: /Video/ }).click();
  await page.getByLabel('Duration of scene 2 (seconds)').fill('4');
  await expect(page.getByTestId('video-total')).toHaveText('30 s of 30 s');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
  await page.getByRole('tab', { name: /Video/ }).click();
  await page.getByLabel('Resolution').selectOption('480');
  await page.getByLabel('Quality').selectOption('draft');
  const before = await used();
  await page.getByTestId('start-export').click();
  const row = page.getByTestId('render-list').locator('li').first();
  await expect(row.getByTestId('render-status')).toHaveText('Ready', { timeout: 240_000 });
  await expect(row.getByTestId('render-output')).toContainText('30 s');
  expect(await used(), 'the finished 30 s video used exactly one credit').toBe(before + 1);
  await page.reload();
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByText(/1 of \d+ video credits used this cycle/)).toBeVisible();

  // Downloads and an identical re-export use no credit.
  const jobs = (await (await page.request.get(`/api/projects/${projectId}/video`)).json()) as { jobs: Array<{ id: string }> };
  const jobId = jobs.jobs[0]!.id;
  for (let i = 0; i < 2; i++) expect((await page.request.get(`/api/renders/${jobId}/download`)).status()).toBe(200);
  expect(await used(), 'downloads are free').toBe(before + 1);
  await page.getByTestId('start-export').click();
  await expect(page.getByText('This exact video is already exported — no credit used.')).toBeVisible();
  await expect(page.getByTestId('render-list').locator(':scope > li')).toHaveCount(1);
  expect(await used()).toBe(before + 1);

  // Export API boundary: a script approved before the policy with 35 s is refused (no job, no credit).
  const { data: pr } = await admin.from('studio_projects').select('approved_revision_id').eq('id', projectId).single();
  const { data: rev } = await admin.from('project_revisions').select('snapshot').eq('id', pr!.approved_revision_id).single();
  const legacy = structuredClone(rev!.snapshot) as { scenes: Array<{ duration_seconds: number }> };
  legacy.scenes[0]!.duration_seconds += 5;
  await admin.from('project_revisions').update({ snapshot: legacy }).eq('id', pr!.approved_revision_id);
  try {
    const api = await page.request.post('/api/renders', { data: { project_id: projectId, idempotency_key: `legacy-${Date.now()}`, settings: { aspect: '1:1', resolution: 480, quality: 'draft' } } });
    expect(api.status()).toBe(422);
    expect(((await api.json()) as { error: string }).error).toBe('too_long');
    expect(await used()).toBe(before + 1);
  } finally {
    await admin.from('project_revisions').update({ snapshot: rev!.snapshot }).eq('id', pr!.approved_revision_id);
  }

  // Arabic: the limit is shown right to left.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(projectUrl);
  await page.getByRole('tab', { name: /الفيديو/ }).click();
  await expect(page.getByTestId('video-total')).toHaveText('30 ث من 30 ث');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
