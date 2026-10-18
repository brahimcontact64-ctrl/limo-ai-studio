/**
 * LIMO AI generator (Milestone 10). Separate long-lived process (never a Vercel request) that executes the stages
 * of `generation_runs` with the provider adapters, using the orchestration functions that already exist in the
 * database (service role only): claim_generation_stages, apply_generation_safety_decision, attach/defer/claim
 * provider polls, complete_generation_stage, fail_generation_stage (which settles the AI budget).
 *
 * Stage → work:
 *   safety       moderation of the approved script text and the scene images → allow / review / block
 *   script       per-scene image and motion prompts from the approved script (the script text is never changed)
 *   voice        narration per scene, subtitle cues from the audio timing
 *   scene_image  one image per scene without customer media (the customer's own photos stay untouched)
 *   scene_video  image-to-video per scene (async: submit → attach task id → poll → download → store)
 *   render       a PROPOSAL (scene → generated media) that the customer applies or rejects in the Video step
 *   export       nothing: the MP4 is the customer's own export (one video credit; V1 video policy)
 *
 * Safety nets: mode off by default (the process exits), network guard unless live, idempotent operation keys
 * (an identical earlier result is reused, never paid twice), per-operation authorisation (execute.ts), actual
 * cost from the owner-verified registry price, transient retries only, no fallback after a refusal.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIMO_GENERATION_MODE (off|mock|live), LIMO_ENABLE_PAID_GENERATION,
 *      ANTHROPIC_API_KEY / GEMINI_API_KEY / ELEVENLABS_API_KEY / OPENAI_API_KEY (live only), LIMO_NARRATOR_VOICE_ID,
 *      WORKER_ID, POLL_MS (3000), HEALTH_PORT. Flags: --once (exit when nothing is left to do).
 */
import { hostname } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { ProviderError, type CapabilityResult, type PriceSheet, type VideoRequest } from '../../lib/providers/contracts.ts';
import { collectOperation, executeOperation, OperationBlockedError, submitOperation, type GateInput } from '../../lib/providers/execute.ts';
import { buildAdapters, generationMode } from '../../lib/providers/registry.ts';
import { sheetFromRegistry, type RegistryRow } from '../../lib/providers/registry-prices.ts';
import { priceKey } from '../../lib/providers/prices.ts';
import { provenanceRecord } from '../../lib/providers/provenance.ts';
import { buildPlan, type CharacterReference, type Plan, type PlanInput, type PlanScene, type PlannedOp } from '../../lib/generation/plan.ts';
import { canonFor } from '../../lib/characters/canon.ts';
import { createHealth, serveHealth } from './health.ts';
import { registerWorker } from './lock.ts';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
const MODE = generationMode(process.env);
const WORKER_ID = process.env.WORKER_ID || `generator-${hostname()}-${process.pid}`;
const POLL = Number(process.env.POLL_MS || 3000);
const ONCE = process.argv.includes('--once');
const BUCKET = 'workspace-assets';
const log = (...a: unknown[]) => console.log(new Date().toISOString(), WORKER_ID, ...a);
if (MODE === 'off') {
  log('AI generation is off (LIMO_GENERATION_MODE); nothing to do');
  // A long-running process stays idle (no restart loop under a supervisor); --once exits.
  if (ONCE) process.exit(0);
}
try {
  registerWorker('generator', URL_, WORKER_ID);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
type R<T> = Promise<{ data: T; error: { message: string } | null }>;
const rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => (db.rpc as unknown as (f: string, a: object) => R<T>)(fn, args);
const table = (t: string) => (db as unknown as { from: (t: string) => any }).from(t);
const health = createHealth(WORKER_ID, 'generator');
let blockedCalls = 0;
let currentOrg: string | null = null;

/** Loads an input file of the CURRENT run's workspace (or an approved canonical character reference). */
async function loadAsset(id: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { data: a } = await table('media_assets').select('organization_id, bucket_id, object_path, mime_type').eq('id', id).maybeSingle();
  let bucket: string, path: string, mime: string;
  if (a) {
    if (a.organization_id !== currentOrg) throw new ProviderError('invalid_request', 'asset of another workspace');
    [bucket, path, mime] = [a.bucket_id, a.object_path, a.mime_type ?? 'application/octet-stream'];
  } else {
    const { data: r } = await table('character_reference_assets').select('organization_id, bucket_id, object_path, mime_type, status').eq('id', id).maybeSingle();
    if (!r || r.status !== 'approved' || (r.organization_id && r.organization_id !== currentOrg)) throw new ProviderError('invalid_request', 'reference not found or not approved');
    [bucket, path, mime] = [r.bucket_id, r.object_path, r.mime_type ?? 'image/png'];
  }
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new ProviderError('invalid_request', 'input file is missing');
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime };
}

