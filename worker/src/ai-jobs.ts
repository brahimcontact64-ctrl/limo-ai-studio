/**
 * Creative AI job processor (table ai_jobs, migration 20261019090000) for the generator worker: Facebook Content
 * Studio captions / rewrites / promotional images and Animation Studio keyframes / clips / voices.
 *
 * Every paid call goes through the same chain as the generation pipeline: verified registry price → paidCallBlockers
 * (paid_generation flag AND the job's own flag, provider enabled, user-confirmed amount) → workspace AI budget
 * (reserve_ai_budget) → platform spend guard (execute.ts) → provider → actual cost → settle. Mock mode uses the mock
 * adapters (no network, no cost) and labels every output "Mock (not AI)"; a mock clip contains NO animation.
 * Outputs are stored privately in workspace-assets with provenance and returned as proposals for human review.
 */
import { ProviderError, type CapabilityAdapter, type CapabilityRequest, type CapabilityResult, type PriceSheet, type VideoRequest } from '../../lib/providers/contracts.ts';
import { collectOperation, executeOperation, OperationBlockedError, preflight, settleFailure, submitOperation, type GateInput } from '../../lib/providers/execute.ts';
import { failureSettlement, type SpendGuard } from '../../lib/providers/spend.ts';
import type { Adapters, GenerationMode } from '../../lib/providers/registry.ts';
import { sheetFromRegistry, type RegistryRow } from '../../lib/providers/registry-prices.ts';
import { provenanceRecord } from '../../lib/providers/provenance.ts';
import { imageSizeFor } from '../../lib/providers/adapters/gemini-image.ts';
import { clipRequest, JOB_FLAG, JOB_STAGE, keyframeRequest, placeVoiceLines, socialRequest, voiceLines, type AiJobKind, type SocialInput } from '../../lib/ai/jobs.ts';
import { firstFrameFor, type ProjectRow, type ShotRow } from '../../lib/animation/storyboard.ts';

export interface AiJob {
  id: string;
  organization_id: string;
  requested_by: string | null;
  kind: AiJobKind;
  shot_id: string | null;
  shot_revision: number | null;
  request_key: string;
  input: Record<string, unknown>;
  confirmed_cents: number;
  attempts: number;
  provider_job_id: string | null;
  provider_payload: Record<string, unknown>;
}

