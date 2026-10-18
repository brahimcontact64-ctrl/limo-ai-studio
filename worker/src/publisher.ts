/**
 * LIMO publisher (Milestone 8). Separate long-lived process (never a Vercel request) that
 *   - claims due publications from publish_jobs (lease + heartbeat; jobs survive restarts because the
 *     schedule lives in the database, and a dead publisher's job is taken over after the lease),
 *   - publishes through the adapter of the job: "mock" = simulated Facebook (database only),
 *     "facebook" = live Graph adapter, which refuses while live publishing is disabled,
 *   - reports success, retryable failures (back-off) or final failures with a normalized reason,
 *   - runs the controlled-automation planner for ACTIVE, authorised policies.
 * A network guard refuses every request to Facebook domains, so even a coding mistake cannot reach the
 * real Graph API from this process.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_ID, LEASE_SECONDS (60), POLL_MS (2000),
 *      AUTOMATION_EVERY_MS (60000), HEALTH_PORT / HEALTH_HOST / HEALTH_STALE_MS (optional /livez and
 *      /healthz, see health.ts). Flags: --once (process due jobs and automation once, then exit).
 */
import { hostname } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { MetaGraphAdapter, MockFacebookAdapter, PublishError, type PublishingAdapter } from '../../lib/social/adapter.ts';
import { normalizeRules, planAutomationPost } from '../../lib/social/automation.ts';
import type { MediaCandidate } from '../../lib/social/types.ts';
import { createHealth, serveHealth } from './health.ts';
import { registerWorker } from './lock.ts';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
const WORKER_ID = process.env.WORKER_ID || `publisher-${hostname()}-${process.pid}`;
const LEASE = Number(process.env.LEASE_SECONDS || 60);
const POLL = Number(process.env.POLL_MS || 2000);
const AUTOMATION_EVERY = Number(process.env.AUTOMATION_EVERY_MS || 60_000);
const ONCE = process.argv.includes('--once');
const log = (...a: unknown[]) => console.log(new Date().toISOString(), WORKER_ID, ...a);
const health = createHealth(WORKER_ID, 'publisher');
const HEALTH_STALE = Number(process.env.HEALTH_STALE_MS || Math.max(60_000, LEASE * 2000));

