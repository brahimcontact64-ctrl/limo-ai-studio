/**
 * Backend end-to-end verification against a real Supabase project (local stack or production).
 *
 * Exercises the exact RPC payload the app sends (toRpcArgs) as two real users:
 *   save → reload → edit → reload, backend limit enforcement, tenant isolation, anonymous access,
 *   and (when migration 20261016120000 is applied) archive / restore / delete.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   E2E_A_EMAIL, E2E_A_PASSWORD   – user with completed profile + active subscription (editor/owner)
 *   E2E_B_EMAIL, E2E_B_PASSWORD   – a user in a DIFFERENT workspace
 *
 * Usage: node scripts/e2e-backend.ts
 * Creates projects titled "E2E …" in user A's workspace and deletes them at the end when possible.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { toRpcArgs } from '../lib/studio/validation.ts';
import { newScene, projectFromDb, toSaveRequest, type DbSceneRow } from '../lib/studio/draft.ts';
import type { ProjectDraft } from '../lib/studio/types.ts';
import { totp } from './lib/totp.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env ${k}`);
    process.exit(2);
  }
  return v;
};
const URL_ = env('SUPABASE_URL');
const KEY = env('SUPABASE_ANON_KEY');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

async function signIn(email: string, password: string) {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const { data: m } = await client.from('organization_members').select('organization_id, role').eq('user_id', data.user.id);
  if (!m?.length) throw new Error(`${email} has no workspace`);
  return { client, userId: data.user.id, orgId: m[0]!.organization_id as string, role: m[0]!.role as string };
}

async function load(client: SupabaseClient, id: string): Promise<ProjectDraft | null> {
  const { data: row } = await client.from('studio_projects').select('id, title, content_type, language_code, brief, goal, visual_style, project_cast').eq('id', id).maybeSingle();
  if (!row) return null;
  const { data: scenes } = await client.from('project_scenes').select('*').eq('project_id', id).order('scene_number');
  const { data: presets } = await client.from('project_export_choices').select('preset_code').eq('project_id', id).order('preset_code');
  return projectFromDb(row, (scenes ?? []) as DbSceneRow[], (presets ?? []).map((p: { preset_code: string }) => p.preset_code));
}

const comparable = (d: ProjectDraft) => {
  const r = toSaveRequest(d);
  return JSON.stringify({ ...r, project_id: null, export_presets: [...r.export_presets].sort() });
};

function sampleDraft(): ProjectDraft {
  return {
    id: null,
    title: `E2E market day ${new Date().toISOString()}`,
    content_type: 'storytelling',
    language_code: 'ar',
    brief: 'سلسلة قصيرة عن التسوق الذكي — E2E',
    goal: 'Explain seasonal shopping',
    visual_style: 'bright stylized 3D',
    cast: ['limo_boy', 'nova_girl', 'adam_man', 'nova_elder_woman', 'limo_elder_man'],
    scenes: [
      newScene({
        title: 'Opening',
        duration_seconds: 8,
        participants: ['limo_boy'],
        location_prompt: 'Outdoor market',
        environment_prompt: 'Wooden stalls',
        camera_prompt: 'Slow push-in',
        lighting_prompt: 'Golden hour',
        action_prompt: 'Limo picks an orange',
        dialogue: 'ليمو: انظري!',
        on_screen_text: 'Tip #1',
        effects_prompt: 'Sparkle',
        music_prompt: 'Acoustic',
        transition_out: 'Whip pan',
        continuity_notes: 'Orange in right hand',
      }),
      newScene({ title: 'Grandma', duration_seconds: 15, participants: ['limo_boy', 'nova_elder_woman'] }),
      newScene({ title: 'Wide shot', duration_seconds: 5, participants: [] }),
      newScene({ title: 'Everyone', duration_seconds: 12, participants: ['limo_boy', 'nova_girl', 'adam_man', 'limo_elder_man'] }),
    ],
    export_presets: ['vertical_9_16', 'square_1_1'],
  };
}

async function main() {
  console.log(`Target: ${URL_}`);
  const A = await signIn(env('E2E_A_EMAIL'), env('E2E_A_PASSWORD'));
  const B = await signIn(env('E2E_B_EMAIL'), env('E2E_B_PASSWORD'));
  check('users A and B are in different workspaces', A.orgId !== B.orgId);
  const created: string[] = [];

  console.log('\nCatalog');
  const { data: chars } = await A.client.from('character_catalog').select('id').eq('active', true).not('family_code', 'is', null);
  check('18 active cast variants', (chars ?? []).length === 18, (chars ?? []).length);

  console.log('\nCreate → reload');
  const draft = sampleDraft();
  const { data: id, error: saveErr } = await A.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(draft)));
  check('create project with 5 characters and 4 scenes', !saveErr && typeof id === 'string', saveErr?.message);
  if (typeof id !== 'string') return finish();
  created.push(id);
  const loaded = await load(A.client, id);
  check('reloaded project matches what was saved (all scene fields, cast, presets)', !!loaded && comparable(loaded) === comparable(draft), loaded ? undefined : 'not found');
  const { data: row } = await A.client.from('studio_projects').select('project_cast, status, total_duration_seconds, estimated_slots').eq('id', id).single();
  check('project_cast stored as [{id}] objects', JSON.stringify(row?.project_cast) === JSON.stringify(draft.cast.map((c) => ({ id: c }))), row?.project_cast);
  check('status draft, duration 40 s, 2 slots', row?.status === 'draft' && row?.total_duration_seconds === 40 && row?.estimated_slots === 2, row);

  console.log('\nEdit → reload');
  const edited: ProjectDraft = {
    ...loaded!,
    id,
    title: `${draft.title} (edited)`,
    language_code: 'fr',
    cast: ['limo_boy', 'nova_girl', 'adam_man'],
    scenes: [loaded!.scenes[3]!, loaded!.scenes[0]!].map((s) => ({ ...s, participants: s.participants.filter((p) => ['limo_boy', 'nova_girl', 'adam_man'].includes(p)) })),
    export_presets: ['landscape_16_9'],
  };
  edited.scenes[1]!.dialogue = 'LIMO : Regarde !';
  const { data: id2, error: editErr } = await A.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(edited)));
  check('update same project (reorder, remove scenes, shrink cast)', !editErr && id2 === id, editErr?.message);
  const reloaded = await load(A.client, id);
  check('reloaded edit matches', !!reloaded && comparable(reloaded) === comparable(edited));
  const { count: sceneCount } = await A.client.from('project_scenes').select('id', { count: 'exact', head: true }).eq('project_id', id);
  check('removed scenes are gone (2 remain)', sceneCount === 2, sceneCount);

  console.log('\nBackend limits');
  const bad = async (name: string, mutate: (d: ProjectDraft) => void, expect: RegExp) => {
    const d = sampleDraft();
    mutate(d);
    const { data, error } = await A.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(d)));
    if (typeof data === 'string') created.push(data);
    check(name, !!error && expect.test(error.message), error?.message ?? 'accepted');
  };
  await bad('rejects a 16-second scene', (d) => (d.scenes[0]!.duration_seconds = 16), /15 seconds|duration/i);
  await bad('rejects a participant outside the cast', (d) => (d.scenes[0]!.participants = ['adam_elder_woman']), /not in the project cast/i);
  await bad('rejects content type "story"', (d) => (d.content_type = 'story'), /content type/i);
  await bad('rejects 26 scenes', (d) => (d.scenes = Array.from({ length: 26 }, () => newScene({ duration_seconds: 1 }))), /1 to 25 scenes/i);
  await bad('rejects 19 characters', (d) => (d.cast = [...d.cast, ...Array.from({ length: 14 }, (_, i) => `x_${i}`)]), /1 and 18|unique|unavailable/i);

  const all18 = ['limo', 'nova', 'adam'].flatMap((f) => ['boy', 'girl', 'man', 'woman', 'elder_man', 'elder_woman'].map((v) => `${f}_${v}`));
  const full = sampleDraft();
  full.cast = all18;
  const { data: id18, error: err18 } = await A.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(full)));
  if (typeof id18 === 'string') created.push(id18);
  check('accepts all 18 characters', !err18, err18?.message);

  console.log('\nTenant isolation');
  const { data: peek } = await B.client.from('studio_projects').select('id').eq('id', id);
  check('user B cannot read A’s project', (peek ?? []).length === 0);
  const { data: peekScenes } = await B.client.from('project_scenes').select('id').eq('project_id', id);
  check('user B cannot read A’s scenes', (peekScenes ?? []).length === 0);
  const { error: crossOrg } = await B.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(sampleDraft())));
  check('user B cannot save into A’s workspace', !!crossOrg && /not authorized/i.test(crossOrg.message), crossOrg?.message ?? 'accepted');
  const hijack = { ...sampleDraft(), id };
  const { error: hijackErr } = await B.client.rpc('save_studio_project', toRpcArgs(B.orgId, toSaveRequest(hijack)));
  check('user B cannot overwrite A’s project via its own workspace', !!hijackErr, 'accepted');
  const still = await load(A.client, id);
  check('A’s project unchanged after B’s attempts', !!still && still.title === edited.title);

  console.log('\nAnonymous');
  const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data: anonRows } = await anon.from('studio_projects').select('id').limit(1);
  check('anonymous cannot list projects', (anonRows ?? []).length === 0);
  const { error: anonSave } = await anon.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(sampleDraft())));
  check('anonymous cannot call save_studio_project', !!anonSave);

  console.log('\nLifecycle (migration 20261016120000)');
  const rpc = A.client.rpc.bind(A.client) as unknown as (fn: string, a: object) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const probe = await rpc('archive_studio_project', { p_project_id: id });
  if (probe.error && (probe.error.code === 'PGRST202' || /could not find the function/i.test(probe.error.message))) {
    console.log('  SKIP  lifecycle functions not deployed');
  } else {
    check('archive', !probe.error && probe.data === 'archived', probe.error?.message);
    const { error: editArchived } = await A.client.rpc('save_studio_project', toRpcArgs(A.orgId, toSaveRequest(edited)));
    check('archived project is not editable', !!editArchived);
    const r = await rpc('restore_studio_project', { p_project_id: id });
    check('restore', !r.error && r.data === 'draft', r.error?.message);
    const bDel = await (B.client.rpc.bind(B.client) as unknown as typeof rpc)('delete_studio_project', { p_project_id: id });
    check('user B cannot delete A’s project', !!bDel.error);
  }

  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) {
    const ADMIN = await signIn(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
    await mfaChecks(ADMIN);
    await paymentChecks(A, B, ADMIN);
    await adminHardeningChecks(A, B, ADMIN);
  } else {
    console.log('\nPayments\n  SKIP  set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (local stack only)');
  }

  return finish(A.client, created, rpc);
}

type Session = Awaited<ReturnType<typeof signIn>>;
type Rpc = (fn: string, a: object) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const rpcFor = (s: Session) => s.client.rpc.bind(s.client) as unknown as Rpc;

/** Admin functions must refuse a single-factor session and accept it after TOTP verification. */
async function mfaChecks(ADMIN: Session) {
  console.log('\nAdmin two-factor (migration 20261016150000)');
  const secret = process.env.E2E_ADMIN_TOTP_SECRET;
  const before = await rpcFor(ADMIN)('admin_list_payment_submissions', { p_status: null });
  if (before.error && /could not find the function/i.test(before.error.message)) {
    console.log('  SKIP  admin functions not deployed');
    return;
  }
  check('admin functions refuse a session without the second factor', !!before.error && /two-factor/i.test(before.error.message), before.error?.message ?? 'accepted');
  if (!secret) {
    console.log('  SKIP  E2E_ADMIN_TOTP_SECRET not set; cannot reach aal2');
    return;
  }
  const { data: factors } = await ADMIN.client.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === 'verified');
  const bad = factor ? await ADMIN.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: '000000' }) : { error: new Error('no factor') };
  check('a wrong TOTP code is rejected', !!bad.error);
  const ok = factor ? await ADMIN.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) }) : { error: new Error('no factor') };
  check('a valid TOTP code upgrades the session to aal2', !ok.error, ok.error?.message);
  const after = await rpcFor(ADMIN)('admin_list_payment_submissions', { p_status: null });
  check('admin functions work with the second factor', !after.error, after.error?.message);
}

