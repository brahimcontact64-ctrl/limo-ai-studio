/**
 * Flagship #1 shots 4–6: REAL captures of the running LIMO app (no AI-generated UI), local stack only.
 *   shot 4 (6 s)  Animation Studio storyboard of the flagship project, Arabic UI
 *   shot 5 (8 s)  four real screens ≈ 2 s each: shot editor · post composer · calendar · language switch (AR→FR→EN→DE)
 *   shot 6        the approved LIMO mark (components/brand/Logo.tsx paths) + "LIMO AI" wordmark on the brand colours
 * Captures come from the clean DEMO workspace only (scripts/flagship/seed-demo-workspace.ts: demo account, sample brand
 * labelled « مثال », simulated Page): no test account, no personal data, no secrets. Disabled AI is never shown as
 * working — the composer is filled by hand, nothing is generated.
 * The files are uploaded to the signed-in user's private workspace library and set as the shots' media through the
 * normal function (set_animation_shot_media): the shots go to REVIEW — nothing is approved automatically.
 *
 * Env: APP_URL (http://localhost:3200), SUPABASE_URL (local), SUPABASE_ANON_KEY, CAPTURE_EMAIL (demo …@limo.example), CAPTURE_PASSWORD
 * Usage: node scripts/flagship/capture-limo-ui.ts <animation project id> [--out <dir>] [--no-attach]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (!v) {
    console.error(`Missing env ${k}`);
    process.exit(2);
  }
  return v;
};
const APP = env('APP_URL', 'http://localhost:3200');
const SB = env('SUPABASE_URL');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(SB) || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(APP)) {
  console.error('Local app and stack only.');
  process.exit(2);
}
if (!/@limo\.example$/.test(env('CAPTURE_EMAIL'))) {
  console.error('Captures use the demo workspace only (CAPTURE_EMAIL …@limo.example, see seed-demo-workspace.ts).');
  process.exit(2);
}
const projectId = process.argv[2];
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
  console.error('Usage: node scripts/flagship/capture-limo-ui.ts <animation project id>');
  process.exit(2);
}
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1]! : join(tmpdir(), `limo-flagship-capture-${Date.now()}`);
const FFMPEG = createRequire(join(process.cwd(), 'package.json'))('./worker/node_modules/ffmpeg-static') as string;
const W = 720;
const H = 1280;
const ff = (...a: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

async function signedInContext(browser: Browser, dir: string) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  await ctx.addCookies([{ name: 'limo_locale', value: 'en', url: APP }]);
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`);
  await page.getByLabel('Email').fill(env('CAPTURE_EMAIL'));
  await page.getByLabel('Password', { exact: true }).fill(env('CAPTURE_PASSWORD'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
  await ctx.addCookies([{ name: 'limo_locale', value: 'ar', url: APP }]);
  return { ctx, page };
}

/**
 * Records one segment; returns the video file and the second at which the useful part starts: the moment the segment
 * calls ready() (its screen fully loaded), so no loading state ends up in the cut.
 */
async function record(browser: Browser, name: string, run: (p: Page, ready: () => void) => Promise<void>): Promise<{ file: string; start: number }> {
  const dir = join(OUT, `raw-${name}`);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const { ctx, page } = await signedInContext(browser, dir);
  let start = -1;
  await run(page, () => (start = (Date.now() - t0) / 1000));
  if (start < 0) throw new Error(`segment ${name} never became ready`);
  await ctx.close();
  const file = readdirSync(dir).map((f) => join(dir, f)).find((f) => f.endsWith('.webm'))!;
  return { file, start };
}

async function smoothScroll(page: Page, px: number, ms: number) {
  const steps = Math.max(1, Math.round(ms / 50));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(50);
  }
}

