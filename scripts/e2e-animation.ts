/**
 * Animation Studio + Facebook Content Studio AI jobs end to end against the LOCAL stack, in MOCK mode — no provider
 * is called, nothing costs money (migration 20261019090000 + generator worker + render worker).
 *
 *   storyboard (RPC) → keyframe job → generator (mock, labelled) → owner approves → voice job → generator (mock voices
 *   with offsets) → clip job → generator (mock: honestly NOT animated, cannot be approved) → reject → a simulated
 *   provider clip (a real MP4 test fixture standing in for a Veo result, labelled as such) → approve → export →
 *   render worker → real MP4 with the clip's own sound and the voice lines mixed in, one video credit.
 *   Facebook: caption / rewrite / promotional image jobs → generator (mock, labelled) → results with provenance.
 *   Workspace isolation: another workspace sees and changes nothing.
 *
 * Local test setup (restored at the end): flags animation_generation / ai_social_text / ai_social_images on; a
 * TEST-FIXTURE workspace character with three approved references (labelled fixture, removed at the end — no
 * canonical character is touched).
 * Env: SUPABASE_URL (local only), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_A_EMAIL/PASSWORD, E2E_B_EMAIL/PASSWORD.
 * Usage: node scripts/e2e-animation.ts
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertNoForeignWorkers } from '../worker/src/lock.ts';

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
  console.error('This test changes local flags and fixtures and runs only against a local stack.');
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
interface Session { client: SupabaseClient; orgId: string; userId: string; rpc: Rpc; db: (t: string) => any }
async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const { data: m } = await client.from('organization_members').select('organization_id').eq('user_id', data.user.id);
  return { client, orgId: m![0]!.organization_id as string, userId: data.user.id, rpc: client.rpc.bind(client) as unknown as Rpc, db: (t) => (client as any).from(t) };
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const A_ = (t: string) => (admin as any).from(t);
const work = mkdtempSync(join(tmpdir(), 'limo-e2e-animation-'));
const ff = (...args: string[]) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function runProcess(script: string, extra: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--once'], { env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, POLL_MS: '200', ...extra }, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}
const generator = () => runProcess('worker/src/generator.ts', { WORKER_ID: 'e2e-generator', LIMO_GENERATION_MODE: 'mock' });
const renderWorker = () => runProcess('worker/src/index.ts', { WORKER_ID: 'e2e-worker', RENDER_TMP: join(work, 'tmp'), LEASE_SECONDS: '30' });
const key = (t: string) => `e2e-${t}-${crypto.randomUUID().slice(0, 8)}`;
const FLAGS = ['animation_generation', 'ai_social_text', 'ai_social_images'];

function meanVolume(file: string, start: number, dur: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : -999;
}

async function main() {
  assertNoForeignWorkers(URL_, ['generator', 'render']);
  const A = await signIn(env('E2E_A_EMAIL'), env('E2E_A_PASSWORD'));
  const B = await signIn(env('E2E_B_EMAIL'), env('E2E_B_PASSWORD'));
  console.log('\nAnimation Studio + Facebook AI jobs (mock providers; migration 20261019090000 + generator + render worker)');
  const { data: flagsBefore } = await A_('feature_flags').select('key, enabled').in('key', FLAGS);
  const fixture: { character?: string; refs: string[]; paths: string[]; projects: string[] } = { refs: [], paths: [], projects: [] };
  try {
    for (const f of FLAGS) await A_('feature_flags').update({ enabled: true }).eq('key', f);
    await A_('usage_balances').update({ used_video_slots: 0 }).eq('organization_id', A.orgId);
    await body(A, B, fixture);
  } finally {
    for (const p of fixture.projects) await A_('animation_projects').delete().eq('id', p);
    if (fixture.refs.length) await A_('character_reference_assets').delete().in('id', fixture.refs);
    if (fixture.paths.length) await admin.storage.from('character-library').remove(fixture.paths);
    if (fixture.character) await A_('characters').delete().eq('id', fixture.character);
    for (const f of (flagsBefore ?? []) as Array<{ key: string; enabled: boolean }>) await A_('feature_flags').update({ enabled: f.enabled }).eq('key', f.key);
    const { data: after } = await A_('feature_flags').select('key, enabled').in('key', FLAGS);
    check('flags restored, test fixture character and its references removed', JSON.stringify(after) === JSON.stringify(flagsBefore) && !((await A_('characters').select('id').eq('id', fixture.character ?? '00000000-0000-0000-0000-000000000000')).data ?? []).length);
  }
}

async function body(A: Session, B: Session, fixture: { character?: string; refs: string[]; paths: string[]; projects: string[] }) {
  // ---- test-fixture workspace character with three approved references (NOT canonical artwork) ----------------
  const { data: ch } = await A_('characters').insert({ organization_id: A.orgId, name: 'E2E fixture character (test only)', description: 'test fixture', spec_version: 1, status: 'active' }).select('id').single();
  fixture.character = ch.id;
  const png = join(work, 'ref.png');
  ff('-f', 'lavfi', '-i', 'color=c=0xe8412c:s=300x400', '-frames:v', '1', png);
  for (const view of ['front', 'three_quarter', 'side']) {
    const path = `custom/${A.orgId}/${ch.id}/e2e-fixture-${view}.png`;
    await admin.storage.from('character-library').upload(path, readFileSync(png), { contentType: 'image/png', upsert: true });
    fixture.paths.push(path);
    const { data: r } = await A_('character_reference_assets').insert({ organization_id: A.orgId, custom_character_id: ch.id, spec_version: 1, asset_kind: 'rendered_reference', view, object_path: path, mime_type: 'image/png', size_bytes: readFileSync(png).length, provenance: 'uploaded_artwork', provenance_note: 'E2E TEST FIXTURE — not character artwork', status: 'approved' }).select('id').single();
    fixture.refs.push(r.id);
  }
  const charId = `custom:${ch.id}`;

  // ---- storyboard ---------------------------------------------------------------------------------------------
  const projectId = (await A.rpc('save_animation_project', { p_organization_id: A.orgId, p_project_id: null, p_title: 'E2E animation', p_language: 'fr', p_aspect: '9:16', p_music_asset_id: null, p_music_note: '', p_settings: { tier: 'fast', voice_mode: 'separate' } })).data as string;
  fixture.projects.push(projectId);
  const shotDef = { duration_seconds: 8, description: '[e2e placeholder]', environment: '[placeholder]', camera: '[placeholder]', characters: [charId], actions: { [charId]: '[placeholder]' }, dialogue: [{ speaker: charId, text: 'Bonjour.' }], narration: 'Une histoire.', reference_asset_ids: fixture.refs.slice(0, 2), clip_audio: 'keep' };
  const saved = await A.rpc('save_animation_shots', { p_project_id: projectId, p_shots: [shotDef], p_expected_revision: null });
  check('storyboard saved: one 8 s shot with a workspace character, dialogue, narration and two approved references', !saved.error && saved.data?.total_seconds === 8, saved.error?.message);
  const shotId = (await A.db('animation_shots').select('id').eq('project_id', projectId).single()).data.id as string;
  const bView = (await B.db('animation_projects').select('id').eq('id', projectId)).data ?? [];
  const bEdit = await B.rpc('save_animation_shots', { p_project_id: projectId, p_shots: [], p_expected_revision: null });
  check('another workspace can neither see nor edit the storyboard', bView.length === 0 && !!bEdit.error, bEdit.error?.message);
  const ready = await A.rpc('animation_readiness', { p_project_id: projectId });
  check('readiness: the fixture character has no gaps; the flag is on', (ready.data?.characters?.[charId]?.gaps ?? ['x']).length === 0 && ready.data?.flags?.animation_generation === true, ready.data);

  // ---- keyframe ------------------------------------------------------------------------------------------------
  const k1 = await A.rpc('request_animation_job', { p_shot_id: shotId, p_kind: 'animation_keyframe', p_request_key: key('kf'), p_confirmed_cents: 0 });
  const log1 = await generator();
  const s1 = (await A.db('animation_shots').select('status, keyframe_asset_id').eq('id', shotId).single()).data;
  const kfAsset = s1?.keyframe_asset_id ? (await A.db('media_assets').select('kind, provenance, label').eq('id', s1.keyframe_asset_id).single()).data : null;
  check('keyframe generated from the approved references (mock, labelled) and waiting for review', !k1.error && s1?.status === 'keyframe_review' && kfAsset?.kind === 'ai_image' && kfAsset?.provenance?.mock === true && (kfAsset?.provenance?.reference_asset_ids ?? []).length === 2 && /^Mock/.test(kfAsset?.label ?? ''), [k1.error?.message, s1, kfAsset, log1.slice(-500)]);
  const review = (await A.db('animation_shots').select('identity_review').eq('id', shotId).single()).data?.identity_review?.keyframe?.automated;
  const codes = Object.fromEntries(((review?.checks ?? []) as Array<{ code: string; status: string }>).map((c) => [c.code, c.status]));
  check('automated keyframe checks are stored and honest: mock flagged, blank mock image fails, verdict needs a human', review?.verdict === 'needs_human_review' && codes.mock_output === 'warn' && codes.not_blank === 'fail' && codes.references_used === 'pass' && /do not prove/.test(review?.disclaimer ?? ''), review);
  const noConfirm = await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'keyframe', p_decision: 'approve', p_note: null, p_identity_confirmed: false });
  const kfOk = await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'keyframe', p_decision: 'approve', p_note: null, p_identity_confirmed: true });
  check('a shot with a character is approved only with the owner’s identity confirmation', /Confirm the character identity/.test(noConfirm.error?.message ?? '') && !kfOk.error, [noConfirm.error?.message, kfOk.error?.message]);

  // ---- voices --------------------------------------------------------------------------------------------------
  await A.rpc('request_animation_job', { p_shot_id: shotId, p_kind: 'animation_voice', p_request_key: key('voice'), p_confirmed_cents: 0 });
  await generator();
  const tracks = ((await A.db('animation_shots').select('voice_tracks').eq('id', shotId).single()).data?.voice_tracks ?? []) as Array<{ line: number; speaker: string; asset_id: string; offset_ms: number; duration_ms: number }>;
  check('voice lines generated (narrator + character, mock) with offsets inside the shot', tracks.length === 2 && tracks[0]!.offset_ms === 300 && tracks[1]!.offset_ms > tracks[0]!.offset_ms + tracks[0]!.duration_ms - 1 && tracks.every((t) => t.offset_ms + t.duration_ms <= 8000), tracks);

  // ---- clip: mock is honest (no animation), cannot be approved ---------------------------------------------------
  await A.rpc('request_animation_job', { p_shot_id: shotId, p_kind: 'animation_clip', p_request_key: key('clip'), p_confirmed_cents: 0 });
  await generator();
  const s2 = (await A.db('animation_shots').select('status, clip_asset_id').eq('id', shotId).single()).data;
  const clipJob = (await A.db('ai_jobs').select('output, status').eq('shot_id', shotId).eq('kind', 'animation_clip').order('created_at', { ascending: false }).limit(1).single()).data;
  const appr = await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'clip', p_decision: 'approve', p_note: null, p_identity_confirmed: true });
  check('mock clip: job completes with "not animated", no file, and approval is refused', s2?.status === 'clip_review' && s2?.clip_asset_id === null && clipJob?.output?.animated === false && !!appr.error, [s2, clipJob, appr.error?.message]);
  await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'clip', p_decision: 'reject', p_note: 'needs real motion' });

  // Simulated provider output: a real MP4 (moving test pattern + tone) stands in for a Veo clip (test fixture).
  const mp4 = join(work, 'clip.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=8', '-f', 'lavfi', '-i', 'sine=f=330:d=8', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4);
  const clipPath = `${A.orgId}/generated/e2e/${crypto.randomUUID()}.mp4`;
  await admin.storage.from('workspace-assets').upload(clipPath, readFileSync(mp4), { contentType: 'video/mp4' });
  const fixtureClip = async (provenance: Record<string, unknown>) => {
    const { data: row } = await A_('media_assets').insert({ organization_id: A.orgId, bucket_id: 'workspace-assets', object_path: `${clipPath}-${crypto.randomUUID().slice(0, 6)}.mp4`, media_type: 'video', source: 'generated', kind: 'ai_video', mime_type: 'video/mp4', size_bytes: readFileSync(mp4).length, duration_ms: 8000, label: 'E2E simulated provider clip (test fixture)', provenance }).select('id, object_path').single();
    await admin.storage.from('workspace-assets').upload(row.object_path, readFileSync(mp4), { contentType: 'video/mp4' });
    await A.rpc('request_animation_job', { p_shot_id: shotId, p_kind: 'animation_clip', p_request_key: key('clip'), p_confirmed_cents: 0 });
    const claim = await admin.rpc('claim_ai_jobs', { p_worker_id: 'e2e-sim-provider', p_limit: 1 });
    const simJob = (claim.data as Array<{ id: string }>)[0]!;
    await admin.rpc('complete_ai_job', { p_job_id: simJob.id, p_worker_id: 'e2e-sim-provider', p_provider: 'e2e-fixture', p_output: { fixture: true }, p_asset_ids: [row.id], p_estimate_cents: 0, p_actual_cost_cents: 0 });
  };
  await fixtureClip({ mock: true, ai_generated: false, label: 'mock video file' });
  const mockAppr = await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'clip', p_decision: 'approve', p_note: null, p_identity_confirmed: true });
  check('a video file labelled mock is never approved as animation', /Mock clips cannot be approved/.test(mockAppr.error?.message ?? ''), mockAppr.error?.message ?? 'approved');
  await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'clip', p_decision: 'reject', p_note: 'mock' });
  await fixtureClip({ mock: false, ai_generated: false, fixture: true, label: 'E2E test fixture (simulated provider output, not AI)' });
  const ok = await A.rpc('decide_animation_shot', { p_shot_id: shotId, p_stage: 'clip', p_decision: 'approve', p_note: null, p_identity_confirmed: true });
  check('a clip with a real video file is approved with the identity confirmation; the shot is approved', !ok.error && ok.data?.status === 'approved', ok.error?.message);

  // ---- export through the render worker -------------------------------------------------------------------------
  const before = ((await A.db('usage_balances').select('used_video_slots').eq('organization_id', A.orgId).single()).data as { used_video_slots: number }).used_video_slots;
  const exp = await A.rpc('enqueue_animation_render', { p_project_id: projectId, p_idempotency_key: key('export'), p_resolution: 480, p_quality: 'draft' });
  await renderWorker();
  const job = exp.data?.id ? (await A.db('render_jobs').select('status, output_object_path, charge_state, spec, error_code').eq('id', exp.data.id).single()).data : null;
  let duration = 0;
  let vol = { clip: -999, voice: -999 };
  if (job?.status === 'completed') {
    const s = await A.client.storage.from('workspace-assets').createSignedUrl(job.output_object_path, 60);
    const f = join(work, 'out.mp4');
    writeFileSync(f, Buffer.from(await (await fetch(s.data!.signedUrl)).arrayBuffer()));
    duration = Number(JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', f]).toString()).format.duration);
    vol = { clip: meanVolume(f, 0.05, 0.2), voice: meanVolume(f, (tracks[1]!.offset_ms + 100) / 1000, 0.5) };
  }
  const after = ((await A.db('usage_balances').select('used_video_slots').eq('organization_id', A.orgId).single()).data as { used_video_slots: number }).used_video_slots;
  const again = await A.rpc('enqueue_animation_render', { p_project_id: projectId, p_idempotency_key: key('export-again'), p_resolution: 480, p_quality: 'draft' });
  const afterAgain = ((await A.db('usage_balances').select('used_video_slots').eq('organization_id', A.orgId).single()).data as { used_video_slots: number }).used_video_slots;
  check('exporting the identical video again returns the finished MP4 without a second credit', again.data?.duplicate === true && again.data?.id === exp.data?.id && afterAgain === after, [again.error?.message, again.data, after, afterAgain]);
  check('export: the render worker produces a real 8 s MP4 from the approved clip with its sound and the voice layers; one credit', job?.status === 'completed' && job?.charge_state === 'consumed' && Math.abs(duration - 8) <= 0.25 && (job?.spec?.scenes?.[0]?.audio_layers ?? []).length === 2 && vol.clip > -50 && vol.voice > -50 && after === before + 1, [exp.error?.message, job?.status, job?.error_code, job?.charge_state, duration, vol, before, after]);

  // ---- Facebook Content Studio AI jobs ---------------------------------------------------------------------------
  const cap = await A.rpc('request_social_ai_job', { p_organization_id: A.orgId, p_kind: 'social_caption', p_input: { language: 'fr', prompt: 'Nouveau menu du midi', business_type: 'restaurant', facts: { business_name: 'Chez E2E', price: '1200 DA' } }, p_request_key: key('cap'), p_confirmed_cents: 0 });
  const rw = await A.rpc('request_social_ai_job', { p_organization_id: A.orgId, p_kind: 'social_rewrite', p_input: { language: 'fr', text: 'Venez goûter notre couscous.', mode: 'translate', target_language: 'ar' }, p_request_key: key('rw'), p_confirmed_cents: 0 });
  const img = await A.rpc('request_social_ai_job', { p_organization_id: A.orgId, p_kind: 'social_image', p_input: { language: 'fr', prompt: 'Assiette de couscous', aspect: '4:5' }, p_request_key: key('img'), p_confirmed_cents: 0 });
  const bReq = await B.rpc('request_social_ai_job', { p_organization_id: A.orgId, p_kind: 'social_caption', p_input: { language: 'fr', prompt: 'x' }, p_request_key: key('b'), p_confirmed_cents: 0 });
  check('caption, rewrite and image jobs are queued; another workspace cannot request for this one', !cap.error && !rw.error && !img.error && !!bReq.error, [cap.error?.message, rw.error?.message, img.error?.message, bReq.error?.message]);
  await generator();
  const jobs = (await A.db('ai_jobs').select('id, kind, status, output, output_asset_ids').in('id', [cap.data.id, rw.data.id, img.data.id])).data as Array<{ id: string; kind: string; status: string; output: any; output_asset_ids: string[] }>;
  const byKind = (k: string) => jobs.find((j) => j.kind === k)!;
  check('caption: a labelled mock proposal built only from the typed facts', byKind('social_caption').status === 'completed' && /^\[Mock AI caption/.test(byKind('social_caption').output?.result?.caption ?? '') && /1200 DA/.test(byKind('social_caption').output?.result?.caption ?? ''), byKind('social_caption'));
  check('rewrite: labelled mock result keeps the original text', byKind('social_rewrite').status === 'completed' && /^\[Mock rewrite/.test(byKind('social_rewrite').output?.result?.text ?? ''), byKind('social_rewrite'));
  const imgAsset = byKind('social_image').output_asset_ids[0] ? (await A.db('media_assets').select('kind, provenance, height, width').eq('id', byKind('social_image').output_asset_ids[0]).single()).data : null;
  check('promotional image stored privately as ai_image with provenance (mock), 4:5', byKind('social_image').status === 'completed' && imgAsset?.kind === 'ai_image' && imgAsset?.provenance?.job_kind === 'social_image' && imgAsset?.provenance?.mock === true && imgAsset!.height > imgAsset!.width, [byKind('social_image'), imgAsset]);
  check('another workspace sees none of these jobs or files', ((await B.db('ai_jobs').select('id').in('id', jobs.map((j) => j.id))).data ?? []).length === 0 && ((await B.db('media_assets').select('id').eq('id', byKind('social_image').output_asset_ids[0] ?? '00000000-0000-0000-0000-000000000000')).data ?? []).length === 0);
  const offFlag = await A_('feature_flags').update({ enabled: false }).eq('key', 'ai_social_text');
  const refused = await A.rpc('request_social_ai_job', { p_organization_id: A.orgId, p_kind: 'social_caption', p_input: { language: 'fr', prompt: 'x' }, p_request_key: key('off'), p_confirmed_cents: 0 });
  check('with the flag off, AI captions are refused', !offFlag.error && /not enabled/.test(refused.error?.message ?? ''), refused.error?.message ?? 'accepted');
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    console.log(`\n${passes} passed, ${failures} failed`);
    rmSync(work, { recursive: true, force: true });
    process.exit(failures ? 1 : 0);
  });