/** Workspace administration, feature flags and rate limiting (migrations 20261016140000, 20261017090000). */
async function adminHardeningChecks(A: Session, B: Session, ADMIN: Session) {
  console.log('\nAdmin hardening (migration 20261017090000)');
  const probe = await rpcFor(ADMIN)('admin_list_workspaces', {});
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  admin hardening functions not deployed');
    return;
  }
  const rows = (probe.data as Array<{ id: string; owner_email: string | null; plan_code: string | null }> | null) ?? [];
  check('admin lists workspaces with owner emails', !probe.error && rows.some((r) => r.id === A.orgId && !!r.owner_email), probe.error?.message);
  const custList = await rpcFor(B)('admin_list_workspaces', {});
  check('customers cannot list workspaces', !!custList.error);

  const noReason = await rpcFor(ADMIN)('admin_set_subscription', { p_organization_id: B.orgId, p_plan_code: 'creator', p_status: 'active', p_days: 30, p_reason: 'x' });
  check('subscription changes require a reason', !!noReason.error);
  const custSet = await rpcFor(B)('admin_set_subscription', { p_organization_id: B.orgId, p_plan_code: 'business', p_status: 'active', p_days: 366, p_reason: 'self upgrade attempt' });
  check('customers cannot change their own subscription', !!custSet.error && /not authorized/i.test(custSet.error.message), custSet.error?.message ?? 'accepted');
  const set = await rpcFor(ADMIN)('admin_set_subscription', { p_organization_id: B.orgId, p_plan_code: 'creator', p_status: 'active', p_days: 30, p_reason: 'E2E: support extension' });
  check('admin changes a subscription', !set.error, set.error?.message);
  const { data: sub } = await B.client.from('organization_subscriptions').select('plan_code, status').eq('organization_id', B.orgId).maybeSingle();
  check('the workspace sees the new plan', sub?.plan_code === 'creator' && sub.status === 'active', sub);
  const { count: audited } = await ADMIN.client.from('platform_audit_events').select('id', { count: 'exact', head: true }).eq('event_type', 'subscription.admin_set').eq('organization_id', B.orgId);
  check('the subscription change is audited', (audited ?? 0) >= 1, audited);

  const flagCust = await rpcFor(B)('admin_set_feature_flag', { p_key: 'custom_characters', p_enabled: false });
  check('customers cannot change feature flags', !!flagCust.error);
  const flagAdmin = await rpcFor(ADMIN)('admin_set_feature_flag', { p_key: 'custom_characters', p_enabled: true });
  check('admin changes a feature flag', !flagAdmin.error, flagAdmin.error?.message);
  const { data: flags } = await (B.client.from as unknown as (t: string) => ReturnType<typeof B.client.from>)('feature_flags').select('key');
  check('signed-in users can read feature flags', (flags ?? []).length >= 4, (flags ?? []).length);
  const { data: providers } = await B.client.from('ai_provider_registry').select('code');
  check('customers cannot read the provider registry', (providers ?? []).length === 0);

  const results: unknown[] = [];
  for (let i = 0; i < 4; i++) results.push((await rpcFor(A)('hit_rate_limit', { p_action: `e2e_probe_${Date.now() >> 16}`, p_limit: 3, p_window_seconds: 600 })).data);
  check('rate limit allows 3 calls then refuses the 4th', JSON.stringify(results) === '[true,true,true,false]', results);
}