/** Cuts `seconds` of usable video (after page load) into a 24 fps, 720×1280, silent H.264 clip. */
function cut(src: { file: string; start: number }, from: number, seconds: number, dest: string) {
  ff('-ss', String(src.start + from), '-i', src.file, '-t', String(seconds), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', dest);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // Shot 4: the flagship storyboard in Animation Studio (Arabic UI).
    const s4 = await record(browser, 'shot4', async (p, ready) => {
      await p.goto(`${APP}/app/animation/${projectId}`);
      await p.getByTestId('storyboard').waitFor();
      await p.getByTestId('shot-1').waitFor();
      ready();
      await p.waitForTimeout(1500);
      await smoothScroll(p, 1400, 6000);
      await p.waitForTimeout(800);
    });
    // Shot 5: four real screens.
    const a = await record(browser, 'shot5a', async (p, ready) => {
      await p.goto(`${APP}/app/animation/${projectId}`);
      await p.getByTestId('shot-3').scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      ready();
      await p.waitForTimeout(2600);
    });
    const b = await record(browser, 'shot5b', async (p, ready) => {
      await p.goto(`${APP}/app/posts/new`);
      await p.getByTestId('post-caption').waitFor();
      await p.getByTestId('post-caption').scrollIntoViewIfNeeded();
      await p.waitForTimeout(200);
      ready();
      await p.getByTestId('post-caption').pressSequentially('كسكسي الجمعة كيما تاع الدار، مرحبا بيكم!', { delay: 45 });
      await p.waitForTimeout(1200);
    });
    const c = await record(browser, 'shot5c', async (p, ready) => {
      await p.goto(`${APP}/app/posts`);
      await p.getByRole('radio').nth(1).click();
      await p.getByTestId('calendar').waitFor();
      await p.waitForTimeout(200);
      ready();
      await p.waitForTimeout(2600);
    });
    const d = await record(browser, 'shot5d', async (p, ready) => {
      for (const l of ['ar', 'fr', 'en', 'de']) {
        await p.context().addCookies([{ name: 'limo_locale', value: l, url: APP }]);
        await p.goto(`${APP}/app`);
        await p.waitForLoadState('networkidle');
        if (l === 'ar') ready();
        await p.waitForTimeout(450);
      }
    });
    cut(s4, 0.2, 6, join(OUT, 'shot4.mp4'));
    const parts = [[a, 0], [b, 0], [c, 0], [d, 0]] as const;
    parts.forEach(([src, from], i) => cut(src, from, 2, join(OUT, `shot5-${i}.mp4`)));
    ff('-i', join(OUT, 'shot5-0.mp4'), '-i', join(OUT, 'shot5-1.mp4'), '-i', join(OUT, 'shot5-2.mp4'), '-i', join(OUT, 'shot5-3.mp4'),
      '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', join(OUT, 'shot5.mp4'));
    // Shot 6: the approved mark (paths read from components/brand/Logo.tsx) + wordmark, 1080×1920.
    const logo = readFileSync('components/brand/Logo.tsx', 'utf8');
    const svg = /<svg[\s\S]*?<\/svg>/.exec(logo)![0].replace(/\{size\}/g, '420').replace(/className=\{className\}/, '').replace(/aria-hidden="true"/, '').replace(/strokeWidth/g, 'stroke-width').replace(/strokeLinecap/g, 'stroke-linecap').replace(/\{[^}]*\}/g, '');
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.setContent(`<html><body style="margin:0;width:1080px;height:1920px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px;background:linear-gradient(160deg,#f7f5ff,#ece7ff);font-family:Inter,'Segoe UI',sans-serif">${svg}<div style="font-size:150px;font-weight:800;color:#7157ef;letter-spacing:2px" dir="ltr">LIMO AI</div></body></html>`);
    await page.screenshot({ path: join(OUT, 'shot6-logo.png') });
    await page.close();
  } finally {
    await browser.close();
  }
  for (const f of ['shot4.mp4', 'shot5.mp4', 'shot6-logo.png']) console.log('captured', f, statSync(join(OUT, f)).size, 'bytes');
  for (const d of readdirSync(OUT).filter((x) => x.startsWith('raw-') || /^shot5-\d\.mp4$/.test(x))) rmSync(join(OUT, d), { recursive: true, force: true });
  if (process.argv.includes('--no-attach')) return console.log('files in', OUT);

  // Upload to the private workspace library and set as the shots' media (shots go to review, not approved).
  const client = createClient(SB, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error } = await client.auth.signInWithPassword({ email: env('CAPTURE_EMAIL'), password: env('CAPTURE_PASSWORD') });
  if (error || !auth.user) throw new Error(`sign-in failed: ${error?.message}`);
  const rpc = client.rpc.bind(client) as unknown as (fn: string, a: object) => Promise<{ data: any; error: { message: string } | null }>;
  const { data: proj } = await client.from('animation_projects').select('organization_id').eq('id', projectId).single();
  const org = (proj as { organization_id: string }).organization_id;
  const { data: shots } = await client.from('animation_shots').select('id, shot_number').eq('project_id', projectId);
  const shotId = (n: number) => ((shots ?? []) as Array<{ id: string; shot_number: number }>).find((s) => s.shot_number === n)!.id;
  for (const [n, file, mime, kind, label, ms] of [
    [4, 'shot4.mp4', 'video/mp4', 'video', 'LIMO screen capture — Animation Studio (real app)', 6000],
    [5, 'shot5.mp4', 'video/mp4', 'video', 'LIMO screen capture — features (real app)', 8000],
    [6, 'shot6-logo.png', 'image/png', 'logo', 'LIMO logo card (approved mark)', null],
  ] as const) {
    const bytes = readFileSync(join(OUT, file));
    const path = `${org}/${crypto.randomUUID()}.${file.endsWith('.png') ? 'png' : 'mp4'}`;
    const up = await client.storage.from('workspace-assets').upload(path, bytes, { contentType: mime });
    if (up.error) throw new Error(`upload ${file}: ${up.error.message}`);
    const reg = await rpc('register_media_asset', { p_organization_id: org, p_object_path: path, p_kind: kind, p_mime_type: mime, p_size_bytes: bytes.length, p_file_name: file, p_width: file.endsWith('.png') ? 1080 : W, p_height: file.endsWith('.png') ? 1920 : H, p_duration_ms: ms, p_label: label });
    if (reg.error) throw new Error(`register ${file}: ${reg.error.message}`);
    const set = await rpc('set_animation_shot_media', { p_shot_id: shotId(n), p_asset_id: reg.data });
    if (set.error) throw new Error(`shot ${n}: ${set.error.message}`);
    console.log(`shot ${n} → ${file} (${set.data.status})`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
