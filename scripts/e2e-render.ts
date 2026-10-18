/**
 * Real MP4 rendering end to end against the LOCAL stack (Milestone 7).
 *
 * As real users: upload sample images, a video clip, narration and music (generated with FFmpeg),
 * build and approve a 3-scene product ad, queue exports in all four formats, run the real render worker
 * (worker/src/index.ts, service role — local only), then download every file through a user-signed link
 * and verify container, codecs, size, duration, audio, full decode and scene order. Also: idempotency,
 * the active-render limit, workspace isolation of jobs and files, recovery of a failed render (missing
 * input → fixed → retry), takeover of a job whose worker died, cancellation while queued and while rendering.
 * V1 video policy (migration 20261018090000): 30 s maximum (exactly 30 s renders, 31 s cannot be approved,
 * legacy over-limit exports/retries refused), one credit per finished video (reserved → consumed /
 * released), no charge for downloads, identical re-exports, worker retries or lease takeovers, the credit
 * limit, and a ledger that matches the balance.
 *
 * Env: SUPABASE_URL (must be localhost), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *      E2E_A_EMAIL/E2E_A_PASSWORD, E2E_B_EMAIL/E2E_B_PASSWORD, RENDER_OUT (optional: keep the MP4s)
 * Usage: node scripts/e2e-render.ts
 */
import { assertNoForeignWorkers } from '../worker/src/lock.ts';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emptyProject, newScene, toSaveRequest } from '../lib/studio/draft.ts';
import { toRpcArgsV2 } from '../lib/studio/validation.ts';
import type { ProjectDraft } from '../lib/studio/types.ts';
import { DEFAULT_VIDEO_SETTINGS, type VideoAspect } from '../lib/video/types.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env ${k}`);
    process.exit(2);
  }
  return v;
};
const URL_ = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) {
  console.error('This test uses the service role and runs only against a local stack.');
  process.exit(2);
}
const req = createRequire(import.meta.url);
const FFMPEG = req('../worker/node_modules/ffmpeg-static') as string;
const FFPROBE = (req('../worker/node_modules/ffprobe-static') as { path: string }).path;

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

type Rpc = (fn: string, args?: object) => Promise<{ data: any; error: { message: string } | null }>;
interface Session {
  client: SupabaseClient;
  orgId: string;
  rpc: Rpc;
  db: (t: string) => any;
}
async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const { data: m } = await client.from('organization_members').select('organization_id').eq('user_id', data.user.id);
  return { client, orgId: m![0]!.organization_id as string, rpc: client.rpc.bind(client) as unknown as Rpc, db: (t) => (client as any).from(t) };
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const adminRpc = admin.rpc.bind(admin) as unknown as Rpc;