const adapters = buildAdapters(process.env, { loadAsset, liveFetch: MODE === 'live' ? globalThis.fetch.bind(globalThis) : undefined, onBlocked: () => blockedCalls++ });

// ---- context ----------------------------------------------------------------------------------------------------
interface Run { id: string; organization_id: string; project_id: string; requested_by: string; status: string; estimated_cost_cents: number }
interface Ctx { run: Run; plan: Plan; input: PlanInput; registry: RegistryRow[]; paidFlag: boolean; spentCents: number }

const SCENE_KEYS = ['title', 'narration', 'dialogue', 'visual_prompt', 'camera_prompt'] as const;

async function loadContext(runId: string): Promise<Ctx> {
  const { data: run } = await table('generation_runs').select('id, organization_id, project_id, requested_by, status, estimated_cost_cents').eq('id', runId).single();
  const { data: p } = await table('studio_projects').select('organization_id, language_code, script_status, approved_revision_id, visual_style').eq('id', run.project_id).single();
  if (p.script_status !== 'approved' || !p.approved_revision_id) throw new OperationBlockedError(['content_not_approved']);
  const { data: rev } = await table('project_revisions').select('snapshot').eq('id', p.approved_revision_id).single();
  const { data: vs } = await table('video_settings').select('settings').eq('project_id', run.project_id).maybeSingle();
  const settings = (vs?.settings ?? {}) as { aspect?: string; scenes?: Record<string, { media_asset_id?: string }> };
  const snapScenes = ((rev.snapshot?.scenes ?? []) as Array<Record<string, unknown>>).sort((a, b) => Number(a.scene_number) - Number(b.scene_number));
  const ids = [...new Set(snapScenes.flatMap((s) => [settings.scenes?.[String(s.scene_number)]?.media_asset_id, ...((s.asset_ids as string[]) ?? [])]).filter(Boolean) as string[])];
  const { data: media } = ids.length ? await table('media_assets').select('id, media_type').eq('organization_id', run.organization_id).in('id', ids) : { data: [] };
  const typeOf = new Map(((media ?? []) as Array<{ id: string; media_type: string }>).map((m) => [m.id, m.media_type]));
  const scenes: PlanScene[] = snapScenes.map((s) => {
    const chosen = settings.scenes?.[String(s.scene_number)]?.media_asset_id;
    const pick = [chosen, ...((s.asset_ids as string[]) ?? [])].find((id) => id && (typeOf.get(id) === 'image' || typeOf.get(id) === 'video'));
    const text = Object.fromEntries(SCENE_KEYS.map((k) => [k, String(s[k] ?? '')])) as Record<(typeof SCENE_KEYS)[number], string>;
    return { scene_number: Number(s.scene_number), duration_seconds: Number(s.duration_seconds), participants: (s.participants as string[]) ?? [], ...text, media: pick ? { asset_id: pick, media_type: typeOf.get(pick) as 'image' | 'video' } : null };
  });
  const castIds = ((rev.snapshot?.project_cast ?? []) as Array<string | { id: string }>).map((c) => (typeof c === 'string' ? c : c.id));
  const characters: CharacterReference[] = [];
  for (const id of castIds) {
    const custom = id.startsWith('custom:') ? id.slice(7) : null;
    let q = table('character_reference_assets').select('id, view, spec_version').eq('status', 'approved').eq('asset_kind', 'rendered_reference').in('view', ['front', 'three_quarter', 'side']);
    q = custom ? q.eq('custom_character_id', custom).eq('organization_id', run.organization_id) : q.eq('catalog_character_id', id);
    const { data: refs } = await q;
    const order = ['front', 'three_quarter', 'side'];
    const sorted = ((refs ?? []) as Array<{ id: string; view: string; spec_version: number }>).sort((a, b) => order.indexOf(a.view) - order.indexOf(b.view));
    characters.push({ id, name: id, specVersion: sorted[0]?.spec_version ?? 0, assetIds: sorted.map((r) => r.id), identityText: custom ? '' : (canonFor(id)?.consistency.identity_prompt ?? '') });
  }
  const { data: registry } = await table('ai_provider_registry').select('*');
  const { data: flag } = await table('feature_flags').select('enabled').eq('key', 'paid_generation').maybeSingle();
  const { data: stages } = await table('generation_run_stages').select('actual_cost_cents').eq('run_id', runId);
  const spentCents = ((stages ?? []) as Array<{ actual_cost_cents: number | null }>).reduce((a, x) => a + (x.actual_cost_cents ?? 0), 0);
  const mock = MODE === 'mock';
  const input: PlanInput = {
    projectId: run.project_id, revisionId: p.approved_revision_id, language: p.language_code, aspect: (settings.aspect as PlanInput['aspect']) ?? '9:16', scenes, characters, styleHint: p.visual_style ?? '',
    options: {
      images: true, video: true, voice: true, videoTier: (process.env.LIMO_VEO_TIER as 'fast') || 'fast', resolution: '720p',
      imageModel: mock ? 'mock-image' : adapters.image.model, characterImageModel: mock ? 'mock-character' : adapters.character_image.model, imageSize: '1K', voiceModel: mock ? 'mock-voice' : 'eleven_flash_v2_5',
      narratorVoiceId: mock ? 'MockVoice0001' : (process.env.LIMO_NARRATOR_VOICE_ID ?? null), textModel: adapters.text.model,
    },
  };
  const prices: Record<string, PriceSheet> = {};
  for (const row of (registry ?? []) as RegistryRow[]) {
    for (const tier of [undefined, '1K', '2K', '4K', '720p', '1080p']) prices[priceKey(row.provider, row.model_id, tier)] = sheetFromRegistry(row, tier);
  }
  const plan = mock ? mockPlan(input) : buildPlan(input, prices, { retryBufferPercent: 25 });
  return { run, plan, input, registry: (registry ?? []) as RegistryRow[], paidFlag: flag?.enabled === true, spentCents };
}

