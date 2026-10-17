import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 7: video export through the UI. Real sample media (generated with FFmpeg) is uploaded to the
 * library; a product ad's scenes are reordered and re-timed in the Video step, the script is approved,
 * pictures/clip and music are chosen, an MP4 export is queued and rendered by the background worker
 * (must be running), progress is shown, the file is downloaded and decoded, and it really plays in Google
 * Chrome (H.264/AAC). Another workspace gets 404s; Arabic RTL works. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

// Playwright loads specs as CommonJS: use require for the worker's FFmpeg binaries.
const FFMPEG = require('../../worker/node_modules/ffmpeg-static') as string;
const FFPROBE = (require('../../worker/node_modules/ffprobe-static') as { path: string }).path;
const work = mkdtempSync(join(tmpdir(), 'limo-video-spec-'));
const ff = (...args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function samples() {
  const f = (n: string) => join(work, n);
  ff('-f', 'lavfi', '-i', 'color=c=0xd02020:s=800x600', '-frames:v', '1', f('red.png'));
  ff('-f', 'lavfi', '-i', 'color=c=0x20b040:s=640x360:r=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('green.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=0x2040d0:s=1000x800', '-frames:v', '1', f('blue.jpg'));
  ff('-f', 'lavfi', '-i', 'sine=f=220:d=4', '-c:a', 'libmp3lame', '-b:a', '96k', f('music.mp3'));
  return [
    { name: 'red.png', mimeType: 'image/png', buffer: readFileSync(f('red.png')) },
    { name: 'green.mp4', mimeType: 'video/mp4', buffer: readFileSync(f('green.mp4')) },
    { name: 'blue.jpg', mimeType: 'image/jpeg', buffer: readFileSync(f('blue.jpg')) },
    { name: 'music.mp3', mimeType: 'audio/mpeg', buffer: readFileSync(f('music.mp3')) },
  ];
}

function probe(file: string) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString()) as { format: Record<string, string>; streams: Array<Record<string, any>> };
  return { format: j.format.format_name, duration: Number(j.format.duration), v: j.streams.find((s) => s.codec_type === 'video'), a: j.streams.find((s) => s.codec_type === 'audio') };
}
function colourAt(file: string, t: number, w: number, h: number) {
  const raw = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${Math.round(w * 0.1)}:${Math.round(h * 0.1)}:4:${Math.round(h * 0.45)},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const [r, g, b] = [raw[0]!, raw[1]!, raw[2]!];
  return r > g + 60 && r > b + 60 ? 'red' : g > r + 60 && g > b + 60 ? 'green' : b > r + 60 && b > g + 60 ? 'blue' : 'other';
}

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