type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>;
export interface JobDeps {
  mode: GenerationMode;
  workerId: string;
  adapters: Adapters;
  spend: SpendGuard | undefined;
  env: Record<string, string | undefined>;
  rpc: Rpc;
  table: (t: string) => any;
  upload: (path: string, bytes: Uint8Array, mime: string) => Promise<void>;
  setOrg: (org: string | null) => void;
  log: (...a: unknown[]) => void;
  narratorVoice: string | null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const KIND = { image: 'ai_image', video: 'ai_video', audio: 'ai_audio' } as const;
const cents = (micros: number) => Math.ceil(micros / 10_000);

export function aiJobProcessor(d: JobDeps) {
  async function flags(): Promise<Record<string, boolean>> {
    const { data } = await d.table('feature_flags').select('key, enabled');
    return Object.fromEntries(((data ?? []) as Array<{ key: string; enabled: boolean }>).map((f) => [f.key, f.enabled]));
  }

  /** Price + gate for one job operation (registry row of the job's stage for this provider/model). */
  async function context(job: AiJob, adapter: { provider: string; model: string }, req: CapabilityRequest): Promise<{ price: PriceSheet | null; gate: GateInput }> {
    const { data: rows } = await d.table('ai_provider_registry').select('*');
    const row = ((rows ?? []) as RegistryRow[]).find((r) => r.provider === adapter.provider && r.model_id === adapter.model && r.stage_type === JOB_STAGE[job.kind]);
    const tier = req.kind === 'image' || req.kind === 'character_image' ? imageSizeFor(req.size.width, req.size.height) : req.kind === 'video' ? (d.env.LIMO_VEO_RESOLUTION === '1080p' ? '1080p' : '720p') : undefined;
    const f = await flags();
    return {
      price: row ? sheetFromRegistry(row, tier) : null,
      gate: {
        env: d.env, capabilityApproved: f.paid_generation === true && f[JOB_FLAG[job.kind]] === true, providerEnabledInRegistry: !!row?.enabled,
        // The workspace budget is enforced by reserve_ai_budget below; the platform cap by the spend guard.
        remainingBudgetCents: 1_000_000, confirmAboveCents: 0, userConfirmedCents: job.confirmed_cents, missingReferences: [], sourceApproved: true,
      },
    };
  }

  async function reserveBudget(job: AiJob, key: string, estimateMicros: number): Promise<string | null> {
    if (estimateMicros <= 0) return null;
    const { data, error } = await d.rpc<string>('reserve_ai_budget', { p_organization_id: job.organization_id, p_request_key: `job:${key}`.slice(0, 200), p_estimated_cost_cents: cents(estimateMicros) });
    if (error) throw new OperationBlockedError([`workspace_budget:${error.message.slice(0, 60)}`]);
    return data;
  }
  async function settleBudget(reservation: string | null, action: 'completed' | 'released' | 'needs_reconciliation', actualCents: number | null) {
    if (!reservation) return;
    await d.rpc('settle_ai_budget', { p_reservation_id: reservation, p_action: action, p_actual_cost_cents: action === 'released' ? 0 : actualCents });
  }

  /** One synchronous paid (or mock) operation with every gate and both budgets. */
  async function run(job: AiJob, adapter: CapabilityAdapter, req: CapabilityRequest) {
    const { price, gate } = await context(job, adapter, req);
    const estimate = preflight(adapter, req, { price, gate });
    const reservation = await reserveBudget(job, req.requestKey, estimate);
    try {
      const ex = await executeOperation(adapter, req, { price, gate, spend: d.spend });
      await settleBudget(reservation, 'completed', cents(ex.actualMicros));
      return ex;
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      if (pe) {
        const s = failureSettlement(pe, price, cents(estimate));
        await settleBudget(reservation, s.action === 'release' ? 'released' : 'needs_reconciliation', s.action === 'release' ? 0 : s.cents);
      } else await settleBudget(reservation, 'released', 0);
      throw e;
    }
  }

  async function reuse(org: string, key: string): Promise<string | null> {
    const { data } = await d.table('media_assets').select('id').eq('organization_id', org).eq('provenance->>request_key', key).limit(1);
    return (data?.[0]?.id as string | undefined) ?? null;
  }

  async function store(job: AiJob, key: string, file: NonNullable<CapabilityResult['files']>[number], r: CapabilityResult, label: string, seconds?: number): Promise<string> {
    const path = `${job.organization_id}/generated/jobs/${job.id}/${key}.${EXT[file.mime] ?? 'bin'}`;
    await d.upload(path, file.bytes, file.mime);
    const png = file.role === 'image' && file.bytes.length > 24 && file.bytes[0] === 137 ? new DataView(file.bytes.buffer, file.bytes.byteOffset) : null;
    const prov = { ...provenanceRecord({ ...r.provenance, requestKey: key }), job_id: job.id, job_kind: job.kind, shot_id: job.shot_id, label: r.provenance.mock ? 'Mock (not AI)' : 'AI-generated' };
    const { data, error } = await d.table('media_assets').insert({
      organization_id: job.organization_id, bucket_id: 'workspace-assets', object_path: path, media_type: file.role, source: 'generated', kind: KIND[file.role],
      file_name: path.split('/').pop(), mime_type: file.mime, size_bytes: file.bytes.byteLength, width: png ? png.getUint32(16) : null, height: png ? png.getUint32(20) : null,
      duration_ms: seconds ? Math.round(seconds * 1000) : null, label: `${r.provenance.mock ? 'Mock' : 'AI'} · ${label}`.slice(0, 100), created_by: job.requested_by, provenance: prov,
    }).select('id').single();
    if (error) throw new ProviderError('unavailable', `media register: ${error.message}`);
    return data.id as string;
  }

  async function complete(job: AiJob, provider: string, output: Record<string, unknown>, assets: string[], estimateCents: number | null, actualCents: number | null) {
    const { error } = await d.rpc('complete_ai_job', { p_job_id: job.id, p_worker_id: d.workerId, p_provider: provider, p_output: output, p_asset_ids: assets, p_estimate_cents: estimateCents, p_actual_cost_cents: actualCents });
    if (error) throw new ProviderError('unknown', `complete: ${error.message}`);
    d.log('ai job completed', job.kind, job.id, `${actualCents ?? 0}¢`);
  }

  async function shotAndProject(job: AiJob): Promise<{ shot: ShotRow; project: ProjectRow; previous: ShotRow | undefined; totalSeconds: number }> {
    const { data: shot } = await d.table('animation_shots').select('*').eq('id', job.shot_id).single();
    const { data: project } = await d.table('animation_projects').select('*').eq('id', shot.project_id).single();
    const { data: all } = await d.table('animation_shots').select('*').eq('project_id', shot.project_id).order('shot_number');
    const list = (all ?? []) as ShotRow[];
    return { shot, project, previous: list.find((s) => s.shot_number === shot.shot_number - 1), totalSeconds: list.reduce((a, s) => a + s.duration_seconds, 0) };
  }

  // ---- kinds ---------------------------------------------------------------------------------------------------
  async function social(job: AiJob) {
    const kind = job.kind as 'social_caption' | 'social_rewrite' | 'social_image';
    const input = job.input as unknown as SocialInput;
    const req = socialRequest(kind, input, job.organization_id, job.request_key);
    if (kind === 'social_image') {
      const existing = await reuse(job.organization_id, job.request_key);
      if (existing) return complete(job, d.adapters.image.provider, { reused: true }, [existing], 0, 0);
      const ex = await run(job, d.adapters.image as CapabilityAdapter, req);
      const id = await store(job, job.request_key, ex.result.files![0]!, ex.result, 'promotional image');
      return complete(job, ex.result.provenance.provider, { mock: ex.result.provenance.mock, provenance: provenanceRecord(ex.result.provenance) }, [id], cents(ex.estimateMicros), cents(ex.actualMicros));
    }
    const ex = await run(job, d.adapters.text as CapabilityAdapter, req);
    return complete(job, ex.result.provenance.provider, { result: ex.result.json ?? {}, issues: ex.result.issues ?? [], mock: ex.result.provenance.mock, provenance: provenanceRecord(ex.result.provenance) }, [], cents(ex.estimateMicros), cents(ex.actualMicros));
  }

  async function keyframe(job: AiJob) {
    const { shot, project } = await shotAndProject(job);
    const req = keyframeRequest(shot, project, job.organization_id, job.request_key);
    const adapter = (req.kind === 'character_image' ? d.adapters.character_image : d.adapters.image) as CapabilityAdapter;
    const ex = await run(job, adapter, req);
    const id = await store(job, job.request_key, ex.result.files![0]!, ex.result, `keyframe · shot ${shot.shot_number}`);
    return complete(job, ex.result.provenance.provider, { mock: ex.result.provenance.mock, provenance: provenanceRecord(ex.result.provenance) }, [id], cents(ex.estimateMicros), cents(ex.actualMicros));
  }

  async function clip(job: AiJob) {
    const { shot, project, previous, totalSeconds } = await shotAndProject(job);
    const first = firstFrameFor(shot, previous);
    if (!first) throw new OperationBlockedError(['first_frame_missing']);
    const req: VideoRequest = clipRequest(shot, project, job.organization_id, job.request_key, first, shot.last_frame_asset_id, totalSeconds);
    const adapter = d.adapters.video;
    const { price, gate } = await context(job, adapter, req);
    if (!job.provider_job_id) {
      const existing = await reuse(job.organization_id, job.request_key);
      if (existing) return complete(job, adapter.provider, { reused: true, animated: true }, [existing], 0, 0);
      const estimate = preflight(adapter, req, { price, gate });
      const reservation = await reserveBudget(job, req.requestKey, estimate);
      let sub;
      try {
        sub = await submitOperation(adapter, req, { price, gate, spend: d.spend });
      } catch (e) {
        await settleBudget(reservation, 'released', 0);
        throw e;
      }
      const { error } = await d.rpc('defer_ai_job', { p_job_id: job.id, p_worker_id: d.workerId, p_provider: adapter.provider, p_provider_job_id: sub.taskId, p_payload: { plan: sub.plan, reserved_cents: sub.reservedCents, reservation, estimate_cents: cents(estimate) }, p_delay_seconds: Math.max(2, Math.round(sub.pollAfterMs / 1000)) });
      if (error) throw new ProviderError('unknown', `defer: ${error.message}`);
      d.log('clip submitted', job.id, sub.taskId);
      return;
    }
    const pay = job.provider_payload;
    const reservation = (pay.reservation as string | null) ?? null;
    const reservedCents = Number(pay.reserved_cents ?? 0) || 0;
    const outcome = await adapter.poll(job.provider_job_id, new AbortController().signal);
    if (outcome.status === 'running') {
      await d.rpc('defer_ai_job', { p_job_id: job.id, p_worker_id: d.workerId, p_provider: null, p_provider_job_id: null, p_payload: {}, p_delay_seconds: 15 });
      return;
    }
    if (outcome.status === 'failed') {
      await settleFailure(d.spend, req.requestKey, reservedCents, outcome.error, price);
      const s = failureSettlement(outcome.error, price, reservedCents);
      await settleBudget(reservation, s.action === 'release' ? 'released' : 'needs_reconciliation', s.action === 'release' ? 0 : s.cents);
      throw outcome.error;
    }
    const ex = await collectOperation(adapter, req, outcome.outputRef, (pay.plan as Record<string, string | number>) ?? {}, { price, gate, spend: d.spend, reservedCents });
    await settleBudget(reservation, 'completed', cents(ex.actualMicros));
    const file = ex.result.files?.[0];
    // Mock video: no file — honestly "not animated"; the shot cannot be approved without a real clip.
    const assets = file ? [await store(job, job.request_key, file, ex.result, `clip · shot ${shot.shot_number}`, Number((pay.plan as Record<string, number>)?.seconds ?? shot.duration_seconds))] : [];
    return complete(job, ex.result.provenance.provider, { animated: !!file, mock: ex.result.provenance.mock, provenance: provenanceRecord(ex.result.provenance), ...(file ? {} : { note: 'Mock provider: no animation was generated.' }) }, assets, Number(pay.estimate_cents ?? 0), cents(ex.actualMicros));
  }

  async function voice(job: AiJob) {
    const { shot, project } = await shotAndProject(job);
    const mock = d.mode === 'mock';
    const { data: profiles } = await d.table('character_voice_profiles').select('character_id, voice_ref').eq('language_code', project.language_code).eq('active', true).in('character_id', shot.characters.length ? shot.characters : ['-']);
    const voices = Object.fromEntries(((profiles ?? []) as Array<{ character_id: string; voice_ref: string }>).map((p) => [p.character_id, mock ? 'MockVoice0001' : p.voice_ref]));
    if (mock) for (const c of shot.characters) voices[c] ??= 'MockVoice0001';
    const lines = voiceLines(shot, project.language_code, voices, mock ? 'MockVoice0001' : d.narratorVoice, job.organization_id);
    const missing = lines.filter((l) => l.missingVoice).map((l) => l.speaker);
    if (missing.length) throw new OperationBlockedError([`voice_not_configured:${[...new Set(missing)].join('+')}`]);
    const made: Array<{ line: number; speaker: string; asset_id: string; duration_ms: number }> = [];
    let est = 0;
    let actual = 0;
    let provider = d.adapters.voice.provider;
    for (const l of lines) {
      const r = l.request!;
      const existing = await reuse(job.organization_id, r.requestKey);
      if (existing) {
        const { data: a } = await d.table('media_assets').select('duration_ms').eq('id', existing).single();
        made.push({ line: l.line, speaker: l.speaker, asset_id: existing, duration_ms: a?.duration_ms ?? 1000 });
        continue;
      }
      const ex = await run(job, d.adapters.voice as CapabilityAdapter, r);
      const seconds = Number((ex.result.json as { audio_seconds?: number } | undefined)?.audio_seconds ?? ex.result.usage.audioSeconds ?? 0) || 1;
      const id = await store(job, r.requestKey, ex.result.files![0]!, ex.result, `${l.speaker} · shot ${shot.shot_number}`, seconds);
      made.push({ line: l.line, speaker: l.speaker, asset_id: id, duration_ms: Math.round(seconds * 1000) });
      est += cents(ex.estimateMicros);
      actual += cents(ex.actualMicros);
      provider = ex.result.provenance.provider;
    }
    const offsets = placeVoiceLines(made.map((m) => m.duration_ms));
    const tracks = made.map((m, i) => ({ ...m, offset_ms: offsets[i] ?? 0 }));
    const over = tracks.some((t) => t.offset_ms + t.duration_ms > shot.duration_seconds * 1000);
    return complete(job, provider, { tracks, mock, ...(over ? { warning: 'speech_overruns_shot' } : {}) }, tracks.map((t) => t.asset_id), est, actual);
  }

  async function process(job: AiJob) {
    d.setOrg(job.organization_id);
    try {
      switch (job.kind) {
        case 'social_caption':
        case 'social_rewrite':
        case 'social_image':
          return await social(job);
        case 'animation_keyframe':
          return await keyframe(job);
        case 'animation_clip':
          return await clip(job);
        case 'animation_voice':
          return await voice(job);
      }
    } catch (e) {
      const code = e instanceof OperationBlockedError ? `blocked:${e.reasons.join('+')}` : e instanceof ProviderError ? e.code : 'worker_error';
      await d.rpc('fail_ai_job', { p_job_id: job.id, p_worker_id: d.workerId, p_error_code: code.slice(0, 120), p_detail: e instanceof Error ? e.message.slice(0, 400) : '' });
      d.log('ai job failed', job.kind, job.id, code, e instanceof Error ? e.message.slice(0, 200) : '');
    } finally {
      d.setOrg(null);
    }
  }

  return {
    /** Claims and processes one job; false when nothing was due. */
    async tick(): Promise<boolean> {
      try {
        await d.rpc('quarantine_stale_ai_jobs', { p_limit: 20 });
      } catch {
        /* next round */
      }
      const { data, error } = await d.rpc<AiJob[]>('claim_ai_jobs', { p_worker_id: d.workerId, p_limit: 1 });
      if (error) {
        d.log('ai job claim error', error.message);
        return false;
      }
      const job = Array.isArray(data) ? data[0] : null;
      if (!job) return false;
      await process(job);
      return true;
    },
    async pending(): Promise<number> {
      const { count } = await d.table('ai_jobs').select('id', { count: 'exact', head: true }).in('status', ['queued', 'waiting_provider']);
      return count ?? 0;
    },
  };
}