/** In mock mode every operation is free and served by the mock adapters (provider "limo-mock"). */
function mockPlan(input: PlanInput): Plan {
  const p = buildPlan(input, {}, { retryBufferPercent: 0 });
  const ops = p.ops.map((o) => ({ ...o, provider: 'limo-mock', costMicros: 0, blocked: o.blocked === 'price_unverified' ? undefined : o.blocked }));
  return { ...p, ops, totalMicros: 0, reserveCents: 0, blockers: p.blockers.filter((b) => b !== 'price_unverified') };
}

function gateFor(ctx: Ctx, op: PlannedOp, adapter: { provider: string; model: string }): GateInput {
  const row = ctx.registry.find((r) => r.provider === adapter.provider && r.model_id === adapter.model);
  return {
    env: process.env, capabilityApproved: ctx.paidFlag, providerEnabledInRegistry: !!row?.enabled,
    remainingBudgetCents: Math.max(0, ctx.run.estimated_cost_cents - ctx.spentCents), confirmAboveCents: 0, userConfirmedCents: ctx.run.estimated_cost_cents,
    missingReferences: op.blocked === 'missing_character_reference' ? ['scene characters'] : [], sourceApproved: true,
  };
}
function priceFor(ctx: Ctx, op: PlannedOp): PriceSheet | null {
  const row = ctx.registry.find((r) => r.provider === op.provider && r.model_id === op.model);
  if (!row) return null;
  const tier = op.priceKey.includes('@') ? op.priceKey.split('@')[1] : undefined;
  return sheetFromRegistry(row, tier);
}