/** Manual-payment activation (migration 20261016150000). User B has no subscription. */
async function paymentChecks(A: Session, B: Session, ADMIN: Session) {
  console.log('\nPayments (migration 20261016150000)');
  const submit = (s: Session, org: string, extra: object = {}) =>
    rpcFor(s)('submit_payment', { p_organization_id: org, p_purchase_type: 'subscription', p_item_code: 'starter', p_method: 'ccp', p_transaction_ref: `E2E-${Date.now()}`, p_receipt_path: null, ...extra });

  const probe = await rpcFor(B)('admin_review_payment', { p_payment_id: '00000000-0000-4000-8000-000000000000', p_approve: true });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  payment functions not deployed');
    return;
  }

  // Direct inserts with a client-chosen amount are no longer possible.
  const { error: directErr } = await B.client.from('payment_submissions').insert({
    organization_id: B.orgId, submitted_by: B.userId, purchase_type: 'subscription', item_code: 'starter', method: 'ccp', amount_dzd: 1, transaction_ref: 'cheap',
  });
  check('direct insert into payment_submissions is blocked', !!directErr, 'accepted');

  // Receipt storage isolation.
  const pdf = new Blob(['%PDF-1.4 e2e'], { type: 'application/pdf' });
  const ownPath = `${B.orgId}/${crypto.randomUUID()}.pdf`;
  const up = await B.client.storage.from('payment-receipts').upload(ownPath, pdf, { contentType: 'application/pdf' });
  check('owner uploads a receipt into its own workspace folder', !up.error, up.error?.message);
  const foreign = await B.client.storage.from('payment-receipts').upload(`${A.orgId}/${crypto.randomUUID()}.pdf`, pdf, { contentType: 'application/pdf' });
  check('cannot upload into another workspace folder', !!foreign.error);
  const aRead = await A.client.storage.from('payment-receipts').download(ownPath);
  check('another workspace cannot read the receipt', !!aRead.error);
  const adminRead = await ADMIN.client.storage.from('payment-receipts').download(ownPath);
  check('platform admin can read the receipt', !adminRead.error, adminRead.error?.message);

  // Submission: server-side pricing and authorization.
  const crossOrg = await submit(B, A.orgId);
  check('cannot submit a payment for another workspace', !!crossOrg.error && /not authorized/i.test(crossOrg.error.message), crossOrg.error?.message ?? 'accepted');
  const badPath = await submit(B, B.orgId, { p_receipt_path: `${A.orgId}/x.pdf` });
  check('receipt path must be in the submitting workspace', !!badPath.error, 'accepted');
  const { data: payId, error: subErr } = await submit(B, B.orgId, { p_receipt_path: ownPath });
  check('owner submits a payment claim', !subErr && typeof payId === 'string', subErr?.message);
  const { data: row } = await B.client.from('payment_submissions').select('amount_dzd, amount_usdt, status').eq('id', payId as string).single();
  check('amount is priced by the server (Starter = 5900 DZD)', row?.amount_dzd === 5900 && row?.amount_usdt === null && row?.status === 'pending', row);
  const { data: peek } = await A.client.from('payment_submissions').select('id').eq('id', payId as string);
  check('other workspaces cannot see the claim', (peek ?? []).length === 0);

  // Review: admin only, reason required to reject, single decision.
  const notAdmin = await rpcFor(B)('admin_review_payment', { p_payment_id: payId, p_approve: true, p_note: null });
  check('a customer cannot approve its own payment', !!notAdmin.error && /not authorized/i.test(notAdmin.error.message), notAdmin.error?.message ?? 'accepted');
  const noReason = await rpcFor(ADMIN)('admin_review_payment', { p_payment_id: payId, p_approve: false, p_note: '' });
  check('rejecting requires a reason', !!noReason.error);
  const { data: list, error: listErr } = await rpcFor(ADMIN)('admin_list_payment_submissions', { p_status: 'pending' });
  const listed = (list as Array<{ id: string; organization_name: string; submitter_email: string }> | null)?.find((p) => p.id === payId);
  check('admin queue shows workspace name and submitter email', !listErr && !!listed?.organization_name && !!listed?.submitter_email, listErr?.message);
  const custList = await rpcFor(B)('admin_list_payment_submissions', { p_status: null });
  check('customers cannot list the admin queue', !!custList.error);
  const approve = await rpcFor(ADMIN)('admin_review_payment', { p_payment_id: payId, p_approve: true, p_note: 'E2E verified' });
  check('admin approves', !approve.error && approve.data === 'approved', approve.error?.message);
  const { data: sub } = await B.client.from('organization_subscriptions').select('plan_code, status, renews_at').eq('organization_id', B.orgId).maybeSingle();
  check('approval activates the plan for ~30 days', sub?.status === 'active' && sub.plan_code === 'starter' && new Date(sub.renews_at!).getTime() > Date.now() + 29 * 864e5, sub);
  const { data: usage } = await B.client.from('usage_balances').select('base_video_slots, used_video_slots').eq('organization_id', B.orgId).maybeSingle();
  check('approval sets the plan usage allowance (6 video slots)', usage?.base_video_slots === 6 && usage.used_video_slots === 0, usage);
  const again = await rpcFor(ADMIN)('admin_review_payment', { p_payment_id: payId, p_approve: true, p_note: null });
  check('a payment cannot be reviewed twice', !!again.error && /already reviewed/i.test(again.error.message), again.error?.message ?? 'accepted');
  const { count: audits } = await ADMIN.client.from('platform_audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', payId as string);
  check('submission and approval are audited', (audits ?? 0) >= 2, audits);

  // Payment method administration.
  const custMethod = await rpcFor(B)('admin_update_payment_method', { p_method: 'ccp', p_enabled: false, p_display_name: 'x', p_account_holder: '', p_account_number: '', p_ccp_key: '', p_redotpay_uid: '', p_instructions: '' });
  check('customers cannot edit payment methods', !!custMethod.error);
  const disabled = await submit(B, B.orgId, { p_method: 'redotpay' });
  check('disabled payment methods are refused', !!disabled.error && /unavailable/i.test(disabled.error.message), disabled.error?.message ?? 'accepted');
}

async function finish(client?: SupabaseClient, created: string[] = [], rpc?: (fn: string, a: object) => Promise<{ error: unknown }>) {
  if (client && rpc && created.length) {
    let cleaned = 0;
    for (const pid of created) if (!(await rpc('delete_studio_project', { p_project_id: pid })).error) cleaned++;
    console.log(`\nCleanup: deleted ${cleaned}/${created.length} E2E projects${cleaned < created.length ? ' (remaining ones need the lifecycle migration or manual removal)' : ''}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
