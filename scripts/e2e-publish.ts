/**
 * Social publishing end to end against the LOCAL stack (Milestone 8): database state machine, RLS,
 * the real publisher process (worker/src/publisher.ts) with the MOCK Facebook adapter, retries, leases,
 * restarts, cancellation, pause, invalidation and controlled automation.
 *
 * Env: SUPABASE_URL (must be localhost), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *      E2E_A_EMAIL/E2E_A_PASSWORD (owner, active plan), E2E_B_EMAIL/E2E_B_PASSWORD (other workspace),
 *      E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (platform admin, optional)
 * Usage: node scripts/e2e-publish.ts
 */
import { assertNoForeignWorkers } from '../worker/src/lock.ts';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emptyProject, newScene, toSaveRequest } from '../lib/studio/draft.ts';
import { toRpcArgsV2 } from '../lib/studio/validation.ts';
import { utcToZoned } from '../lib/social/schedule.ts';

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
  return { client, orgId: (m?.[0]?.organization_id as string) ?? '', rpc: client.rpc.bind(client) as unknown as Rpc, db: (t) => (client as any).from(t) };
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const sdb = (t: string) => (admin as any).from(t);
const PNG = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });

function publisher(extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['worker/src/publisher.ts', '--once'], {
      env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, WORKER_ID: 'e2e-publisher', LEASE_SECONDS: '20', ...extra },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

async function main() {
  // Leftover workers (e.g. orphans after stopping a shell on Windows) would take this test's jobs.
  assertNoForeignWorkers(URL_, ['publisher']);
  const A = await signIn(env('E2E_A_EMAIL'), env('E2E_A_PASSWORD'));
  const B = await signIn(env('E2E_B_EMAIL'), env('E2E_B_PASSWORD'));
  console.log('\nSocial publishing (migration 20261017220000 + publisher)');
  // Earlier interrupted runs must not affect counts: cancel leftover live jobs of the TEST workspaces.
  await sdb('publish_jobs').update({ status: 'cancelled', error_code: 'test_cleanup' }).in('organization_id', [A.orgId, B.orgId]).in('status', ['queued', 'processing']);
  await sdb('publishing_controls').delete().in('organization_id', [A.orgId, B.orgId]);
  await sdb('feature_flags').update({ enabled: false }).eq('key', 'auto_publishing');
  await sdb('facebook_pages').update({ status: 'disconnected', selected: false }).in('organization_id', [A.orgId, B.orgId]).eq('status', 'active');

  // A library image (simple media) and an approved Image Studio design with an export.
  const upload = async (s: Session, folder = '') => {
    const path = `${s.orgId}/${folder}${crypto.randomUUID()}.png`;
    await s.client.storage.from('workspace-assets').upload(path, PNG(), { contentType: 'image/png' });
    return path;
  };
  const libPath = await upload(A);
  const lib = await A.rpc('register_media_asset', { p_organization_id: A.orgId, p_object_path: libPath, p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: 68, p_file_name: 'meal.png', p_width: 1, p_height: 1, p_duration_ms: null, p_label: 'meal' });
  const bLib = await B.rpc('register_media_asset', { p_organization_id: B.orgId, p_object_path: await upload(B), p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: 68, p_file_name: 'b.png', p_width: 1, p_height: 1, p_duration_ms: null, p_label: 'b' });
  const doc = { version: 1, width: 1080, height: 1080, background: { kind: 'color', color: '#ffffff' }, meta: { generator: 'manual' }, layers: [{ id: 't', name: 'h', type: 'text', x: 60, y: 60, w: 900, h: 120, rotation: 0, opacity: 1, visible: true, locked: false, content: 'Chicken Box', font: 'Arial', size: 72, weight: 900, italic: false, color: '#211e2b', align: 'center', line_height: 1.2, background: null, padding: 0, radius: 0, role: 'headline' }] };
  const design = async (title: string) => {
    const c = await A.rpc('save_image_project', { p_organization_id: A.orgId, p_project_id: null, p_base_updated_at: null, p_title: title, p_purpose: 'social_post', p_aspect: '1:1', p_style: 'modern', p_prompt: '', p_brief: {}, p_document: doc, p_source: 'manual', p_label: null, p_series_id: null, p_source_project_id: null });
    const ap = await A.rpc('approve_image_project', { p_project_id: c.data.id, p_base_updated_at: c.data.updated_at });
    const path = await upload(A, 'exports/');
    const ex = await A.rpc('register_image_export', { p_project_id: c.data.id, p_object_path: path, p_format: 'png', p_width: 1080, p_height: 1080, p_size_bytes: 68, p_revision_number: null });
    return { id: c.data.id as string, asset: ex.data?.media_asset_id as string, ok: !c.error && !ap.error && !ex.error };
  };
  const d1 = await design('E2E social design 1');
  check('fixtures: a library image and an approved design with an export', !!lib.data && d1.ok, [lib.error?.message]);

  type Saved = { id: string; updated_at: string; status: string; revision_number: number };
  const save = (s: Session, id: string | null, base: string | null, extra: Record<string, unknown> = {}) =>
    s.rpc('save_social_post_v2', {
      p_organization_id: s.orgId, p_post_id: id, p_base_updated_at: base, p_title: 'E2E chicken meal', p_caption: 'Say hello to our new chicken meal. Price: [Price]',
      p_headline: 'Dar Lemon · chicken meal', p_hashtags: ['chicken', 'meal'], p_cta: 'Order now', p_language_code: 'en', p_tone: 'friendly', p_media_kind: 'image',
      p_image_project_id: null, p_media_asset_id: lib.data, p_render_job_id: null, p_source_project_id: null, p_origin: 'ai', p_revision_source: 'manual', p_revision_label: null, ...extra,
    });
  const post = async (caption = 'Say hello to our new chicken meal. Price: 850 DA', extra: Record<string, unknown> = {}) => {
    const c = (await save(A, null, null, { p_caption: caption, ...extra })).data as Saved;
    const ap = await A.rpc('approve_social_post', { p_post_id: c.id, p_base_updated_at: c.updated_at });
    return { id: c.id, updated_at: (ap.data?.updated_at ?? c.updated_at) as string, approve: ap };
  };
  const row = async (id: string) => (await sdb('social_posts').select('*').eq('id', id).single()).data as Record<string, any>;
  const jobOf = async (postId: string) => (await sdb('publish_jobs').select('*').eq('post_id', postId).order('created_at', { ascending: false }).limit(1).maybeSingle()).data as Record<string, any> | null;
  const usedPosts = async () => ((await sdb('usage_balances').select('used_posts').eq('organization_id', A.orgId).single()).data as { used_posts: number }).used_posts;
  const audit = async (postId: string) => ((await sdb('platform_audit_events').select('event_type').eq('entity_id', postId).order('id')).data ?? []).map((e: { event_type: string }) => e.event_type);
  const at = (msFromNow: number, tz = 'Africa/Algiers') => utcToZoned(new Date(Date.now() + msFromNow), tz);

  // --- Editing, review, approval -------------------------------------------------------------------------
  const created = await save(A, null, null);
  const c = created.data as Saved;
  check('an AI-assisted draft is saved as revision 1 (status draft)', !created.error && c?.status === 'draft' && c?.revision_number === 1, created.error?.message);
  const foreign = await save(A, c.id, c.updated_at, { p_media_asset_id: bLib.data });
  check('a post cannot use another workspace’s image', !!foreign.error && /outside this workspace/i.test(foreign.error.message), foreign.error?.message ?? 'accepted');
  const ph = await A.rpc('approve_social_post', { p_post_id: c.id, p_base_updated_at: c.updated_at });
  check('a [placeholder] (missing price) blocks approval', !!ph.error && /placeholders/i.test(ph.error.message), ph.error?.message ?? 'accepted');
  const sub = await A.rpc('submit_social_post_review', { p_post_id: c.id, p_base_updated_at: c.updated_at });
  const rej = await A.rpc('reject_social_post', { p_post_id: c.id, p_note: 'Add the real price' });
  check('review request and rejection with a note (back to draft)', !sub.error && rej.data?.status === 'draft', [sub.error?.message, rej.error?.message]);
  const e2 = await save(A, c.id, rej.data.updated_at, { p_caption: 'Say hello to our new chicken meal. Price: 850 DA' });
  const stale = await save(A, c.id, rej.data.updated_at, { p_caption: 'other' });
  check('a save based on an old version is refused', !!stale.error && /changed since/i.test(stale.error.message));
  const bApprove = await B.rpc('approve_social_post', { p_post_id: c.id, p_base_updated_at: e2.data.updated_at });
  check('another workspace cannot approve the post', !!bApprove.error);
  const ap = await A.rpc('approve_social_post', { p_post_id: c.id, p_base_updated_at: e2.data.updated_at });
  check('the edited post is approved', !ap.error && ap.data?.status === 'approved', ap.error?.message);
  const locked = await save(A, c.id, ap.data.updated_at, { p_caption: 'silent change' });
  check('an approved post cannot be edited silently', !!locked.error && /remove approval/i.test(locked.error.message));
  const { data: revs } = await A.db('social_post_revisions').select('revision_number, source').eq('post_id', c.id).order('revision_number');
  check('revisions record created, manual edits and approval', JSON.stringify((revs ?? []).map((r: { source: string }) => r.source)) === '["created","manual","approval"]', revs);
  check('another workspace cannot read the post or its revisions', ((await B.db('social_posts').select('id').eq('id', c.id)).data ?? []).length === 0 && ((await B.db('social_post_revisions').select('id').eq('post_id', c.id)).data ?? []).length === 0);

  // --- Pages and scheduling ------------------------------------------------------------------------------
  const noPage = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: ap.data.updated_at, p_page_id: crypto.randomUUID(), p_local_time: null, p_timezone: 'UTC' });
  check('scheduling needs a connected Page of the workspace', !!noPage.error && /connected page/i.test(noPage.error.message), noPage.error?.message);
  const pageA = (await A.rpc('add_mock_facebook_page', { p_organization_id: A.orgId, p_name: 'Dar Lemon (simulated)' })).data as string;
  const pageB = (await B.rpc('add_mock_facebook_page', { p_organization_id: B.orgId, p_name: 'Other (simulated)' })).data as string;
  check('simulated Pages are connected (labelled, no token)', !!pageA && !!pageB && ((await sdb('facebook_pages').select('is_mock, token_secret_ref').eq('id', pageA).single()).data as any)?.is_mock === true);
  const onB = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: ap.data.updated_at, p_page_id: pageB, p_local_time: null, p_timezone: 'UTC' });
  check('a post cannot be scheduled on another workspace’s Page', !!onB.error);
  const past = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: ap.data.updated_at, p_page_id: pageA, p_local_time: at(-3_600_000), p_timezone: 'Africa/Algiers' });
  check('a time in the past is refused', !!past.error && /future/i.test(past.error.message));
  const badTz = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: ap.data.updated_at, p_page_id: pageA, p_local_time: at(60_000), p_timezone: 'Mars/Base' });
  check('an unknown time zone is refused', !!badTz.error && /time zone/i.test(badTz.error.message));
  const u0 = await usedPosts();
  const sch = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: ap.data.updated_at, p_page_id: pageA, p_local_time: at(120_000), p_timezone: 'Africa/Algiers' });
  check('the approved post is scheduled about 2 minutes ahead (Africa/Algiers wall-clock time)', !sch.error && sch.data?.status === 'scheduled' && sch.data?.simulated === true, sch.error?.message);
  const j1 = await jobOf(c.id);
  check('the stored time is the right UTC instant (±60 s)', Math.abs(new Date(j1?.run_at).getTime() - (Date.now() + 120_000)) < 61_000, j1?.run_at);
  check('scheduling reserves one post from the plan', (await usedPosts()) === u0 + 1);
  const again = await A.rpc('schedule_social_post', { p_post_id: c.id, p_base_updated_at: sch.data.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  check('scheduling twice is refused (no duplicate publication)', !!again.error && /already scheduled/i.test(again.error.message));
  const dupInsert = await sdb('publish_jobs').insert({ organization_id: A.orgId, post_id: c.id, page_id: pageA, adapter: 'mock', idempotency_key: `dup-${crypto.randomUUID()}`, payload: {}, run_at: new Date().toISOString() });
  check('the database itself refuses a second live job for the same post', !!dupInsert.error);
  check('customers cannot insert publish jobs or call worker functions', !!(await A.db('publish_jobs').insert({ organization_id: A.orgId, post_id: c.id, adapter: 'mock', idempotency_key: 'x-123456', payload: {}, run_at: new Date().toISOString() })).error && !!(await A.rpc('claim_publish_job', { p_worker_id: 'me' })).error && !!(await A.rpc('mock_facebook_publish', { p_job_id: j1?.id, p_worker_id: 'me' })).error);
  check('customers cannot read the test-only failure injection column', !!(await A.db('publish_jobs').select('simulate').eq('post_id', c.id)).error);
  check('another workspace cannot see the publication job', ((await B.db('publish_jobs').select('id').eq('post_id', c.id)).data ?? []).length === 0);

  // Survives restarts: the publisher runs before the time (nothing happens), stops, then runs after it.
  const early = await publisher();
  { const r0 = await row(c.id); const jj = await jobOf(c.id); check('before its time, a scheduled post is not published', r0.status === 'scheduled', [r0.status, r0.last_error, jj?.status, jj?.run_at, new Date().toISOString(), early.slice(-300)]); }
  // Time passes (instead of waiting two minutes): the job becomes due.
  await sdb('publish_jobs').update({ run_at: new Date().toISOString() }).eq('id', j1?.id);
  const run1 = await publisher();
  const pub = await row(c.id);
  check('a new publisher process publishes it on time (schedule survived the restart)', pub.status === 'published' && pub.simulated === true && /^sim_/.test(pub.external_post_id ?? ''), [pub.status, run1.slice(-400)]);
  check('the mock adapter made no network call to Facebook', /blocked facebook calls: 0/.test(run1));
  check('the simulated publication is recorded once with the approved text', ((await sdb('mock_facebook_publications').select('message').eq('external_post_id', pub.external_post_id)).data ?? []).map((m: { message: string }) => m.message).join('|').includes('Price: 850 DA'));
  check('the audit log shows the whole flow', JSON.stringify(await audit(c.id)) === '["post.review_requested","post.rejected","post.approved","post.scheduled","post.simulated_published"]', await audit(c.id));

  // Concurrent scheduling of the same post: exactly one succeeds.
  const p2 = await post();
  const [r1, r2] = await Promise.all([
    A.rpc('schedule_social_post', { p_post_id: p2.id, p_base_updated_at: p2.updated_at, p_page_id: pageA, p_local_time: at(600_000), p_timezone: 'UTC' }),
    A.rpc('schedule_social_post', { p_post_id: p2.id, p_base_updated_at: p2.updated_at, p_page_id: pageA, p_local_time: at(600_000), p_timezone: 'UTC' }),
  ]);
  check('two simultaneous schedule requests: exactly one succeeds', [r1, r2].filter((r) => !r.error).length === 1, [r1.error?.message, r2.error?.message]);
  // Cancel: the queued job is withdrawn, the post slot refunded, nothing is published.
  const u1 = await usedPosts();
  const bCancel = await B.rpc('unschedule_social_post', { p_post_id: p2.id, p_cancel: true });
  const cancel = await A.rpc('unschedule_social_post', { p_post_id: p2.id, p_cancel: true });
  await sdb('publish_jobs').update({ run_at: new Date().toISOString() }).eq('post_id', p2.id);
  await publisher();
  check('another workspace cannot cancel it; the owner can', !!bCancel.error && cancel.data?.status === 'cancelled');
  check('a cancelled post is never published and its slot is refunded', (await row(p2.id)).status === 'cancelled' && (await jobOf(p2.id))?.status === 'cancelled' && (await usedPosts()) === u1 - 1);

  // Retries: two simulated rate-limit errors, then success.
  const p3 = await post();
  await A.rpc('schedule_social_post', { p_post_id: p3.id, p_base_updated_at: p3.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  await sdb('publish_jobs').update({ simulate: { fail_attempts: 2, error: 'rate_limited' } }).eq('post_id', p3.id);
  for (let i = 0; i < 3; i++) {
    await publisher();
    await sdb('publish_jobs').update({ run_at: new Date().toISOString() }).eq('post_id', p3.id).eq('status', 'queued');
  }
  const j3 = await jobOf(p3.id);
  check('rate-limit errors are retried with back-off, then the post is published', j3?.status === 'succeeded' && j3?.attempt_count === 3 && (await row(p3.id)).status === 'published', [j3?.status, j3?.attempt_count]);
  check('each retry is audited', (await audit(p3.id)).filter((e: string) => e === 'post.publish_retry').length === 2);

  // A permanent failure: explained, not retried, slot refunded.
  const p4 = await post();
  const u2 = await usedPosts();
  await A.rpc('schedule_social_post', { p_post_id: p4.id, p_base_updated_at: p4.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  await sdb('publish_jobs').update({ simulate: { fail_attempts: 9, error: 'content_rejected' } }).eq('post_id', p4.id);
  await publisher();
  const f4 = await row(p4.id);
  check('a content rejection fails at once with an explanation and refunds the slot', f4.status === 'failed' && f4.last_error === 'content_rejected' && (await jobOf(p4.id))?.attempt_count === 1 && (await usedPosts()) === u2, [f4.status, f4.last_error]);
  const reedit = await save(A, p4.id, f4.updated_at, { p_caption: 'Say hello to our new chicken meal. Price: 850 DA (updated)' });
  check('a failed post can be edited again (back to draft)', !reedit.error && reedit.data?.status === 'draft');

  // A publisher that dies after publishing: the takeover must not publish twice.
  const p5 = await post();
  await A.rpc('schedule_social_post', { p_post_id: p5.id, p_base_updated_at: p5.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  const claimed = await (admin.rpc as any)('claim_publish_job', { p_worker_id: 'dying-publisher', p_lease_seconds: 20 });
  const dead = (claimed.data ?? [])[0];
  await (admin.rpc as any)('mock_facebook_publish', { p_job_id: dead?.id, p_worker_id: 'dying-publisher' });
  await sdb('publish_jobs').update({ heartbeat_at: new Date(Date.now() - 120_000).toISOString() }).eq('id', dead?.id);
  const takeover = await publisher();
  const j5 = await jobOf(p5.id);
  const pubs = (await sdb('mock_facebook_publications').select('external_post_id').eq('idempotency_key', j5?.idempotency_key)).data ?? [];
  check('a publication left by a dead publisher is completed by the next one', dead?.post_id === p5.id && j5?.status === 'succeeded' && j5?.attempt_count === 2, [dead?.post_id, j5?.status, j5?.attempt_count]);
  check('…and the post exists exactly once (idempotency key)', pubs.length === 1 && /already published: idempotent/.test(takeover), [pubs.length, takeover.slice(-300)]);

  // Expired connection: reconnect required, not retried.
  const p6 = await post();
  await A.rpc('schedule_social_post', { p_post_id: p6.id, p_base_updated_at: p6.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  const connId = ((await sdb('facebook_pages').select('connection_id').eq('id', pageA).single()).data as { connection_id: string }).connection_id;
  await sdb('social_connections').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', connId);
  await publisher();
  check('an expired Page connection fails the publication with "reconnect required"', (await row(p6.id)).last_error === 'reconnect_required' && ((await sdb('social_connections').select('status').eq('id', connId).single()).data as any)?.status === 'expired');
  const p6b = await post();
  const blocked = await A.rpc('schedule_social_post', { p_post_id: p6b.id, p_base_updated_at: p6b.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  check('nothing new can be scheduled on an expired connection', !!blocked.error && /reconnect/i.test(blocked.error.message));
  await sdb('social_connections').update({ expires_at: null, status: 'connected' }).eq('id', connId);

  // Emergency pause: nothing is claimed while paused; scheduling is refused; resume publishes.
  const p7 = await post();
  await A.rpc('schedule_social_post', { p_post_id: p7.id, p_base_updated_at: p7.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  const bPause = await B.rpc('set_publishing_paused', { p_organization_id: A.orgId, p_paused: true, p_reason: 'x' });
  await A.rpc('set_publishing_paused', { p_organization_id: A.orgId, p_paused: true, p_reason: 'E2E emergency stop' });
  await publisher();
  const p8 = await post();
  const whilePaused = await A.rpc('schedule_social_post', { p_post_id: p8.id, p_base_updated_at: p8.updated_at, p_page_id: pageA, p_local_time: null, p_timezone: 'UTC' });
  check('another workspace cannot pause publishing here', !!bPause.error);
  check('while paused, scheduled posts wait and new scheduling is refused', (await row(p7.id)).status === 'scheduled' && !!whilePaused.error && /paused/i.test(whilePaused.error.message));
  await A.rpc('set_publishing_paused', { p_organization_id: A.orgId, p_paused: false, p_reason: null });
  await publisher();
  check('after resuming, the waiting post is published', (await row(p7.id)).status === 'published');

  // Invalidation: the approved design loses its approval → the scheduled post goes back to draft.
  const p9 = await post('Our chicken box, 850 DA', { p_image_project_id: d1.id, p_media_asset_id: d1.asset });
  await A.rpc('schedule_social_post', { p_post_id: p9.id, p_base_updated_at: p9.updated_at, p_page_id: pageA, p_local_time: at(3_600_000), p_timezone: 'UTC' });
  const u3 = await usedPosts();
  await A.rpc('remove_image_approval', { p_project_id: d1.id });
  check('removing the design’s approval withdraws the scheduled post and refunds it', (await row(p9.id)).status === 'draft' && (await row(p9.id)).last_error === 'image_changed' && (await jobOf(p9.id))?.status === 'cancelled' && (await usedPosts()) === u3 - 1);

  // Invalidation by video: a post using an MP4 export of an approved script.
  const ad = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'Chicken Box' }, export_presets: ['vertical_9_16'] });
  ad.title = 'E2E social video';
  ad.scenes = [newScene({ title: 'Hook', duration_seconds: 3, on_screen_text: 'Chicken Box' })];
  const proj = await A.rpc('save_studio_project_v3', { ...toRpcArgsV2(A.orgId, toSaveRequest(ad)), p_base_updated_at: null, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false });
  const projectId = proj.data?.project_id as string;
  const { data: pr } = await A.db('studio_projects').select('updated_at').eq('id', projectId).single();
  await A.rpc('approve_project_script', { p_project_id: projectId, p_base_updated_at: (pr as { updated_at: string }).updated_at });
  const { data: approvedP } = await sdb('studio_projects').select('approved_revision_id').eq('id', projectId).single();
  const { data: rev } = await sdb('project_revisions').select('revision_number').eq('id', (approvedP as any).approved_revision_id).single();
  const { data: vAsset } = await sdb('media_assets').insert({ organization_id: A.orgId, bucket_id: 'workspace-assets', object_path: `${A.orgId}/renders/${crypto.randomUUID()}.mp4`, media_type: 'video', source: 'generated', kind: 'render', mime_type: 'video/mp4', file_name: 'v.mp4' }).select('id').single();
  const { data: vJob } = await sdb('render_jobs').insert({ organization_id: A.orgId, project_id: projectId, idempotency_key: `e2e-${crypto.randomUUID()}`, script_revision_id: (approvedP as any).approved_revision_id, script_revision_number: (rev as any).revision_number, aspect: '9:16', width: 480, height: 854, quality: 'draft', spec: {}, total_duration_ms: 3000, status: 'completed', output_media_asset_id: (vAsset as any).id }).select('id').single();
  const pv = await post('Watch our chicken box video', { p_media_kind: 'video', p_media_asset_id: null, p_render_job_id: (vJob as any).id });
  check('a post with an MP4 export of the approved script is approved', !pv.approve.error, pv.approve.error?.message);
  await A.rpc('schedule_social_post', { p_post_id: pv.id, p_base_updated_at: pv.updated_at, p_page_id: pageA, p_local_time: at(3_600_000), p_timezone: 'UTC' });
  await A.rpc('remove_script_approval', { p_project_id: projectId });
  check('removing the script approval withdraws the scheduled video post', (await row(pv.id)).status === 'draft' && (await row(pv.id)).last_error === 'video_changed' && (await jobOf(pv.id))?.status === 'cancelled');
  const pvAgain = await A.rpc('approve_social_post', { p_post_id: pv.id, p_base_updated_at: (await row(pv.id)).updated_at });
  check('it cannot be approved again while the video’s script is not approved', !!pvAgain.error && /no longer approved/i.test(pvAgain.error.message), pvAgain.error?.message);

  // Live Facebook stays off.
  const { data: liveConn } = await sdb('social_connections').insert({ organization_id: A.orgId, provider: 'facebook', external_user_id: `real-${crypto.randomUUID()}`, status: 'connected', connected_by: ((await A.client.auth.getUser()).data.user!.id) }).select('id').single();
  const { data: livePage } = await sdb('facebook_pages').insert({ organization_id: A.orgId, connection_id: (liveConn as any).id, page_id: `real_${Date.now()}`, page_name: 'Real page (test row)', is_mock: false, status: 'active' }).select('id').single();
  const p10 = await post();
  const live = await A.rpc('schedule_social_post', { p_post_id: p10.id, p_base_updated_at: p10.updated_at, p_page_id: (livePage as any).id, p_local_time: null, p_timezone: 'UTC' });
  check('a real (non-simulated) Page cannot be scheduled while live publishing is disabled', !!live.error && /live facebook publishing is not enabled/i.test(live.error.message), live.error?.message);
  const forced = await sdb('publish_jobs').insert({ organization_id: A.orgId, post_id: p10.id, page_id: (livePage as any).id, adapter: 'facebook', idempotency_key: `force-${crypto.randomUUID()}`, payload: { message: 'x', page_external_id: 'real' }, run_at: new Date().toISOString(), simulated: false }).select('id').single();
  const liveRun = await publisher();
  check('even a forced live job is refused by the publisher (no Graph call)', ((await sdb('publish_jobs').select('status, error_code').eq('id', (forced.data as any)?.id).single()).data as any)?.error_code === 'live_publishing_disabled' && /blocked facebook calls: 0/.test(liveRun));
  await A.rpc('disconnect_facebook_page', { p_page_id: (livePage as any).id });

  // --- Controlled automation ---------------------------------------------------------------------------
  const d2 = await design('E2E automation design');
  const rules = { page_id: pageA, content_types: ['approved_designs'], topics: 'Weekly chef special', tone: 'friendly', language_code: 'en', facts: { product_name: '', price: '' }, days: [0, 1, 2, 3, 4, 5, 6], times: ['00:00', '06:00', '12:00', '18:00'], timezone: 'UTC', max_posts_per_week: 2, boundary: 'publish_within_policy' };
  const pol = await A.rpc('save_automation_policy', { p_organization_id: A.orgId, p_policy_id: null, p_name: 'E2E chef special', p_rules: rules });
  check('an automation policy is saved as version 1 (draft: not active)', !pol.error && pol.data?.status === 'draft' && pol.data?.version === 1, pol.error?.message);
  const noFlag = await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 1, p_confirmed: true });
  check('automatic publishing is off by default (platform flag)', !!noFlag.error && /not available/i.test(noFlag.error.message));
  await sdb('feature_flags').update({ enabled: true }).eq('key', 'auto_publishing');
  const unconfirmed = await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 1, p_confirmed: false });
  const wrongVersion = await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 7, p_confirmed: true });
  const bAuth = await B.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 1, p_confirmed: true });
  check('authorisation needs explicit confirmation of the exact rules version, by this workspace', !!unconfirmed.error && !!wrongVersion.error && !!bAuth.error);
  const auth1 = await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 1, p_confirmed: true });
  check('the owner authorises version 1', auth1.data?.status === 'active', auth1.error?.message);
  const autoRun = await publisher();
  const { data: autoPosts } = await sdb('social_posts').select('*').eq('automation_policy_id', pol.data.id);
  const ap1 = (autoPosts ?? [])[0];
  check('the automation creates one post under the policy (Mock AI text, approved design)', (autoPosts ?? []).length === 1 && ap1.origin === 'automation' && ap1.automation_policy_version === 1, [(autoPosts ?? []).length, autoRun.slice(-500)]);
  check('a policy that gives no price makes a post without invented facts', !/\d+\s?(DA|€|\$)/.test(ap1?.caption ?? ''));
  check('within the policy boundary it is approved and scheduled at a policy slot', ap1?.status === 'scheduled' && ['00:00', '06:00', '12:00', '18:00'].includes(new Date(ap1.scheduled_at).toISOString().slice(11, 16)));
  check('the scheduling is audited with the policy version', ((await sdb('platform_audit_events').select('metadata').eq('entity_id', ap1?.id).eq('event_type', 'automation.post_scheduled')).data ?? [])[0]?.metadata?.policy_version === 1);
  const edited = await A.rpc('save_automation_policy', { p_organization_id: A.orgId, p_policy_id: pol.data.id, p_name: 'E2E chef special', p_rules: { ...rules, boundary: 'review_each' } });
  check('changing the rules creates version 2 and de-authorises the policy', edited.data?.version === 2 && edited.data?.status === 'draft');
  await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 2, p_confirmed: true });
  const revoke = await A.rpc('set_automation_policy_state', { p_policy_id: pol.data.id, p_state: 'revoked' });
  check('revoking the policy withdraws its scheduled post', !revoke.error && (await row(ap1.id)).status === 'draft' && (await row(ap1.id)).last_error === 'automation_revoked');
  const reauth = await A.rpc('authorize_automation_policy', { p_policy_id: pol.data.id, p_version: 2, p_confirmed: true });
  check('a revoked policy cannot be authorised again', !!reauth.error);
  await sdb('feature_flags').update({ enabled: false }).eq('key', 'auto_publishing');

  // Credentials and admin boundary.
  check('customers cannot call the Vault token functions', !!(await A.rpc('read_oauth_secret', { p_secret_id: crypto.randomUUID() })).error && !!(await A.rpc('store_oauth_secret', { p_secret: 'x' })).error);
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  if (adminEmail) {
    const ADM = await signIn(adminEmail, env('E2E_ADMIN_PASSWORD'));
    check('the platform admin cannot read tokens or this workspace’s posts', !!(await ADM.rpc('read_oauth_secret', { p_secret_id: crypto.randomUUID() })).error && ((await ADM.db('social_posts').select('id').eq('id', c.id)).data ?? []).length === 0);
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  check('signed-out users see no posts, jobs or policies', ((await (anon as any).from('social_posts').select('id').limit(1)).data ?? []).length === 0 && ((await (anon as any).from('automation_policies').select('id').limit(1)).data ?? []).length === 0);

  console.log(`\n${passes} passed, ${failures} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