// ---- storage ------------------------------------------------------------------------------------------------------
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const KIND = { image: 'ai_image', video: 'ai_video', audio: 'ai_audio' } as const;

function pngSize(b: Uint8Array): { width: number | null; height: number | null } {
  if (b.length > 24 && b[0] === 137 && b[1] === 80) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  return { width: null, height: null };
}

/** An earlier asset produced by exactly the same operation (same key) in this workspace. */
async function reuse(org: string, key: string): Promise<string | null> {
  const { data } = await table('media_assets').select('id').eq('organization_id', org).eq('provenance->>request_key', key).limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function store(ctx: Ctx, op: PlannedOp, file: NonNullable<CapabilityResult['files']>[number], r: CapabilityResult, seconds?: number): Promise<string> {
  const org = ctx.run.organization_id;
  const path = `${org}/generated/${ctx.run.id}/${op.key}.${EXT[file.mime] ?? 'bin'}`;
  const up = await db.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: true });
  if (up.error) throw new ProviderError('unavailable', `storage: ${up.error.message}`);
  const size = file.role === 'image' ? pngSize(file.bytes) : { width: null, height: null };
  const prov = { ...provenanceRecord({ ...r.provenance, requestKey: op.key }), scene_number: op.scene, run_id: ctx.run.id, label: r.provenance.mock ? 'Mock (not AI)' : 'AI-generated' };
  const { data, error } = await table('media_assets').insert({
    organization_id: org, bucket_id: BUCKET, object_path: path, media_type: file.role, source: 'generated', kind: KIND[file.role], file_name: path.split('/').pop(),
    mime_type: file.mime, size_bytes: file.bytes.byteLength, width: size.width, height: size.height, duration_ms: seconds ? Math.round(seconds * 1000) : null,
    label: `${r.provenance.mock ? 'Mock' : 'AI'} ${file.role} · scene ${op.scene ?? '-'}`, created_by: ctx.run.requested_by, provenance: prov,
  }).select('id').single();
  if (error) throw new ProviderError('unavailable', `media register: ${error.message}`);
  return data.id as string;
}

const cents = (micros: number) => Math.ceil(micros / 10_000);
const req = (ctx: Ctx, op: PlannedOp) => ({ requestKey: op.key, organizationId: ctx.run.organization_id, locale: (['en', 'fr', 'ar', 'de'].includes(ctx.input.language) ? ctx.input.language : 'en') as 'en' });

// ---- stage handlers ------------------------------------------------------------------------------------------------
interface Stage { id: string; run_id: string; stage_type: string; scene_number: number | null; provider_job_id: string | null; output_payload: Record<string, unknown> | null }
type Done = { provider: string; jobId: string; costCents: number; assetId: string | null; payload: Record<string, unknown> };

async function stageOutputs(runId: string): Promise<Array<{ stage_type: string; scene_number: number | null; output_asset_id: string | null; output_payload: Record<string, any> }>> {
  const { data } = await table('generation_run_stages').select('stage_type, scene_number, output_asset_id, output_payload, status').eq('run_id', runId).eq('status', 'completed');
  return data ?? [];
}