async function pick(page: Page, opener: string, file: RegExp) {
  await page.getByRole('button', { name: opener }).click();
  const dialog = page.getByRole('dialog', { name: 'Add from library' });
  await dialog.getByRole('button', { name: file }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

test('video export: timeline editing, approval, real MP4 rendering, progress, download, playback, isolation, RTL', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(360_000);
  const email = `e2e+video-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // Real sample media in the library.
  await page.goto('/app/assets');
  await page.locator('input[type=file]').setInputFiles(samples());
  await expect(page.getByText(/4 files? uploaded/)).toBeVisible({ timeout: 30_000 });

  // A character-free product ad (5 starter scenes).
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(`Serum video ${info.project.name}`);
  await page.getByLabel('Product name').fill('Glow Serum');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const projectId = projectUrl.split('/').pop()!;

  // Video step while the script is a draft: reorder scenes and change durations.
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByTestId('video-honesty')).toContainText('Nothing is AI-generated footage');
  await expect(page.getByTestId('export-blocker')).toContainText('Approve the script');
  await expect(page.getByTestId('start-export')).toBeDisabled();
  await page.getByRole('button', { name: 'Move scene 2 earlier' }).click();
  await expect(page.getByTestId('video-scene-1')).toContainText('Product reveal');
  await expect(page.getByTestId('video-scene-2')).toContainText('Hook');
  for (const [n, s] of [[1, 2], [2, 2], [3, 2], [4, 1], [5, 1]] as const) await page.getByLabel(`Duration of scene ${n} (seconds)`).fill(String(s));
  await expect(page.getByTestId('video-total')).toHaveText('8 s in total');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();

  // Approve the script, then the timeline is locked to that revision.
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
  await page.getByRole('tab', { name: /Video/ }).click();
  await expect(page.getByTestId('timeline-locked')).toBeVisible();
  await expect(page.getByLabel('Duration of scene 1 (seconds)')).toHaveCount(0);

  // Media and output choices (presentation only; the approved timeline is unchanged).
  await pick(page, 'Choose picture or clip for scene 1', /green\.mp4/);
  await pick(page, 'Choose picture or clip for scene 2', /red\.png/);
  await pick(page, 'Choose picture or clip for scene 3', /blue\.jpg/);
  await page.getByRole('button', { name: 'Choose audio file' }).click();
  const musicDialog = page.getByRole('dialog', { name: 'Add from library' });
  await musicDialog.getByRole('button', { name: /music\.mp3/ }).click();
  await musicDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('music-name')).toContainText('music.mp3');
  await page.getByLabel('Resolution').selectOption('480');
  await page.getByLabel('Quality').selectOption('draft');
  await expect(page.getByTestId('video-size')).toContainText('480×854');
  await page.getByTestId('storyboard-play').click();
  await expect(page.getByText('Scene 2 of 5')).toBeVisible({ timeout: 5_000 });

  // Export: queued → rendering with progress → ready.
  await page.getByTestId('start-export').click();
  await expect(page.getByText('Export queued', { exact: false })).toBeVisible();
  const row = page.getByTestId('render-list').locator('li').first();
  await expect(row.getByTestId('render-status')).toHaveText(/Waiting|Rendering|Ready/);
  await expect(row.getByTestId('render-status')).toHaveText('Ready', { timeout: 180_000 });
  await expect(row.getByTestId('render-output')).toContainText('8 s');

  // Download the real file and check it.
  const [dl] = await Promise.all([page.waitForEvent('download'), row.getByTestId('render-download').click()]);
  const file = join(work, `download-${info.project.name}.mp4`);
  writeFileSync(file, readFileSync((await dl.path())!));
  expect(dl.suggestedFilename()).toMatch(/^limo-9x16-480x854-r\d+\.mp4$/);
  const p = probe(file);
  expect(p.format).toMatch(/mp4/);
  expect([p.v?.codec_name, p.v?.width, p.v?.height, p.a?.codec_name]).toEqual(['h264', 480, 854, 'aac']);
  expect(Math.abs(p.duration - 8)).toBeLessThanOrEqual(0.25);
  expect([1, 3, 5].map((t) => colourAt(file, t, 480, 854))).toEqual(['green', 'red', 'blue']);

  // In-app preview, and real playback in Google Chrome (H.264/AAC).
  await row.getByRole('button', { name: 'Preview' }).click();
  await expect(row.getByTestId('render-player')).toBeVisible();
  const jobs = (await (await page.request.get(`/api/projects/${projectId}/video`)).json()) as { jobs: Array<{ id: string }> };
  const jobId = jobs.jobs[0]!.id;
  const inline = (await (await page.request.get(`/api/renders/${jobId}/download?inline=1`)).json()) as { url: string };
  const chrome = await chromium.launch({ channel: 'chrome' });
  try {
    const cp = await chrome.newPage();
    await cp.setContent(`<video id="v" muted playsinline src="${inline.url}"></video>`);
    const played = await cp.evaluate(async () => {
      const v = document.getElementById('v') as HTMLVideoElement;
      await v.play();
      // Wait until playback has really advanced (headless timers can start slowly).
      for (let i = 0; i < 50 && v.currentTime < 1; i++) await new Promise((r) => setTimeout(r, 200));
      return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, err: v.error?.code ?? null };
    });
    expect(played.err).toBeNull();
    expect(played.t).toBeGreaterThanOrEqual(1);
    expect([played.w, played.h]).toEqual([480, 854]);
  } finally {
    await chrome.close();
  }

  // Another workspace: no project page, no job, no file link.
  const other = await signIn(browser, baseURL!, process.env.E2E_EMAIL!, process.env.E2E_PASSWORD!);
  expect((await other.goto(projectUrl))?.status()).toBe(404);
  expect((await other.request.get(`/api/renders/${jobId}`)).status()).toBe(404);
  expect((await other.request.get(`/api/renders/${jobId}/download`)).status()).toBe(404);
  expect([403, 404]).toContain((await other.request.post(`/api/renders/${jobId}`, { data: { action: 'retry' } })).status());
  await other.context().close();

  // Arabic, right to left.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(projectUrl);
  await page.getByRole('tab', { name: /الفيديو/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('video-honesty')).toContainText('تركيب فيديو حقيقي');
  await expect(page.getByTestId('render-list').locator('li').first().getByTestId('render-status')).toHaveText('جاهز');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
