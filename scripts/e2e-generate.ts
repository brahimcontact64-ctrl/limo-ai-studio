/**
 * AI generation pipeline end to end against the LOCAL stack (Milestone 10), in MOCK mode — no provider is called,
 * nothing costs money. It proves the whole flow around the real adapters:
 *   approved script → request_studio_generation (AI budget reserved, NO video credit) → generator worker
 *   (worker/src/generator.ts, LIMO_GENERATION_MODE=mock) → safety → script prompts → voice → scene images →
 *   scene videos (async attach/poll) → render proposal → customer applies/rejects → real MP4 export (one credit).
 * Also: the customer's own photo is never replaced, approved content and video settings are never overwritten,
 * provenance on every generated file, identical requests reuse earlier results (no second generation), other
 * workspaces see nothing, and the generator refuses to run when the mode is off.
 *
 * Local test setup (restored at the end): mock providers registered as the enabled, verified defaults for every
 * stage; the standard cost policy enabled with test prices; AI enabled with a budget for test workspace A.
 *
 * Env: SUPABASE_URL (local only), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_A_EMAIL/PASSWORD, E2E_B_EMAIL/PASSWORD.
 * Usage: node scripts/e2e-generate.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertNoForeignWorkers } from '../worker/src/lock.ts';
import { emptyProject, newScene, toSaveRequest } from '../lib/studio/draft.ts';
import { toRpcArgsV2 } from '../lib/studio/validation.ts';
import type { ProjectDraft } from '../lib/studio/types.ts';
import { DEFAULT_VIDEO_SETTINGS } from '../lib/video/types.ts';

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
  console.error('This test changes local provider settings and runs only against a local stack.');
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
interface Session { client: SupabaseClient; orgId: string; rpc: Rpc; db: (t: string) => any }
async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const { data: m } = await client.from('organization_members').select('organization_id').eq('user_id', data.user.id);
  return { client, orgId: m![0]!.organization_id as string, rpc: client.rpc.bind(client) as unknown as Rpc, db: (t) => (client as any).from(t) };
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const A_ = (t: string) => (admin as any).from(t);
const work = mkdtempSync(join(tmpdir(), 'limo-e2e-generate-'));

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
const generator = (extra: Record<string, string> = {}) => runProcess('worker/src/generator.ts', { WORKER_ID: 'e2e-generator', LIMO_GENERATION_MODE: 'mock', ...extra });
const renderWorker = () => runProcess('worker/src/index.ts', { WORKER_ID: 'e2e-worker', RENDER_TMP: join(work, 'tmp'), LEASE_SECONDS: '30' });
const key = (t: string) => `e2e-${t}-${crypto.randomUUID().slice(0, 8)}`;

const STAGES = ['safety', 'script', 'voice', 'scene_image', 'scene_video', 'render', 'export'] as const;

async function main() {
  assertNoForeignWorkers(URL_, ['generator', 'render']);
  const A = await signIn(env('E2E_A_EMAIL'), env('E2E_A_PASSWORD'));
  const B = await signIn(env('E2E_B_EMAIL'), env('E2E_B_PASSWORD'));
  console.log('\nAI generation pipeline (mock providers; migration 20261018120000 + generator worker)');

  // ---- local test configuration (saved and restored) -------------------------------------------------------
  const { data: registryBefore } = await A_('ai_provider_registry').select('code, is_default, enabled');
  const { data: policyBefore } = await A_('generation_cost_policies').select('*').eq('code', 'standard_v1').single();
  const { data: orgBefore } = await A_('organizations').select('ai_enabled, monthly_budget_cents').eq('id', A.orgId).single();
  try {
    await A_('ai_provider_registry').update({ is_default: false }).eq('is_default', true);
    for (const stage of STAGES) {
      await A_('ai_provider_registry').upsert({ code: `limo_mock_${stage}`, provider: 'limo-mock', stage_type: stage, model_id: `mock-${stage}`, credential_env_key: 'NONE', enabled: true, is_default: true, pricing_unit: 'internal', pricing_metadata: { test_only: true }, verified_at: new Date().toISOString() });
    }
    await A_('generation_cost_policies').update({ enabled: true, verified_at: new Date().toISOString(), script_flat_cents: 1, voice_per_minute_cents: 1, image_per_scene_cents: 1, video_per_second_cents: 1, render_flat_cents: 1 }).eq('code', 'standard_v1');
    await A_('organizations').update({ ai_enabled: true, monthly_budget_cents: 1_000_000 }).eq('id', A.orgId);
    await A_('usage_balances').update({ used_video_slots: 0 }).eq('organization_id', A.orgId);
    await body(A, B);
  } finally {
    for (const stage of STAGES) await A_('ai_provider_registry').delete().eq('code', `limo_mock_${stage}`);
    for (const r of (registryBefore ?? []) as Array<{ code: string; is_default: boolean; enabled: boolean }>) await A_('ai_provider_registry').update({ is_default: r.is_default, enabled: r.enabled }).eq('code', r.code);
    await A_('generation_cost_policies').update(policyBefore).eq('code', 'standard_v1');
    await A_('organizations').update(orgBefore).eq('id', A.orgId);
    const { data: after } = await A_('ai_provider_registry').select('code, is_default, enabled');
    const same = JSON.stringify(((after ?? []) as Array<{ code: string }>).sort((a, b) => a.code.localeCompare(b.code))) === JSON.stringify(((registryBefore ?? []) as Array<{ code: string }>).sort((a, b) => a.code.localeCompare(b.code)));
    check('local provider settings, cost policy and workspace AI settings are restored', same);
  }
}

async function body(A: Session, B: Session) {
  // A product photo for scene 1 (the customer's own media, never replaced).
  const photo = join(work, 'photo.png');
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xc03060:s=720x1280', '-frames:v', '1', photo]);
  const path = `${A.orgId}/${crypto.randomUUID()}.png`;
  await A.client.storage.from('workspace-assets').upload(path, readFileSync(photo), { contentType: 'image/png' });
  const reg = await A.rpc('register_media_asset', { p_organization_id: A.orgId, p_object_path: path, p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: readFileSync(photo).length, p_file_name: 'photo.png', p_width: 720, p_height: 1280, p_duration_ms: null, p_label: 'photo' });
  const photoId = reg.data as string;

  const ad: ProjectDraft = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'Rose Perfume' }, export_presets: ['vertical_9_16'] });
  ad.title = 'E2E AI generation';
  ad.scenes = [
    newScene({ title: 'Hook', duration_seconds: 4, narration: 'Meet Rose Perfume.', dialogue: 'Smell the roses.', visual_prompt: 'Perfume bottle on marble', asset_ids: [photoId] }),
    newScene({ title: 'Mood', duration_seconds: 6, narration: 'A garden in a bottle.', visual_prompt: 'Rose petals falling in soft light' }),
  ];
  const save = await A.rpc('save_studio_project_v3', { ...toRpcArgsV2(A.orgId, toSaveRequest(ad)), p_base_updated_at: null, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false });
  const projectId = (save.data as { project_id: string } | null)?.project_id as string;
  const { data: cur } = await A.db('studio_projects').select('updated_at').eq('id', projectId).single();
  const appr = await A.rpc('approve_project_script', { p_project_id: projectId, p_base_updated_at: cur.updated_at });
  check('a product ad with a customer photo and narration is saved and approved', !!projectId && !appr.error, [save.error?.message, appr.error?.message]);
  await A.rpc('save_video_settings', { p_project_id: projectId, p_settings: { ...DEFAULT_VIDEO_SETTINGS, aspect: '9:16', scenes: { '1': { media_asset_id: photoId, fit: 'cover', show_text: true } } } });
  const { data: vsBefore } = await A.db('video_settings').select('settings').eq('project_id', projectId).single();

  // Generator with mode off does nothing.
  const offLog = await generator({ LIMO_GENERATION_MODE: 'off' });
  check('the generator does nothing when AI generation is off (default)', /AI generation is off/.test(offLog), offLog.slice(-300));
  const liveNoFlag = await generator({ LIMO_GENERATION_MODE: 'live' });
  check('live mode without LIMO_ENABLE_PAID_GENERATION=true stays off', /AI generation is off/.test(liveNoFlag), liveNoFlag.slice(-300));
  const prodTarget = await runProcess('worker/src/generator.ts', { WORKER_ID: 'e2e-generator', LIMO_GENERATION_MODE: 'mock', SUPABASE_URL: 'https://example.supabase.co' });
  check('a test-named generator refuses to run against a non-local database', /refuses to run against a non-local database/.test(prodTarget), prodTarget.slice(-300));

  // Request → budget reserved in cents, no video credit.
  const slotsBefore = ((await A.db('usage_balances').select('used_video_slots').eq('organization_id', A.orgId).single()).data as { used_video_slots: number }).used_video_slots;
  const bReq = await B.rpc('request_studio_generation', { p_project_id: projectId, p_request_key: key('b'), p_policy_code: 'standard_v1' });
  check('another workspace cannot start a generation for this project', !!bReq.error, bReq.error?.message ?? 'accepted');
  const k1 = key('gen');
  const r1 = await A.rpc('request_studio_generation', { p_project_id: projectId, p_request_key: k1, p_policy_code: 'standard_v1' });
  const runId = r1.data as string;
  const { data: run0 } = await A.db('generation_runs').select('status, estimated_cost_cents, ai_reservation_id').eq('id', runId).single();
  check('the generation is requested: AI budget reserved, waiting for the safety check', !r1.error && run0?.status === 'awaiting_safety' && run0?.estimated_cost_cents > 0 && !!run0?.ai_reservation_id, [r1.error?.message, run0]);
  const slotsAfter = ((await A.db('usage_balances').select('used_video_slots').eq('organization_id', A.orgId).single()).data as { used_video_slots: number }).used_video_slots;
  check('requesting AI generation uses no video credit (the credit is the MP4 export)', slotsAfter === slotsBefore, [slotsBefore, slotsAfter]);

  const log1 = await generator();
  const { data: run1 } = await A.db('generation_runs').select('status, actual_cost_cents').eq('id', runId).single();
  const { data: stages } = await A.db('generation_run_stages').select('stage_type, scene_number, status, output_asset_id, output_payload, provider').eq('run_id', runId).order('sort_order');
  const st = (t: string, n?: number) => (stages as any[]).find((s) => s.stage_type === t && (n === undefined || s.scene_number === n));
  check('the mock run completes every stage (safety, script, voice, images, videos, proposal, export)', run1?.status === 'completed' && (stages as any[]).every((s) => s.status === 'completed'), [run1, (stages as any[]).map((s) => `${s.stage_type}:${s.scene_number ?? '-'}:${s.status}`), log1.slice(-800)]);
  check('no provider costs in mock mode', run1?.actual_cost_cents === 0, run1);
  check('scene 1 keeps the customer photo (no image generated over it)', st('scene_image', 1)?.output_asset_id === null && st('scene_image', 1)?.output_payload?.customer_media === photoId, st('scene_image', 1));
  const img2 = st('scene_image', 2)?.output_asset_id as string;
  const { data: imgAsset } = await A.db('media_assets').select('kind, media_type, source, mime_type, provenance, label').eq('id', img2).single();
  check('scene 2 gets a generated image stored privately with provenance (mock, not AI)', imgAsset?.kind === 'ai_image' && imgAsset?.source === 'generated' && imgAsset?.provenance?.mock === true && imgAsset?.provenance?.ai_generated === false && /^Mock/.test(imgAsset?.label ?? ''), imgAsset);
  check('provenance records the operation key, the revision-based prompt hash and the scene', !!imgAsset?.provenance?.request_key && /^[0-9a-f]{64}$/.test(imgAsset?.provenance?.prompt_sha256 ?? '') && imgAsset?.provenance?.scene_number === 2);
  const v1 = st('scene_video', 1);
  check('mock videos are honest: the scene still is used, nothing is animated', v1?.output_payload?.animated === false && v1?.output_payload?.still_asset_id === photoId && v1?.provider === 'limo-mock', v1);
  const voice = st('voice');
  const vScene = (voice?.output_payload?.scenes ?? [])[0];
  const { data: voiceAsset } = vScene ? await A.db('media_assets').select('kind, mime_type, duration_ms').eq('id', vScene.asset_id).single() : { data: null };
  check('narration audio with subtitle cues for the scene that has dialogue', voiceAsset?.kind === 'ai_audio' && voiceAsset?.mime_type === 'audio/wav' && (vScene?.subtitles?.length ?? 0) > 0, [vScene, voiceAsset]);
  const prop = st('render')?.output_payload;
  check('the result is a proposal (scene → media) and is NOT applied automatically', prop?.applied_automatically === false && prop?.proposal?.length === 2 && prop?.proposal?.[1]?.image_asset_id === img2, prop);
  const { data: vsAfter } = await A.db('video_settings').select('settings').eq('project_id', projectId).single();
  const { data: proj } = await A.db('studio_projects').select('script_status').eq('id', projectId).single();
  check('the approved script and the video settings are unchanged', JSON.stringify(vsAfter?.settings) === JSON.stringify(vsBefore?.settings) && proj?.script_status === 'approved');
  check('another workspace cannot see the generation or its stages', ((await B.db('generation_run_stages').select('id').eq('run_id', runId)).data ?? []).length === 0 && ((await B.db('media_assets').select('id').eq('id', img2)).data ?? []).length === 0);

  // Customer decision: apply the image to scene 2 (explicit save of the video settings), reject nothing else.
  const bDec = await B.rpc('decide_generation_proposal', { p_run_id: runId, p_scene_number: 2, p_asset_id: img2, p_decision: 'applied' });
  check('another workspace cannot decide on the proposal', !!bDec.error);
  const wrong = await A.rpc('decide_generation_proposal', { p_run_id: runId, p_scene_number: 2, p_asset_id: photoId, p_decision: 'applied' });
  check('only files produced by that generation can be applied', !!wrong.error && /not produced by that generation/.test(wrong.error.message), wrong.error?.message ?? 'accepted');
  const dec = await A.rpc('decide_generation_proposal', { p_run_id: runId, p_scene_number: 2, p_asset_id: img2, p_decision: 'applied' });
  const applied = await A.rpc('save_video_settings', { p_project_id: projectId, p_settings: { ...DEFAULT_VIDEO_SETTINGS, aspect: '9:16', scenes: { '1': { media_asset_id: photoId, fit: 'cover', show_text: true }, '2': { media_asset_id: img2, fit: 'cover', show_text: true } } } });
  check('the customer applies the generated image to scene 2 (decision recorded, settings saved by the customer)', !dec.error && !applied.error, [dec.error?.message, applied.error?.message]);

  // Real MP4 export with the applied generated image: exactly one video credit.
  const exp = await A.rpc('enqueue_render_job', { p_project_id: projectId, p_idempotency_key: key('export'), p_aspect: '9:16', p_resolution: 480, p_quality: 'draft', p_settings: { ...DEFAULT_VIDEO_SETTINGS, aspect: '9:16', scenes: { '1': { media_asset_id: photoId }, '2': { media_asset_id: img2 } } } });
  await renderWorker();
  const { data: job } = exp.data?.id ? await A.db('render_jobs').select('status, output_object_path, spec, charge_state').eq('id', exp.data.id).single() : { data: null };
  let duration = 0;
  if (job?.status === 'completed') {
    const s = await A.client.storage.from('workspace-assets').createSignedUrl(job.output_object_path, 60);
    const f = join(work, 'out.mp4');
    const buf = Buffer.from(await (await fetch(s.data!.signedUrl)).arrayBuffer());
    (await import('node:fs')).writeFileSync(f, buf);
    duration = Number(JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', f]).toString()).format.duration);
  }
  check('the export renders a real 10 s MP4 with the applied generated image and consumes one credit', job?.status === 'completed' && job?.spec?.scenes?.[1]?.visual?.asset_id === img2 && job?.charge_state === 'consumed' && Math.abs(duration - 10) <= 0.25, [exp.error?.message, job?.status, job?.charge_state, duration]);

  // Retry after a failed run (fail_generation_stage puts the project back to 'ready'; simulated here): the identical
  // request reuses the earlier results (no new files, nothing generated or paid twice).
  await A_('studio_projects').update({ status: 'ready' }).eq('id', projectId);
  const before = ((await A.db('media_assets').select('id').eq('organization_id', A.orgId).in('kind', ['ai_image', 'ai_audio', 'ai_video'])).data ?? []).length;
  const r2 = await A.rpc('request_studio_generation', { p_project_id: projectId, p_request_key: key('gen2'), p_policy_code: 'standard_v1' });
  await generator();
  const { data: stages2 } = await A.db('generation_run_stages').select('stage_type, scene_number, output_asset_id, output_payload').eq('run_id', r2.data).order('sort_order');
  const after = ((await A.db('media_assets').select('id').eq('organization_id', A.orgId).in('kind', ['ai_image', 'ai_audio', 'ai_video'])).data ?? []).length;
  const img2b = ((stages2 ?? []) as any[]).find((s) => s.stage_type === 'scene_image' && s.scene_number === 2);
  const voice2 = ((stages2 ?? []) as any[]).find((s) => s.stage_type === 'voice')?.output_payload?.scenes?.[0];
  check('the applied image is now the chosen media of scene 2 (used as is, not regenerated)', !r2.error && img2b?.output_payload?.customer_media === img2, [r2.error?.message, img2b]);
  check('the retry reuses the earlier narration (same operation key → same file) and creates no new generated files', voice2?.reused === true && voice2?.asset_id === vScene?.asset_id && after === before, [voice2, before, after]);
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