async function runSafety(ctx: Ctx): Promise<void> {
  const op = ctx.plan.ops.find((o) => o.kind === 'safety')!;
  const text = ctx.input.scenes.map((s) => SCENE_KEYS.map((k) => s[k]).join(' ')).join('\n');
  const images = ctx.input.scenes.filter((s) => s.media?.media_type === 'image').map((s) => s.media!.asset_id);
  const ex = await executeOperation(adapters.safety, { ...req(ctx, op), kind: 'safety', text, imageAssetIds: images }, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.safety) });
  const d = ex.result.json as { decision: 'allow' | 'review' | 'block'; categories: string[] };
  await rpc('apply_generation_safety_decision', { p_run_id: ctx.run.id, p_decision: d.decision, p_categories: d.categories, p_rationale: null, p_provider: ex.result.provenance.provider, p_provider_ref: ex.result.provenance.providerRequestId ?? op.key, p_provider_cost_cents: cents(ex.actualMicros) });
  log('safety', ctx.run.id, d.decision, d.categories.join(',') || '-');
}

async function runScript(ctx: Ctx): Promise<Done> {
  const op = ctx.plan.ops.find((o) => o.kind === 'scene_prompts');
  if (!op) return { provider: 'limo', jobId: 'none', costCents: 0, assetId: null, payload: { scene_prompts: [] } };
  const scenes = ctx.input.scenes.map((s) => ({ scene_number: s.scene_number, title: s.title, narration: s.narration, visual_prompt: s.visual_prompt, camera_prompt: s.camera_prompt }));
  const ex = await executeOperation(adapters.text, { ...req(ctx, op), kind: 'text', task: 'scene_prompts', instructions: 'For each scene write an image_prompt and a motion_prompt for a family-friendly, premium stylized look. Describe only what the approved scene says; never add products, prices or text to the image.', facts: { scenes: JSON.stringify(scenes), style: ctx.input.styleHint }, maxOutputTokens: 4000 }, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.text) });
  return { provider: ex.result.provenance.provider, jobId: ex.result.provenance.providerRequestId ?? op.key, costCents: cents(ex.actualMicros), assetId: null, payload: { scene_prompts: (ex.result.json?.scenes as unknown[]) ?? [], provenance: provenanceRecord(ex.result.provenance), issues: ex.result.issues ?? [] } };
}

async function promptFor(ctx: Ctx, scene: number, kind: 'image_prompt' | 'motion_prompt', fallback: string): Promise<string> {
  const script = (await stageOutputs(ctx.run.id)).find((s) => s.stage_type === 'script');
  const p = ((script?.output_payload?.scene_prompts ?? []) as Array<Record<string, string>>).find((x) => Number(x.scene_number) === scene);
  return p?.[kind] || fallback;
}

async function runVoice(ctx: Ctx): Promise<Done> {
  const out: Array<Record<string, unknown>> = [];
  let total = 0;
  for (const op of ctx.plan.ops.filter((o) => o.kind === 'voice')) {
    const existing = await reuse(ctx.run.organization_id, op.key);
    if (existing) {
      out.push({ scene_number: op.scene, asset_id: existing, reused: true });
      continue;
    }
    if (!ctx.input.options.narratorVoiceId) throw new OperationBlockedError(['voice_not_configured']);
    const ex = await executeOperation(adapters.voice, { ...req(ctx, op), kind: 'voice', text: op.prompt, voiceId: ctx.input.options.narratorVoiceId, voiceProfileVersion: null, scriptRevisionId: ctx.input.revisionId }, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.voice) });
    const seconds = Number((ex.result.json as { audio_seconds?: number } | undefined)?.audio_seconds ?? ex.result.usage.audioSeconds ?? 0) || undefined;
    const id = await store(ctx, op, ex.result.files![0]!, ex.result, seconds);
    out.push({ scene_number: op.scene, asset_id: id, subtitles: ex.result.subtitles ?? [] });
    total += cents(ex.actualMicros);
  }
  return { provider: adapters.voice.provider, jobId: 'voice', costCents: total, assetId: null, payload: { scenes: out } };
}

