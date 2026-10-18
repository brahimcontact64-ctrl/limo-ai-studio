/**
 * LIMO render worker (Milestone 7). Runs OUTSIDE the web app (never in a Vercel request): a long-lived
 * Node process with FFmpeg that
 *   - claims one render job at a time from the database (lease + heartbeat; a dead worker's job is taken
 *     over after the lease, up to max_attempts),
 *   - downloads the job's inputs from private storage, renders the MP4 (worker/src/render.ts),
 *   - uploads it to workspace-assets/<org>/renders/<job>.mp4 (same path on retry: idempotent) and
 *     registers it, or reports a retryable / final failure,
 *   - stops when the user cancels (checked on every heartbeat) and always deletes its temporary files.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server secret, never sent to browsers), WORKER_ID,
 * RENDER_TMP, LEASE_SECONDS (120), STEP_TIMEOUT_MS (300000), POLL_MS (3000), FFMPEG_PATH/FFPROBE_PATH,
 * HEALTH_PORT / HEALTH_HOST / HEALTH_STALE_MS (optional /livez and /healthz, see health.ts).
 * Flags: --once (exit when the queue is empty).
 */
import { readFile, rm, stat, writeFile, mkdir, readdir } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { RenderSpec, SpecMedia } from '../../lib/video/types.ts';
import { renderSpec } from './render.ts';
import { RenderError } from './ffmpeg.ts';
import { createHealth, serveHealth } from './health.ts';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
const WORKER_ID = process.env.WORKER_ID || `render-${hostname()}-${process.pid}`;
const TMP = process.env.RENDER_TMP || join(tmpdir(), 'limo-render');
const LEASE = Number(process.env.LEASE_SECONDS || 120);
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT_MS || 300_000);
const POLL = Number(process.env.POLL_MS || 3000);
const MAX_BYTES = 100 * 1024 * 1024;
const ONCE = process.argv.includes('--once');
const BUCKET = 'workspace-assets';

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rpc = (fn: string, args: Record<string, unknown>) => (db.rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), WORKER_ID, ...a);
const health = createHealth(WORKER_ID, 'render');
const HEALTH_STALE = Number(process.env.HEALTH_STALE_MS || Math.max(60_000, LEASE * 1000));

interface Job {
  id: string;
  organization_id: string;
  spec: RenderSpec;
  attempt_count: number;
}

async function fetchMedia(m: SpecMedia, dest: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).download(m.path);
  if (error || !data) throw new RenderError('input_missing', `A media file of this video is missing (${m.asset_id})`, false);
  if (data.size > MAX_BYTES) throw new RenderError('input_too_large', 'A media file is larger than 100 MB', false);
  await writeFile(dest, Buffer.from(await data.arrayBuffer()));
  return dest;
}

async function processJob(job: Job) {
  const dir = join(TMP, job.id);
  const abort = new AbortController();
  let last = { progress: 0, stage: 'preparing' };
  let lost = false;
  const beat = async () => {
    const { data, error } = await rpc('report_render_progress', { p_job_id: job.id, p_worker_id: WORKER_ID, p_progress: last.progress, p_stage: last.stage });
    health.db(error);
    if (error) return; // transient: the lease tolerates missed beats
    if (data === 'cancel') abort.abort();
    if (data === 'lost') {
      lost = true;
      abort.abort();
    }
  };
  let lastSent = 0;
  const onProgress = async (progress: number, stage: string) => {
    last = { progress: Math.round(progress * 100) / 100, stage };
    if (Date.now() - lastSent > 1500) {
      lastSent = Date.now();
      await beat();
    }
  };
  const heart = setInterval(() => void beat(), Math.max(5000, (LEASE * 1000) / 6));
  health.busy(true);
  try {
    log('render', job.id, `attempt ${job.attempt_count}`, `${job.spec.width}x${job.spec.height}`, `${job.spec.scenes.length} scenes`);
    const result = await renderSpec(job.spec, dir, fetchMedia, onProgress, abort.signal, { stepTimeoutMs: STEP_TIMEOUT, maxInputBytes: MAX_BYTES });
    await onProgress(96, 'uploading');
    const path = `${job.organization_id}/renders/${job.id}.mp4`;
    const bytes = await readFile(result.file);
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true });
    if (up.error) throw new RenderError('upload_failed', up.error.message, true);
    const p = result.probe;
    const { error } = await rpc('complete_render_job', {
      p_job_id: job.id,
      p_worker_id: WORKER_ID,
      p_object_path: path,
      p_size_bytes: (await stat(result.file)).size,
      p_duration_ms: Math.round(p.duration * 1000),
      p_meta: { container: p.format, video: p.video, audio: p.audio, worker: WORKER_ID },
    });
    if (error) throw new RenderError('complete_failed', error.message, true);
    log('done', job.id, `${(p.size / 1024).toFixed(0)} KB`, `${p.duration}s`);
    health.result(true);
  } catch (e) {
    const err = e instanceof RenderError ? e : new RenderError('worker_error', e instanceof Error ? e.message : String(e), true);
    health.result(false);
    if (lost) log('lease lost', job.id);
    else {
      const { data } = await rpc('fail_render_job', { p_job_id: job.id, p_worker_id: WORKER_ID, p_error_code: err.code, p_detail: err.message.slice(0, 500), p_retryable: err.retryable });
      log('failed', job.id, err.code, `→ ${String(data)}`, err.message.slice(0, 200));
    }
  } finally {
    clearInterval(heart);
    health.busy(false);
    await rm(dir, { recursive: true, force: true });
  }
}

/** Removes leftovers of crashed runs (older than an hour). */
async function sweepTmp() {
  await mkdir(TMP, { recursive: true });
  for (const name of await readdir(TMP)) {
    const p = join(TMP, name);
    const s = await stat(p).catch(() => null);
    if (s && Date.now() - s.mtimeMs > 3_600_000) await rm(p, { recursive: true, force: true });
  }
}

async function main() {
  await sweepTmp();
  log('worker started', ONCE ? '(once)' : '', `lease ${LEASE}s`);
  const server = serveHealth(health.state, HEALTH_STALE);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  process.on('SIGTERM', () => (stop = true));
  while (!stop) {
    const { data, error } = await rpc('claim_render_job', { p_worker_id: WORKER_ID, p_lease_seconds: LEASE });
    health.db(error);
    if (error) log('claim error', error.message);
    const job = (Array.isArray(data) ? data[0] : null) as Job | null;
    if (job) {
      await processJob(job);
      continue;
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, POLL));
  }
  server?.close();
  log('worker stopped');
}

void main();