// Network guard: no request to Facebook can leave this process in Milestone 8.
let blockedFacebookCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fbcdn\.net|fb\.com|instagram\.com)(\/|:|$)/i.test(url)) {
    blockedFacebookCalls++;
    throw new Error(`Blocked network call to ${new URL(url).host}: live Facebook publishing is disabled`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// Visible to test scripts (no orphan may silently take their jobs); test-named workers stay on local databases.
try {
  registerWorker('publisher', URL_, WORKER_ID);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
const rpc = (fn: string, args: Record<string, unknown>) => (db.rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

interface Job {
  id: string;
  organization_id: string;
  post_id: string;
  adapter: 'mock' | 'facebook';
  idempotency_key: string;
  attempt_count: number;
  payload: { message: string; media_kind: 'image' | 'video'; media_asset_id: string | null; page_external_id: string };
  simulate: { fail_attempts?: number; error?: string; slow_ms?: number } | null;
}

async function liveEnabled() {
  const { data } = await db.from('feature_flags').select('enabled').eq('key', 'facebook_live_publishing').maybeSingle();
  return (data as { enabled?: boolean } | null)?.enabled === true;
}

async function processJob(job: Job) {
  let lost = false;
  const beat = async () => {
    const { data, error } = await rpc('report_publish_heartbeat', { p_job_id: job.id, p_worker_id: WORKER_ID });
    health.db(error);
    if (data === 'lost') lost = true;
  };
  const heart = setInterval(() => void beat(), Math.max(3000, (LEASE * 1000) / 6));
  health.busy(true);
  try {
    const adapter: PublishingAdapter =
      job.adapter === 'mock' ? new MockFacebookAdapter(rpc, WORKER_ID, job.simulate as never, job.attempt_count) : new MetaGraphAdapter({ liveEnabled: await liveEnabled() });
    if (job.simulate?.slow_ms) await new Promise((r) => setTimeout(r, Math.min(30_000, job.simulate!.slow_ms!)));
    const result = await adapter.publish({ jobId: job.id, idempotencyKey: job.idempotency_key, pageExternalId: job.payload.page_external_id, message: job.payload.message, media: null });
    if (lost) return log('lease lost', job.id);
    const { error } = await rpc('complete_publish_job', { p_job_id: job.id, p_worker_id: WORKER_ID, p_external_post_id: result.externalPostId, p_simulated: result.simulated });
    if (error) throw new PublishError({ code: 'temporary', retryable: true, reconnect: false, message: error.message });
    health.result(true);
    log(result.simulated ? 'simulated publish' : 'published', job.id, result.externalPostId, result.duplicate ? '(already published: idempotent)' : '');
  } catch (e) {
    const n = e instanceof PublishError ? e.normalized : { code: 'unknown', retryable: true, reconnect: false, message: e instanceof Error ? e.message : String(e) };
    if (lost) return log('lease lost', job.id);
    health.result(false);
    const { data } = await rpc('fail_publish_job', { p_job_id: job.id, p_worker_id: WORKER_ID, p_code: n.code, p_detail: n.message.slice(0, 500), p_retryable: n.retryable });
    log('publish failed', job.id, n.code, `→ ${String(data)}`);
  } finally {
    clearInterval(heart);
    health.busy(false);
  }
}

/** Approved media a policy may use: approved Image Studio designs (latest approved export) and videos of approved scripts. */
async function candidates(org: string): Promise<Array<MediaCandidate & { media_asset_id: string | null }>> {
  const out: Array<MediaCandidate & { media_asset_id: string | null }> = [];
  const { data: designs } = await db.from('image_projects').select('id, title, updated_at, image_exports(media_asset_id, from_approved, created_at)').eq('organization_id', org).eq('status', 'approved');
  for (const d of (designs ?? []) as Array<{ id: string; title: string; updated_at: string; image_exports: Array<{ media_asset_id: string; from_approved: boolean; created_at: string }> }>) {
    const exp = d.image_exports.filter((e) => e.from_approved).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (exp) out.push({ kind: 'image', id: d.id, title: d.title, approved: true, created_at: d.updated_at, media_asset_id: exp.media_asset_id });
  }
  const { data: videos } = await db.from('render_jobs').select('id, project_id, script_revision_id, completed_at, studio_projects(title, script_status, approved_revision_id)').eq('organization_id', org).eq('status', 'completed');
  for (const v of (videos ?? []) as unknown as Array<{ id: string; script_revision_id: string; completed_at: string; studio_projects: { title: string; script_status: string; approved_revision_id: string } }>) {
    const p = v.studio_projects;
    if (p?.script_status === 'approved' && p.approved_revision_id === v.script_revision_id) out.push({ kind: 'video', id: v.id, title: p.title, approved: true, created_at: v.completed_at, media_asset_id: null });
  }
  return out;
}

async function runAutomation() {
  const { data: flag } = await db.from('feature_flags').select('enabled').eq('key', 'auto_publishing').maybeSingle();
  if ((flag as { enabled?: boolean } | null)?.enabled !== true) return;
  const { data: policies } = await db.from('automation_policies').select('id, organization_id, version, authorized_version, rules').eq('status', 'active');
  for (const pol of (policies ?? []) as Array<{ id: string; organization_id: string; version: number; authorized_version: number | null; rules: unknown }>) {
    if (pol.authorized_version !== pol.version) continue;
    // One pending item at a time per policy: the next one is planned after it publishes or is reviewed.
    const { count } = await db.from('social_posts').select('id', { count: 'exact', head: true }).eq('automation_policy_id', pol.id).in('status', ['awaiting_review', 'approved', 'scheduled', 'publishing']);
    if ((count ?? 0) > 0) continue;
    const rules = normalizeRules(pol.rules);
    const { data: usedRows } = await db.from('social_posts').select('image_project_id, render_job_id').eq('automation_policy_id', pol.id);
    const used = new Set(((usedRows ?? []) as Array<{ image_project_id: string | null; render_job_id: string | null }>).flatMap((r) => [r.image_project_id, r.render_job_id]).filter((x): x is string => !!x));
    const { data: kit } = await db.from('brand_kits').select('brand_name, default_cta').eq('organization_id', pol.organization_id).maybeSingle();
    const media = await candidates(pol.organization_id);
    const plan = planAutomationPost(rules, media, used, { name: (kit as { brand_name?: string } | null)?.brand_name ?? '', cta: (kit as { default_cta?: string } | null)?.default_cta ?? '' }, new Date());
    if (!plan) continue;
    const chosen = media.find((m) => m.id === plan.media.id)!;
    const { data, error } = await rpc('automation_create_post', {
      p_policy_id: pol.id, p_version: pol.version, p_title: plan.title, p_caption: plan.caption, p_headline: plan.headline, p_hashtags: plan.hashtags, p_cta: plan.cta,
      p_media_kind: chosen.kind, p_image_project_id: chosen.kind === 'image' ? chosen.id : null, p_media_asset_id: chosen.media_asset_id, p_render_job_id: chosen.kind === 'video' ? chosen.id : null,
      p_run_at: plan.run_at.toISOString(),
    });
    log('automation', pol.id, error ? `refused: ${error.message}` : JSON.stringify(data));
  }
}

async function main() {
  log('publisher started', ONCE ? '(once)' : '', `lease ${LEASE}s`);
  const server = serveHealth(health.state, HEALTH_STALE);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  process.on('SIGTERM', () => (stop = true));
  let lastAutomation = 0;
  while (!stop) {
    if (Date.now() - lastAutomation >= AUTOMATION_EVERY || ONCE) {
      lastAutomation = Date.now();
      await runAutomation().catch((e) => log('automation error', e instanceof Error ? e.message : e));
    }
    const { data, error } = await rpc('claim_publish_job', { p_worker_id: WORKER_ID, p_lease_seconds: LEASE });
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
  log('publisher stopped', `blocked facebook calls: ${blockedFacebookCalls}`);
}

void main();