async function runImage(ctx: Ctx, stage: Stage): Promise<Done> {
  const scene = ctx.input.scenes.find((s) => s.scene_number === stage.scene_number);
  const op = ctx.plan.ops.find((o) => o.kind === 'scene_image' && o.scene === stage.scene_number);
  if (!scene || !op) return { provider: 'limo', jobId: 'customer-media', costCents: 0, assetId: null, payload: { customer_media: scene?.media?.asset_id ?? null } };
  const existing = await reuse(ctx.run.organization_id, op.key);
  if (existing) return { provider: op.provider, jobId: op.key, costCents: 0, assetId: existing, payload: { reused: true } };
  const prompt = await promptFor(ctx, scene.scene_number, 'image_prompt', op.prompt);
  const size = ctx.plan.generationAspect === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  const refs = op.references ?? [];
  const run = refs.length
    ? executeOperation(adapters.character_image, { ...req(ctx, op), kind: 'character_image', prompt, references: ctx.input.characters.filter((c) => scene.participants.includes(c.id)).map((c) => ({ character: c.id, specVersion: c.specVersion, assetIds: c.assetIds.slice(0, 2) })), size, count: 1 }, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.character_image) })
    : executeOperation(adapters.image, { ...req(ctx, op), kind: 'image', task: 'generate', prompt, inputAssetIds: [], size, count: 1 }, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.image) });
  const ex = await run;
  const id = await store(ctx, op, ex.result.files![0]!, ex.result);
  return { provider: ex.result.provenance.provider, jobId: ex.result.provenance.providerRequestId ?? op.key, costCents: cents(ex.actualMicros), assetId: id, payload: { provenance: provenanceRecord(ex.result.provenance) } };
}

function videoRequest(ctx: Ctx, op: PlannedOp, prompt: string, firstFrame: string | null): VideoRequest {
  const scene = ctx.input.scenes.find((s) => s.scene_number === op.scene)!;
  return {
    ...req(ctx, op), kind: 'video', prompt, firstFrameAssetId: firstFrame, durationSeconds: scene.duration_seconds, videoTotalSeconds: ctx.plan.totalSeconds,
    aspect: ctx.plan.generationAspect, scriptRevisionId: ctx.input.revisionId,
    references: (op.references ?? []).length ? ctx.input.characters.filter((c) => scene.participants.includes(c.id)).map((c) => ({ character: c.id, specVersion: c.specVersion, assetIds: c.assetIds.slice(0, 1) })) : [],
  };
}

/** Submits the clip and stores the provider task id (returns null when the stage is already complete). */
async function startVideo(ctx: Ctx, stage: Stage): Promise<Done | null> {
  const scene = ctx.input.scenes.find((s) => s.scene_number === stage.scene_number);
  const op = ctx.plan.ops.find((o) => o.kind === 'scene_video' && o.scene === stage.scene_number);
  if (!scene || !op) return { provider: 'limo', jobId: 'customer-clip', costCents: 0, assetId: null, payload: { customer_media: scene?.media?.asset_id ?? null } };
  const existing = await reuse(ctx.run.organization_id, op.key);
  if (existing) return { provider: op.provider, jobId: op.key, costCents: 0, assetId: existing, payload: { reused: true } };
  const image = (await stageOutputs(ctx.run.id)).find((s) => s.stage_type === 'scene_image' && s.scene_number === stage.scene_number)?.output_asset_id ?? (scene.media?.media_type === 'image' ? scene.media.asset_id : null);
  const prompt = await promptFor(ctx, scene.scene_number, 'motion_prompt', op.prompt);
  const r = videoRequest(ctx, op, prompt, image);
  const sub = await submitOperation(adapters.video, r, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.video) });
  await rpc('attach_generation_provider_task', { p_stage_id: stage.id, p_provider: adapters.video.provider, p_provider_job_id: sub.taskId, p_output_payload: { op_key: op.key, plan: sub.plan, prompt, first_frame: image }, p_poll_after_seconds: Math.max(5, Math.round(sub.pollAfterMs / 1000)) });
  log('video submitted', stage.id, sub.taskId);
  return null;
}