const work = mkdtempSync(join(tmpdir(), 'limo-e2e-render-'));
const ff = (...args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/** Sample media made with FFmpeg: distinct colours make scene order measurable in the output. */
function makeSamples() {
  const f = (n: string) => join(work, n);
  ff('-f', 'lavfi', '-i', 'color=c=0xd02020:s=900x700', '-frames:v', '1', f('red.png'));
  ff('-f', 'lavfi', '-i', 'color=c=0x20b040:s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=f=330:d=3', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('green.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=0x2040d0:s=1200x900', '-frames:v', '1', '-q:v', '3', f('blue.jpg'));
  ff('-f', 'lavfi', '-i', 'sine=f=440:d=2.5', '-ar', '48000', f('voice.wav'));
  ff('-f', 'lavfi', '-i', 'sine=f=220:d=5', '-c:a', 'libmp3lame', '-b:a', '96k', f('music.mp3'));
  ff('-f', 'lavfi', '-i', 'color=c=white:s=300x300', '-frames:v', '1', f('logo.png'));
  return {
    red: { file: f('red.png'), mime: 'image/png', kind: 'product', w: 900, h: 700 },
    green: { file: f('green.mp4'), mime: 'video/mp4', kind: 'video', w: 640, h: 360 },
    blue: { file: f('blue.jpg'), mime: 'image/jpeg', kind: 'photo', w: 1200, h: 900 },
    voice: { file: f('voice.wav'), mime: 'audio/wav', kind: 'audio', w: null, h: null },
    music: { file: f('music.mp3'), mime: 'audio/mpeg', kind: 'audio', w: null, h: null },
    logo: { file: f('logo.png'), mime: 'image/png', kind: 'logo', w: 300, h: 300 },
  };
}
type Sample = ReturnType<typeof makeSamples>[keyof ReturnType<typeof makeSamples>];

async function upload(s: Session, sample: Sample, name: string): Promise<{ id: string; path: string }> {
  const ext = sample.file.split('.').pop()!;
  const path = `${s.orgId}/${crypto.randomUUID()}.${ext}`;
  const bytes = readFileSync(sample.file);
  const up = await s.client.storage.from('workspace-assets').upload(path, bytes, { contentType: sample.mime });
  if (up.error) throw new Error(`upload ${name}: ${up.error.message}`);
  const reg = await s.rpc('register_media_asset', {
    p_organization_id: s.orgId, p_object_path: path, p_kind: sample.kind, p_mime_type: sample.mime, p_size_bytes: bytes.length,
    p_file_name: name, p_width: sample.w, p_height: sample.h, p_duration_ms: null, p_label: name,
  });
  if (reg.error) throw new Error(`register ${name}: ${reg.error.message}`);
  return { id: reg.data as string, path };
}

function runWorker(extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['worker/src/index.ts', '--once'], {
      env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, WORKER_ID: 'e2e-worker', RENDER_TMP: join(work, 'tmp'), LEASE_SECONDS: '30', ...extra },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

function probe(file: string) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString()) as { format: Record<string, string>; streams: Array<Record<string, any>> };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { format: j.format.format_name ?? '', duration: Number(j.format.duration), size: Number(j.format.size), v, a };
}
function colourAt(file: string, t: number, w: number, h: number) {
  const raw = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${Math.round(w * 0.1)}:${Math.round(h * 0.1)}:4:${Math.round(h * 0.45)},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const [r, g, b] = [raw[0]!, raw[1]!, raw[2]!];
  return r > g + 60 && r > b + 60 ? 'red' : g > r + 60 && g > b + 60 ? 'green' : b > r + 60 && b > g + 60 ? 'blue' : `other(${r},${g},${b})`;
}
async function slots(s: Session) {
  const { data } = await s.db('usage_balances').select('used_video_slots').eq('organization_id', s.orgId).single();
  return (data as { used_video_slots: number }).used_video_slots;
}
async function ledger(jobId: string) {
  const { data } = await (admin as any).from('usage_ledger').select('reason, delta').eq('reference_type', 'render_job').eq('reference_id', jobId).order('created_at');
  return (data ?? []) as Array<{ reason: string; delta: number }>;
}
const sum = (rows: Array<{ delta: number }>) => rows.reduce((a, r) => a + r.delta, 0);
async function approve(s: Session, projectId: string) {
  const { data: cur } = await s.db('studio_projects').select('updated_at').eq('id', projectId).single();
  return s.rpc('approve_project_script', { p_project_id: projectId, p_base_updated_at: (cur as { updated_at: string }).updated_at });
}
async function job(s: Session, id: string) {
  const { data } = await s.db('render_jobs').select('*').eq('id', id).maybeSingle();
  return data as Record<string, any> | null;
}
const key = (tag: string) => `e2e-${tag}-${crypto.randomUUID().slice(0, 8)}`;

async function main() {
  // Leftover workers (e.g. orphans after stopping a shell on Windows) would take this test's jobs.
  assertNoForeignWorkers(URL_, ['render', 'generator']);
  const A = await signIn(env('E2E_A_EMAIL'), env('E2E_A_PASSWORD'));
  const B = await signIn(env('E2E_B_EMAIL'), env('E2E_B_PASSWORD'));
  console.log('\nReal MP4 rendering (migration 20261017200000 + render worker)');
  // Leftovers of an interrupted earlier run in the two TEST workspaces would count against the active-render limit.
  await (admin as any).from('render_jobs').update({ status: 'cancelled', charged: false, charge_state: 'released', locked_by: null }).in('organization_id', [A.orgId, B.orgId]).in('status', ['queued', 'processing']);
  // Every run consumes credits; start the TEST workspace's cycle from zero (local stack only).
  await (admin as any).from('usage_balances').update({ used_video_slots: 0 }).eq('organization_id', A.orgId);
  const runJobs: string[] = [];
  const samples = makeSamples();
  const red = await upload(A, samples.red, 'red.png');
  const green = await upload(A, samples.green, 'green-clip.mp4');
  const blue = await upload(A, samples.blue, 'blue.jpg');
  const voice = await upload(A, samples.voice, 'voice.wav');
  const music = await upload(A, samples.music, 'music.mp3');
  const bMusic = await upload(B, samples.music, 'b-music.mp3');
  check('sample image, video and audio files are uploaded to the workspace library', !!red.id && !!green.id && !!voice.id && !!music.id);

  // A character-free product ad: 3 + 3 + 4 seconds.
  const ad: ProjectDraft = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'Glow Serum' }, export_presets: ['vertical_9_16'] });
  ad.title = 'E2E render serum';
  ad.scenes = [
    newScene({ title: 'Hook', duration_seconds: 3, narration: 'Meet Glow Serum.', on_screen_text: 'Glow Serum', asset_ids: [red.id, voice.id] }),
    newScene({ title: 'Texture', duration_seconds: 3, on_screen_text: 'Light texture', asset_ids: [green.id] }),
    newScene({ title: 'Offer', duration_seconds: 4, on_screen_text: '2 400 DA', asset_ids: [blue.id] }),
  ];
  const save = await A.rpc('save_studio_project_v3', { ...toRpcArgsV2(A.orgId, toSaveRequest(ad)), p_base_updated_at: null, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false });
  const projectId = (save.data as { project_id: string } | null)?.project_id;
  check('the product ad (no characters) is saved', !!projectId, save.error?.message);
  if (!projectId) return;

  const enqueue = (s: Session, aspect: VideoAspect, k: string, extra: object = {}) =>
    s.rpc('enqueue_render_job', { p_project_id: projectId, p_idempotency_key: k, p_aspect: aspect, p_resolution: 480, p_quality: (extra as { quality?: string }).quality ?? 'draft', p_settings: { ...DEFAULT_VIDEO_SETTINGS, aspect, music_asset_id: music.id, subtitles: 'narration', ...extra } });

  const early = await enqueue(A, '9:16', key('early'));
  check('an unapproved script cannot be exported', !!early.error && /approve the script/i.test(early.error.message), early.error?.message ?? 'accepted');
  const { data: cur } = await A.db('studio_projects').select('updated_at').eq('id', projectId).single();
  const appr = await A.rpc('approve_project_script', { p_project_id: projectId, p_base_updated_at: (cur as { updated_at: string }).updated_at });
  check('the script is approved', !appr.error, appr.error?.message);

  const bQueue = await enqueue(B, '9:16', key('b'));
  check('another workspace cannot export this project', !!bQueue.error, bQueue.error?.message ?? 'accepted');
  const foreign = await enqueue(A, '9:16', key('foreign'), { music_asset_id: bMusic.id });
  check('music from another workspace is refused', !!foreign.error && /background music/i.test(foreign.error.message), foreign.error?.message ?? 'accepted');
  const userClaim = await A.rpc('claim_render_job', { p_worker_id: 'me', p_lease_seconds: 30 });
  check('customers cannot call worker functions', !!userClaim.error, userClaim.error?.message ?? 'accepted');

  const before = await slots(A);
  const k916 = key('916');
  const j916 = await enqueue(A, '9:16', k916);
  const again = await enqueue(A, '9:16', k916);
  check('the same idempotency key returns the same job', !j916.error && again.data?.id === j916.data?.id && again.data?.existing === true, [j916.error?.message, again.data]);
  const j169 = await enqueue(A, '16:9', key('169'));
  const j11 = await enqueue(A, '1:1', key('11'));
  const fourth = await enqueue(A, '4:5', key('45'));
  check('at most 3 renders per workspace run at once', !!fourth.error && /too many videos/i.test(fourth.error.message), fourth.error?.message ?? 'accepted');
  check('each format is its own video: three exports reserve three credits; the refused fourth reserves none', (await slots(A)) === before + 3, [before, await slots(A)]);
  check('the credit is reserved (not yet consumed) while the video renders', (await job(A, j169.data.id))?.charge_state === 'reserved' && sum(await ledger(j169.data.id)) === -1);
  const spec = (await job(A, j916.data.id))?.spec;
  check('the job copies the approved scenes in order with their durations', JSON.stringify(spec?.scenes?.map((s: any) => [s.scene_number, s.duration_ms])) === '[[1,3000],[2,3000],[3,4000]]', spec?.scenes);
  check('scene media resolved from the approved scenes (image, clip, image + narration)', spec?.scenes?.[0]?.visual?.asset_id === red.id && spec?.scenes?.[1]?.visual?.media_type === 'video' && spec?.scenes?.[0]?.audio?.asset_id === voice.id);
  check('another workspace cannot read the render jobs', ((await B.db('render_jobs').select('id').eq('project_id', projectId)).data ?? []).length === 0);

  let log = await runWorker();
  const j45 = await enqueue(A, '4:5', key('45b'));
  log += await runWorker();
  const ids: Record<VideoAspect, string> = { '9:16': j916.data.id, '16:9': j169.data.id, '1:1': j11.data.id, '4:5': j45.data?.id };
  runJobs.push(...Object.values(ids));
  const expected: Record<VideoAspect, [number, number]> = { '9:16': [480, 854], '16:9': [854, 480], '1:1': [480, 480], '4:5': [480, 600] };
  const keep = process.env.RENDER_OUT;
  if (keep) mkdirSync(keep, { recursive: true });
  for (const aspect of ['9:16', '16:9', '1:1', '4:5'] as const) {
    const j = await job(A, ids[aspect]);
    check(`${aspect}: render completed`, j?.status === 'completed' && Number(j?.progress) === 100, [j?.status, j?.error_code, j?.error_detail, log.slice(-600)]);
    if (j?.status !== 'completed') continue;
    const signed = await A.client.storage.from('workspace-assets').createSignedUrl(j.output_object_path, 120);
    const res = signed.data ? await fetch(signed.data.signedUrl) : null;
    const file = join(work, `out-${aspect.replace(':', 'x')}.mp4`);
    writeFileSync(file, Buffer.from(await res!.arrayBuffer()));
    const p = probe(file);
    const [w, h] = expected[aspect];
    check(`${aspect}: downloaded by its owner through a signed link`, res?.ok === true && statSync(file).size === Number(j.output_size_bytes));
    check(`${aspect}: valid MP4 with H.264 video and AAC audio`, /mp4/.test(p.format) && p.v?.codec_name === 'h264' && p.a?.codec_name === 'aac', [p.format, p.v?.codec_name, p.a?.codec_name]);
    check(`${aspect}: ${w}×${h} pixels`, p.v?.width === w && p.v?.height === h, [p.v?.width, p.v?.height]);
    check(`${aspect}: 10 s long (±0.25 s)`, Math.abs(p.duration - 10) <= 0.25, p.duration);
    let decodes = true;
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'null', '-']);
    } catch {
      decodes = false;
    }
    check(`${aspect}: every frame decodes`, decodes);
    const order = [1.5, 4.5, 8].map((t) => colourAt(file, t, w, h));
    check(`${aspect}: scenes appear in the approved order (red image, green clip, blue image)`, order.join(',') === 'red,green,blue', order);
    console.log(`        ${aspect} ${w}x${h} ${p.duration.toFixed(3)} s ${(p.size / 1024).toFixed(1)} KB`);
    if (keep) copyFileSync(file, join(keep, `e2e-${aspect.replace(':', 'x')}.mp4`));
  }
  const done = await job(A, ids['9:16']);
  const { data: lib } = await A.db('media_assets').select('kind, mime_type, width, height').eq('id', done?.output_media_asset_id).single();
  check('the finished video is in the library (kind render, video/mp4)', lib?.kind === 'render' && lib?.mime_type === 'video/mp4' && lib?.width === 480);
  check('another workspace cannot create a link to the file', !!(await B.client.storage.from('workspace-assets').createSignedUrl(done?.output_object_path, 60)).error || !(await B.client.storage.from('workspace-assets').createSignedUrl(done?.output_object_path, 60)).data);
  check('another workspace cannot download the file', !!(await B.client.storage.from('workspace-assets').download(done?.output_object_path)).error);
  const consumed = await Promise.all(Object.values(ids).map((id) => job(A, id)));
  const ledgers = await Promise.all(Object.values(ids).map((id) => ledger(id)));
  check('each completed video consumed exactly one credit (reserved once, consumed once)',
    consumed.every((j) => j?.charge_state === 'consumed' && j?.credits === 1) && ledgers.every((l) => sum(l) === -1 && l.filter((r) => r.reason === 'render_consumed').length === 1), ledgers);
  const beforeDownload = await slots(A);
  for (let i = 0; i < 2; i++) {
    const again2 = await A.client.storage.from('workspace-assets').createSignedUrl(done?.output_object_path, 60);
    await (await fetch(again2.data!.signedUrl)).arrayBuffer();
  }
  check('downloading a finished video again uses no credit', (await slots(A)) === beforeDownload);
  const dup = await enqueue(A, '9:16', key('dup'));
  check('exporting the identical video again returns the existing one without a new credit', !dup.error && dup.data?.id === ids['9:16'] && dup.data?.duplicate === true && (await slots(A)) === beforeDownload, [dup.error?.message, dup.data, await slots(A)]);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  check('signed-out users see no render jobs', (((await (anon as any).from('render_jobs').select('id').limit(1)).data ?? []) as unknown[]).length === 0);

  // Failure and recovery: an input disappears → the render fails cleanly → fixed → retry succeeds.
  const greenBytes = readFileSync(samples.green.file);
  await A.client.storage.from('workspace-assets').remove([green.path]);
  const jf = await enqueue(A, '1:1', key('fail'), { quality: 'standard' });
  await runWorker();
  const failed = await job(A, jf.data.id);
  check('a render whose input is missing fails (no endless retries)', failed?.status === 'failed' && failed?.error_code === 'input_missing' && failed?.attempt_count === 1, [failed?.status, failed?.error_code, failed?.attempt_count]);
  runJobs.push(jf.data.id);
  check('a definitive failure releases (refunds) its credit', failed?.charge_state === 'released' && sum(await ledger(jf.data.id)) === 0, [failed?.charge_state, await ledger(jf.data.id)]);
  await A.client.storage.from('workspace-assets').upload(green.path, greenBytes, { contentType: 'video/mp4', upsert: true });
  const bRetry = await B.rpc('retry_render_job', { p_job_id: jf.data.id });
  check('another workspace cannot retry it', !!bRetry.error);
  const retry = await A.rpc('retry_render_job', { p_job_id: jf.data.id });
  await runWorker();
  const recovered = await job(A, jf.data.id);
  check('after fixing the input, retry renders the same job to the same file', !retry.error && recovered?.status === 'completed' && recovered?.output_object_path === `${A.orgId}/renders/${jf.data.id}.mp4`, [retry.error?.message, recovered?.status, recovered?.error_code]);
  check('the retried video is paid once in total (reserved, refunded, reserved again, consumed)', sum(await ledger(jf.data.id)) === -1 && recovered?.charge_state === 'consumed', await ledger(jf.data.id));

  // A worker dies mid-render: after the lease the job is taken over (attempt 2) and finishes.
  const jl = await enqueue(A, '16:9', key('lease'), { subtitles: 'off' }); // a different video than the 16:9 above
  await adminRpc('claim_render_job', { p_worker_id: 'crashed-worker', p_lease_seconds: 30 });
  await (admin as any).from('render_jobs').update({ heartbeat_at: new Date(Date.now() - 120_000).toISOString() }).eq('id', jl.data.id);
  await runWorker();
  const taken = await job(A, jl.data.id);
  runJobs.push(jl.data.id);
  check('a job left by a dead worker is taken over and completed', taken?.status === 'completed' && taken?.attempt_count === 2, [taken?.status, taken?.attempt_count]);
  check('the worker takeover did not charge twice (one reservation, one consumption)', (await ledger(jl.data.id)).map((r) => r.reason).join(',') === 'render_reserved,render_consumed', await ledger(jl.data.id));

  // Cancel while queued: a new approved revision's only job → its slot is refunded.
  const unl = await A.rpc('remove_script_approval', { p_project_id: projectId });
  const edited = { ...ad, id: projectId, scenes: ad.scenes.map((s, i) => (i === 2 ? { ...s, duration_seconds: 5 } : s)) };
  const { data: cur3 } = await A.db('studio_projects').select('updated_at').eq('id', projectId).single();
  const s2 = await A.rpc('save_studio_project_v3', { ...toRpcArgsV2(A.orgId, toSaveRequest(edited)), p_base_updated_at: (cur3 as { updated_at: string }).updated_at, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false });
  const { data: cur4 } = await A.db('studio_projects').select('updated_at').eq('id', projectId).single();
  const re = await A.rpc('approve_project_script', { p_project_id: projectId, p_base_updated_at: (cur4 as { updated_at: string }).updated_at });
  check('the edited script (scene 3: 5 s) is approved as a new revision', !unl.error && !s2.error && !re.error, [unl.error?.message, s2.error?.message, re.error?.message]);
  const s0 = await slots(A);
  const jc = await enqueue(A, '9:16', key('cancel'));
  const s1 = await slots(A);
  const c1 = await A.rpc('cancel_render_job', { p_job_id: jc.data.id });
  runJobs.push(jc.data.id);
  check('a new export reserves a credit; cancelling it while queued releases it', s1 === s0 + 1 && c1.data?.status === 'cancelled' && (await slots(A)) === s0 && (await job(A, jc.data.id))?.charge_state === 'released', [s0, s1, await slots(A), c1.error?.message]);
  check('the new revision exports its own timeline (scene 3 lasts 5 s)', (await job(A, jc.data.id))?.total_duration_ms === 11000);

  // Cancel while rendering: the worker stops at its next heartbeat.
  const jr = await enqueue(A, '16:9', key('stop'), { quality: 'high' });
  runJobs.push(jr.data.id);
  await A.rpc('retry_render_job', { p_job_id: jc.data.id }); // a cancelled export can be retried (reserves again)
  const sr = await slots(A);
  const worker = runWorker();
  let seen = false;
  for (let i = 0; i < 200 && !seen; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const j = await job(A, jr.data.id);
    seen = j?.status === 'processing' && Number(j?.progress) > 0;
  }
  const cr = await A.rpc('cancel_render_job', { p_job_id: jr.data.id });
  await worker;
  const stopped = await job(A, jr.data.id);
  check('cancelling a render in progress stops the worker', seen && cr.data?.cancel_requested === true && stopped?.status === 'cancelled', [seen, cr.data, stopped?.status]);
  const after = await job(A, jc.data.id);
  check('cancelling while rendering releases that credit', stopped?.charge_state === 'released' && (await slots(A)) === sr - 1, [stopped?.charge_state, sr, await slots(A)]);
  check('the retried cancelled export renders and consumes its credit', after?.status === 'completed' && after?.charge_state === 'consumed', [after?.status, after?.charge_state]);

  // ---- V1 30-second limit ----------------------------------------------------------------------------
  const textAd = (title: string, durations: number[]) => {
    const d: ProjectDraft = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'Limit' }, export_presets: ['vertical_9_16'] });
    d.title = title;
    d.scenes = durations.map((n, i) => newScene({ title: `S${i + 1}`, duration_seconds: n, on_screen_text: `Scene ${i + 1}` }));
    return d;
  };
  const saveDraft = async (d: ProjectDraft) =>
    ((await A.rpc('save_studio_project_v3', { ...toRpcArgsV2(A.orgId, toSaveRequest(d)), p_base_updated_at: null, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false })).data as { project_id: string } | null)?.project_id;
  const exportOf = (projectId: string, k: string, aspect: VideoAspect = '9:16') =>
    A.rpc('enqueue_render_job', { p_project_id: projectId, p_idempotency_key: k, p_aspect: aspect, p_resolution: 480, p_quality: 'draft', p_settings: { ...DEFAULT_VIDEO_SETTINGS, aspect } });

  const p30 = await saveDraft(textAd('E2E limit 30 s', [15, 15]));
  const a30 = await approve(A, p30!);
  const u30 = await slots(A);
  const j30 = await exportOf(p30!, key('30s'));
  await runWorker();
  const r30 = j30.data?.id ? await job(A, j30.data.id) : null;
  let d30 = 0;
  if (r30?.status === 'completed') {
    const sg = await A.client.storage.from('workspace-assets').createSignedUrl(r30.output_object_path, 120);
    const f30 = join(work, 'out-30s.mp4');
    writeFileSync(f30, Buffer.from(await (await fetch(sg.data!.signedUrl)).arrayBuffer()));
    d30 = probe(f30).duration;
  }
  if (j30.data?.id) runJobs.push(j30.data.id);
  check('exactly 30 s: approved, exported and rendered as a real 30 s MP4 (±0.25 s)', !a30.error && !j30.error && r30?.status === 'completed' && Math.abs(d30 - 30) <= 0.25, [a30.error?.message, j30.error?.message, r30?.status, r30?.error_code, d30]);
  check('a 30 s video uses exactly one credit, like a 10 s one', (await slots(A)) === u30 + 1 && r30?.credits === 1);

  const p31 = await saveDraft(textAd('E2E limit 31 s', [15, 15, 1]));
  const { data: row31 } = await A.db('studio_projects').select('total_duration_seconds').eq('id', p31).single();
  check('a 31 s draft is saved as it is (never truncated)', !!p31 && (row31 as { total_duration_seconds: number } | null)?.total_duration_seconds === 31, row31);
  const a31 = await approve(A, p31!);
  check('a 31 s script cannot be approved (database)', !!a31.error && /limited to 30 seconds/i.test(a31.error.message), a31.error?.message ?? 'approved');
  const e31 = await exportOf(p31!, key('31s'));
  check('a 31 s project cannot be exported', !!e31.error, e31.error?.message ?? 'accepted');

  // A project approved before the policy with 35 s (simulated by editing its approved snapshot).
  const { data: pr } = await A.db('studio_projects').select('approved_revision_id').eq('id', p30).single();
  const revId = (pr as { approved_revision_id: string }).approved_revision_id;
  const { data: rev } = await (admin as any).from('project_revisions').select('snapshot').eq('id', revId).single();
  const legacy = structuredClone(rev.snapshot);
  legacy.scenes = [...legacy.scenes, { ...legacy.scenes[0], scene_number: 3, duration_seconds: 5 }];
  const tamper = await (admin as any).from('project_revisions').update({ snapshot: legacy }).eq('id', revId);
  const uL = await slots(A);
  const eL = await exportOf(p30!, key('legacy'), '1:1');
  check('a legacy 35 s approved project must be shortened before a new export (refused, no credit)', !tamper.error && !!eL.error && /limited to 30 seconds/i.test(eL.error.message) && (await slots(A)) === uL, [tamper.error?.message, eL.error?.message, await slots(A)]);
  await (admin as any).from('project_revisions').update({ snapshot: rev.snapshot }).eq('id', revId);
  check('the legacy project and its data are kept', ((await A.db('project_scenes').select('id').eq('project_id', p30)).data ?? []).length === 2);

  // A legacy over-limit export (made before the policy) cannot be retried.
  const jx = jr.data.id;
  const xspec = (await job(A, jx))!.spec;
  xspec.scenes[2].duration_ms += 25_000;
  await (admin as any).from('render_jobs').update({ total_duration_ms: xspec.scenes.reduce((a: number, sc: { duration_ms: number }) => a + sc.duration_ms, 0), spec: xspec }).eq('id', jx);
  const uX = await slots(A);
  const rx = await A.rpc('retry_render_job', { p_job_id: jx });
  check('a legacy over-limit export cannot be retried (refused, no credit)', !!rx.error && /limited to 30 seconds/i.test(rx.error.message) && (await slots(A)) === uX && (await job(A, jx))?.status === 'cancelled', [rx.error?.message, await slots(A)]);

  // No credit left: the export is refused and nothing is created.
  const { data: bal } = await A.db('usage_balances').select('base_video_slots, extra_video_slots, used_video_slots').eq('organization_id', A.orgId).single();
  const b = bal as { base_video_slots: number; extra_video_slots: number; used_video_slots: number };
  await (admin as any).from('usage_balances').update({ used_video_slots: b.base_video_slots + b.extra_video_slots }).eq('organization_id', A.orgId);
  const kFull = key('full');
  const full = await enqueue(A, '4:5', kFull, { quality: 'high', subtitles: 'dialogue' });
  const { data: none } = await A.db('render_jobs').select('id').eq('idempotency_key', kFull);
  check('with no credit left the export is refused and no job is created', !!full.error && /video credit limit/i.test(full.error.message) && (none ?? []).length === 0, full.error?.message ?? 'accepted');
  await (admin as any).from('usage_balances').update({ used_video_slots: b.used_video_slots }).eq('organization_id', A.orgId);

  // Ledger and balance agree: the cycle started at 0 and every completed video of this run used one credit.
  const unique = [...new Set(runJobs)];
  const finals = await Promise.all(unique.map((id) => job(A, id)));
  const completed = finals.filter((j) => j?.status === 'completed').length;
  const ledgerTotal = sum((await Promise.all(unique.map((id) => ledger(id)))).flat());
  check('balance = completed videos of this run = −(ledger total); nothing left reserved', (await slots(A)) === completed && ledgerTotal === -completed && finals.every((j) => j?.charge_state !== 'reserved'), [await slots(A), completed, ledgerTotal]);

  console.log(`\n${passes} passed, ${failures} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    rmSync(work, { recursive: true, force: true });
    process.exit(failures ? 1 : 0);
  });
