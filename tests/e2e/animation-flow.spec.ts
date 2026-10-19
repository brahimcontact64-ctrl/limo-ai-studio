import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Animation Studio, complete workflow in the browser with MOCK providers (local stack only):
 *   scenario JSON import → storyboard → character selection → approved references → keyframe (mock, automated checks,
 *   identity confirmation) → voices (measured timeline) → clip: mock = "not animated", rejected → simulated provider
 *   clip (a real MP4 TEST FIXTURE standing in for a Veo result) → approval → MP4 export by the render worker → Arabic RTL.
 * What cannot work yet with real animation: real keyframes/clips/voices need accounts, keys, verified prices, the
 * paid flags and approved canonical artwork; here a workspace TEST-FIXTURE character with fixture references is used.
 * Needs the render worker running (like video.spec.ts).
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

const req = createRequire(join(process.cwd(), 'package.json'));
const FFMPEG = req('./worker/node_modules/ffmpeg-static') as string;

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

async function reloadShot(page: Page, n: number) {
  await page.reload();
  return page.getByTestId(`shot-${n}`);
}

test('Animation Studio end to end (mock): import → references → keyframe → identity check → voices → clip → export → Arabic', async ({ page }, info) => {
  test.setTimeout(480_000);
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const A_ = (t: string) => (admin as any).from(t);
  const email = `e2e+animflow-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const orgId = ((await A_('organization_members').select('organization_id').eq('user_id', userId).single()).data as { organization_id: string }).organization_id;

  // Test-fixture workspace character with three approved references (NOT canonical artwork).
  const work = mkdtempSync(join(tmpdir(), 'limo-animflow-'));
  const png = join(work, 'ref.png');
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xe8412c:s=300x400', '-frames:v', '1', png]);
  const { data: ch } = await A_('characters').insert({ organization_id: orgId, name: 'Fixture hero (test only)', spec_version: 1, status: 'active' }).select('id').single();
  for (const view of ['front', 'three_quarter', 'side']) {
    const path = `custom/${orgId}/${ch.id}/fixture-${view}.png`;
    await admin.storage.from('character-library').upload(path, readFileSync(png), { contentType: 'image/png', upsert: true });
    await A_('character_reference_assets').insert({ organization_id: orgId, custom_character_id: ch.id, spec_version: 1, asset_kind: 'rendered_reference', view, object_path: path, mime_type: 'image/png', size_bytes: readFileSync(png).length, provenance: 'uploaded_artwork', provenance_note: 'E2E TEST FIXTURE', status: 'approved' });
  }
  const charId = `custom:${ch.id}`;
  const { data: flagBefore } = await A_('feature_flags').select('enabled').eq('key', 'animation_generation').single();
  await A_('feature_flags').update({ enabled: true }).eq('key', 'animation_generation');
  try {
    // 1. Scenario input: the owner's JSON (placeholder text here — the flagship scenario is the owner's).
    await page.goto('/app/animation');
    await page.getByTestId('new-animation').click();
    await page.getByTestId('new-animation-form').getByLabel('Title').fill(`Flow ${info.project.name}`);
    await page.getByTestId('new-animation-form').getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/app\/animation\/[0-9a-f-]{36}$/);
    await page.getByTestId('anim-import').locator('summary').click();
    await page.getByTestId('anim-import-text').fill(JSON.stringify({ scenes: [{ durationSeconds: 99 }] }));
    await page.getByTestId('anim-import-apply').click();
    await expect(page.getByTestId('anim-import-errors')).toContainText('4, 6 or 8');
    const scenario = {
      title: `Flow ${info.project.name}`, language: 'fr', aspect: '9:16', music: '[music placeholder]',
      scenes: [
        { number: 1, durationSeconds: 8, description: '[scene 1]', environment: '[place]', characters: [charId], actions: { [charId]: '[action]' }, expressions: { [charId]: 'happy' }, camera: '[camera]', dialogue: [{ speaker: charId, text: 'Bonjour à tous.' }], narration: '[narration]', sound: '[sound]' },
        { number: 2, durationSeconds: 6, description: '[scene 2 product]', environment: '[place]', characters: [], camera: '[camera]', dialogue: [] },
      ],
    };
    await page.getByTestId('anim-import-text').fill(JSON.stringify(scenario));
    await page.getByTestId('anim-import-apply').click();
    await expect(page.getByTestId('anim-total')).toHaveText('14 / 30 s');
    const s1 = page.getByTestId('shot-1');
    await expect(s1.getByTestId('shot-description')).toHaveValue('[scene 1]');
    // 2. References: attach two approved references of the fixture character.
    const boxes = s1.getByTestId('shot-references').getByRole('checkbox');
    await expect(boxes).toHaveCount(3);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByTestId('anim-save').click();
    await expect(page.getByText('Storyboard saved.')).toBeVisible();

    // 3. Keyframe → automated checks (honest) → identity confirmation required → approve.
    let shot = await reloadShot(page, 1);
    await shot.getByTestId('req-keyframe').click();
    await expect(page.getByText('Request sent.')).toBeVisible();
    await runGenerator();
    shot = await reloadShot(page, 1);
    await expect(shot.getByTestId('shot-status')).toHaveText('Keyframe to review');
    await expect(shot.getByTestId('auto-checks')).toContainText('Mock image — not AI');
    await expect(shot.getByTestId('review-panel')).toContainText('do not prove');
    await expect(shot.getByTestId('approve')).toBeDisabled();
    await shot.getByTestId('identity-confirm').check();
    await shot.getByTestId('approve').click();
    await expect(shot.getByTestId('shot-status')).toHaveText('Keyframe approved');

    // 4. Voices → measured timeline.
    await shot.getByTestId('req-voice').click();
    await runGenerator();
    await page.reload();
    await page.getByTestId('anim-planning').locator('summary').click();
    await expect(page.getByTestId('anim-timeline')).toContainText('measured');

    // 5. Clip: the mock provider animates nothing → shown as "Not animated" and rejected.
    shot = page.getByTestId('shot-1');
    await shot.getByTestId('req-clip').click();
    await runGenerator();
    shot = await reloadShot(page, 1);
    await expect(shot.getByTestId('clip-kind')).toHaveText('Not animated');
    await expect(shot.getByTestId('clip-not-animated')).toContainText('no animation was generated');
    await shot.getByTestId('reject').click();
    await shot.getByLabel('What should change?').fill('needs real motion');
    await shot.getByRole('button', { name: 'Send' }).click();
    await expect(shot.getByTestId('shot-status')).toHaveText('Keyframe approved');
    await expect(shot.getByTestId('shot-attempts')).toContainText('Clip: 1 attempt');

    // 6. Simulated provider output (TEST FIXTURE: a real MP4, labelled; stands in for a Veo clip).
    const mp4 = join(work, 'clip.mp4');
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=8', '-f', 'lavfi', '-i', 'sine=f=330:d=8', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
    const fixtureClip = async (seconds: number) => {
      const path = `${orgId}/generated/e2e/${crypto.randomUUID()}.mp4`;
      await admin.storage.from('workspace-assets').upload(path, readFileSync(mp4), { contentType: 'video/mp4' });
      const { data: row } = await A_('media_assets').insert({ organization_id: orgId, bucket_id: 'workspace-assets', object_path: path, media_type: 'video', source: 'generated', kind: 'ai_video', mime_type: 'video/mp4', size_bytes: readFileSync(mp4).length, duration_ms: seconds * 1000, label: 'E2E test fixture clip', provenance: { mock: false, ai_generated: false, fixture: true } }).select('id').single();
      const claim = await admin.rpc('claim_ai_jobs', { p_worker_id: 'e2e-sim-provider', p_limit: 1 });
      const job = (claim.data as Array<{ id: string }>)[0]!;
      await admin.rpc('complete_ai_job', { p_job_id: job.id, p_worker_id: 'e2e-sim-provider', p_provider: 'e2e-fixture', p_output: { fixture: true }, p_asset_ids: [row.id], p_estimate_cents: 0, p_actual_cost_cents: 0 });
    };
    await shot.getByTestId('req-clip').click();
    await expect(page.getByText('Request sent.')).toBeVisible();
    await fixtureClip(8);
    shot = await reloadShot(page, 1);
    await expect(shot.getByTestId('clip-kind')).toHaveText('AI animation');
    await expect(shot.getByTestId('approve')).toBeDisabled();
    await shot.getByTestId('identity-confirm').check();
    await shot.getByTestId('approve').click();
    await expect(shot.getByTestId('shot-status')).toHaveText('Approved');

    // Shot 2 (no character): the owner's own media from the library (e.g. a screen recording) + a timed Arabic text.
    const ownPath = `${orgId}/${crypto.randomUUID()}.mp4`;
    await admin.storage.from('workspace-assets').upload(ownPath, readFileSync(mp4), { contentType: 'video/mp4' });
    await A_('media_assets').insert({ organization_id: orgId, bucket_id: 'workspace-assets', object_path: ownPath, media_type: 'video', source: 'uploaded', kind: 'video', mime_type: 'video/mp4', size_bytes: readFileSync(mp4).length, duration_ms: 8000, file_name: 'limo-screen-capture.mp4', label: 'limo-screen-capture.mp4' });
    let s2 = page.getByTestId('shot-2');
    await s2.getByTestId('shot-post').locator('summary').click();
    await s2.getByTestId('add-overlay').click();
    await s2.getByTestId('shot-overlay').getByRole('textbox', { name: 'Text', exact: true }).fill('اصنع. برمج. انشر.');
    await expect(s2.getByTestId('shot-transition')).toBeDisabled(); // last shot: no transition after it
    await page.getByTestId('anim-save').click();
    await expect(page.getByText('Storyboard saved.')).toBeVisible();
    s2 = await reloadShot(page, 2);
    await s2.getByTestId('use-own-media').click();
    const picker = page.getByRole('dialog', { name: 'Add from library' });
    await picker.getByRole('button', { name: /limo-screen-capture/ }).click();
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Media added. Review it, then approve.')).toBeVisible();
    s2 = await reloadShot(page, 2);
    await expect(s2.getByTestId('owner-media')).toContainText('Your media');
    await expect(s2.getByTestId('clip-kind')).toHaveText('Your media');
    await expect(s2.getByTestId('identity-confirm')).toHaveCount(0);
    await s2.getByTestId('approve').click();
    await expect(s2.getByTestId('shot-status')).toHaveText('Approved');

    // 7. Export through the render worker; exporting again uses no second credit.
    await page.getByTestId('anim-export').click();
    await expect(page.getByText('Export queued.')).toBeVisible();
    for (let i = 0; i < 80; i++) {
      await page.reload();
      if (((await page.getByTestId('anim-renders').textContent().catch(() => '')) ?? '').includes('ready')) break;
      await page.waitForTimeout(3000);
    }
    await expect(page.getByTestId('anim-renders')).toContainText('ready · 14 s');
    await page.getByTestId('anim-export').click();
    await expect(page.getByText('no new credit was used')).toBeVisible();

    // 8. Arabic: right-to-left, translated, nothing wider than the screen.
    await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إعدادات الإنتاج' })).toBeVisible();
    await expect(page.getByTestId('shot-1').getByTestId('shot-status')).toHaveText('معتمد');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await A_('feature_flags').update({ enabled: flagBefore?.enabled ?? false }).eq('key', 'animation_generation');
  }
});