async function pollVideo(stage: Stage): Promise<void> {
  const ctx = await loadContext(stage.run_id);
  currentOrg = ctx.run.organization_id;
  const op = ctx.plan.ops.find((o) => o.kind === 'scene_video' && o.scene === stage.scene_number)!;
  const pay = stage.output_payload ?? {};
  const signal = new AbortController().signal;
  const outcome = await adapters.video.poll(stage.provider_job_id!, signal);
  if (outcome.status === 'running') {
    await rpc('defer_generation_provider_poll', { p_stage_id: stage.id, p_delay_seconds: 15, p_output_payload: {} });
    return;
  }
  if (outcome.status === 'failed') throw outcome.error;
  const r = videoRequest(ctx, op, String(pay.prompt ?? op.prompt), (pay.first_frame as string | null) ?? null);
  const ex = await collectOperation(adapters.video, r, outcome.outputRef, (pay.plan as Record<string, string | number>) ?? {}, { price: priceFor(ctx, op), gate: gateFor(ctx, op, adapters.video) });
  const file = ex.result.files?.[0];
  const assetId = file ? await store(ctx, op, file, ex.result, Number((pay.plan as Record<string, number>)?.seconds ?? 0) || undefined) : null;
  await complete(stage, { provider: adapters.video.provider, jobId: stage.provider_job_id!, costCents: cents(ex.actualMicros), assetId, payload: { ...(ex.result.json ?? {}), provenance: provenanceRecord(ex.result.provenance) } });
}

async function runRender(ctx: Ctx): Promise<Done> {
  const outs = await stageOutputs(ctx.run.id);
  const voice = (outs.find((s) => s.stage_type === 'voice')?.output_payload?.scenes ?? []) as Array<{ scene_number: number; asset_id: string; subtitles?: unknown }>;
  const proposal = ctx.input.scenes.map((s) => {
    const img = outs.find((o) => o.stage_type === 'scene_image' && o.scene_number === s.scene_number);
    const vid = outs.find((o) => o.stage_type === 'scene_video' && o.scene_number === s.scene_number);
    const v = voice.find((x) => x.scene_number === s.scene_number);
    return {
      scene_number: s.scene_number, customer_media: s.media?.asset_id ?? null, image_asset_id: img?.output_asset_id ?? null,
      video_asset_id: vid?.output_asset_id ?? null, still_asset_id: (vid?.output_payload?.still_asset_id as string | undefined) ?? null, voice_asset_id: v?.asset_id ?? null,
    };
  });
  const scenesList = proposal.flatMap((p) => [p.image_asset_id, p.video_asset_id, p.voice_asset_id].filter(Boolean).map((asset_id) => ({ scene_number: p.scene_number, asset_id })));
  return { provider: 'limo', jobId: 'proposal', costCents: 0, assetId: null, payload: { proposal, scenes: scenesList, applied_automatically: false } };
}

async function complete(stage: Stage, d: Done) {
  const { data, error } = await rpc<string>('complete_generation_stage', { p_stage_id: stage.id, p_provider: d.provider, p_provider_job_id: d.jobId, p_actual_cost_cents: d.costCents, p_output_asset_id: d.assetId, p_output_payload: d.payload });
  if (error) throw new ProviderError('unknown', `complete: ${error.message}`);
  health.result(true);
  log('stage completed', stage.stage_type, stage.scene_number ?? '-', String(data), `${d.costCents}¢`);
}

async function fail(stage: Stage, e: unknown) {
  const code = e instanceof OperationBlockedError ? `blocked:${e.reasons.join('+')}` : e instanceof ProviderError ? e.code : 'worker_error';
  const { data } = await rpc<string>('fail_generation_stage', { p_stage_id: stage.id, p_error_code: code.slice(0, 120), p_provider: null, p_provider_job_id: stage.provider_job_id, p_actual_cost_cents: 0 });
  health.result(false);
  log('stage failed', stage.stage_type, stage.scene_number ?? '-', code, `→ ${String(data)}`, e instanceof Error ? e.message.slice(0, 200) : '');
}

async function processStage(stage: Stage) {
  health.busy(true);
  try {
    const ctx = await loadContext(stage.run_id);
    currentOrg = ctx.run.organization_id;
    if (ctx.plan.blockers.some((b) => b.startsWith('video_too_long'))) throw new OperationBlockedError(['video_too_long']);
    switch (stage.stage_type) {
      case 'safety':
        return await runSafety(ctx);
      case 'script':
        return await complete(stage, await runScript(ctx));
      case 'voice':
        return await complete(stage, await runVoice(ctx));
      case 'scene_image':
        return await complete(stage, await runImage(ctx, stage));
      case 'scene_video': {
        const d = await startVideo(ctx, stage);
        if (d) await complete(stage, d);
        return;
      }
      case 'render':
        return await complete(stage, await runRender(ctx));
      case 'export':
        return await complete(stage, { provider: 'limo', jobId: 'export', costCents: 0, assetId: null, payload: { note: 'The MP4 is exported by the customer from the Video step (one video credit).' } });
      default:
        throw new ProviderError('invalid_request', `unknown stage ${stage.stage_type}`);
    }
  } catch (e) {
    await fail(stage, e);
  } finally {
    health.busy(false);
    currentOrg = null;
  }
}

/** Clips submitted to a provider and still waiting for a poll (--once must not exit before they finish). */
async function pendingProviderTasks(): Promise<number> {
  const { count } = await table('generation_run_stages').select('id', { count: 'exact', head: true }).eq('status', 'processing').not('provider_job_id', 'is', null);
  return count ?? 0;
}

async function main() {
  log('generator started', `mode ${MODE}`, ONCE ? '(once)' : '');
  const server = serveHealth(health.state, Math.max(60_000, POLL * 20));
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  process.on('SIGTERM', () => (stop = true));
  if (MODE === 'off') {
    // Idle: never claims a stage, never touches a provider.
    while (!stop) {
      health.tick();
      await new Promise((r) => setTimeout(r, 5_000));
    }
    server?.close();
    return;
  }
  while (!stop) {
    // Stages left 'processing' by a dead worker are quarantined by the database (no silent re-run, no double cost).
    try {
      await rpc('quarantine_stale_generation_stages', { p_limit: 20 });
    } catch {
      /* next round */
    }
    const { data, error } = await rpc<Stage[]>('claim_generation_stages', { p_worker_id: WORKER_ID, p_stage_type: null, p_limit: 1 });
    health.db(error);
    if (error) log('claim error', error.message);
    const stage = Array.isArray(data) ? data[0] : null;
    if (stage) {
      await processStage(stage);
      continue;
    }
    let polled = false;
    for (const provider of [adapters.video.provider]) {
      const { data: polls } = await rpc<Stage[]>('claim_generation_provider_polls', { p_worker_id: WORKER_ID, p_provider: provider, p_limit: 1 });
      for (const s of Array.isArray(polls) ? polls : []) {
        polled = true;
        await pollVideo(s).catch((e) => fail(s, e));
      }
    }
    if (polled) continue;
    if (ONCE && !(await pendingProviderTasks())) break;
    await new Promise((r) => setTimeout(r, POLL));
  }
  server?.close();
  log('generator stopped', `blocked provider calls: ${blockedCalls}`);
}

void main();
