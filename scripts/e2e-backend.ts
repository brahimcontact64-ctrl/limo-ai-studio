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
import { toRpcArgs, toRpcArgsV2 } from '../lib/studio/validation.ts';
import { emptyProject, newScene, projectFromDb, toSaveRequest, type DbSceneRow } from '../lib/studio/draft.ts';
import type { ProjectDraft } from '../lib/studio/types.ts';
import { totp } from './lib/totp.ts';
import { normalizeBible, normalizeCheckpoint } from '../lib/story/bible.ts';
import { buildContinueDraft } from '../lib/story/continue.ts';
import { EMPTY_CHECKPOINT, type CharacterState, type EpisodeCheckpoint, type StoryBible } from '../lib/story/types.ts';

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
    creation_mode: 'story',
    creation_brief: {},
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
  // V1 policy: a 40 s draft is saved as it is (only approval/export are limited to 30 s); one credit per video.
  check('status draft, 40 s draft saved (not truncated), 1 credit per video', row?.status === 'draft' && row?.total_duration_seconds === 40 && row?.estimated_slots === 1, row);

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

  await creationChecks(A, B, draft.content_type);
  await scriptChecks(A, B, draft.content_type);
  await customCharacterChecks(A, B, draft.content_type);
  await storyChecks(A, B, draft.content_type);
  await imageChecks(A, B);

  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) {
    const ADMIN = await signIn(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
    await mfaChecks(ADMIN);
    await paymentChecks(A, B, ADMIN);
    await adminHardeningChecks(A, B, ADMIN);
    await canonicalReferenceChecks(A, ADMIN);
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
  check('admin lists the newest workspaces (at most 500)', !probe.error && rows.length > 0 && rows.length <= 500, probe.error?.message);
  const aEmail = (await A.client.auth.getUser()).data.user?.email ?? '';
  const found = await rpcFor(ADMIN)('admin_list_workspaces', { p_search: aEmail });
  const fRows = (found.data as Array<{ id: string; owner_email: string | null }> | null) ?? [];
  check('admin finds any workspace by owner email (search), with the owner email', !found.error && fRows.some((r) => r.id === A.orgId && r.owner_email === aEmail), found.error?.message);
  const byId = await rpcFor(ADMIN)('admin_list_workspaces', { p_search: A.orgId.slice(0, 8) });
  check('admin finds a workspace by the start of its id', ((byId.data as Array<{ id: string }> | null) ?? []).some((r) => r.id === A.orgId));
  const wild = await rpcFor(ADMIN)('admin_list_workspaces', { p_search: '%' });
  check('search treats % as a literal character (no match-all)', !wild.error && ((wild.data as unknown[] | null) ?? []).length < rows.length, [wild.error?.message, (wild.data as unknown[] | null)?.length, rows.length]);
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

/** Universal creation: assets, character-free projects, brand kit (migration 20261017100000). */
async function creationChecks(A: Session, B: Session, contentType: string) {
  console.log('\nUniversal creation (migration 20261017100000)');
  const probe = await rpcFor(B)('delete_media_asset', { p_asset_id: '00000000-0000-4000-8000-000000000000' });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  universal creation functions not deployed');
    return;
  }

  // Upload + register a product photo in A's workspace.
  const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });
  const path = `${A.orgId}/${crypto.randomUUID()}.png`;
  const up = await A.client.storage.from('workspace-assets').upload(path, png, { contentType: 'image/png' });
  check('owner uploads into its workspace asset folder', !up.error, up.error?.message);
  const foreign = await A.client.storage.from('workspace-assets').upload(`${B.orgId}/${crypto.randomUUID()}.png`, png, { contentType: 'image/png' });
  check('cannot upload into another workspace asset folder', !!foreign.error);
  const bRead = await B.client.storage.from('workspace-assets').download(path);
  check('another workspace cannot read the asset file', !!bRead.error);
  const reg = await rpcFor(A)('register_media_asset', { p_organization_id: A.orgId, p_object_path: path, p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: png.size, p_file_name: 'e2e.png' });
  check('register the uploaded asset', !reg.error && typeof reg.data === 'string', reg.error?.message);
  const assetId = reg.data as string;
  const bReg = await rpcFor(B)('register_media_asset', { p_organization_id: B.orgId, p_object_path: path, p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: png.size, p_file_name: 'steal.png' });
  check('cannot register another workspace’s file', !!bReg.error);
  const { data: bAssets } = await B.client.from('media_assets').select('id').eq('id', assetId);
  check('another workspace cannot list the asset', (bAssets ?? []).length === 0);

  // Character-free product ad using the asset.
  const ad = emptyProject({ content_type: contentType, language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'E2E Serum', price: '2 400 DA', sellingPoints: ['Vitamin C'] }, export_presets: ['vertical_9_16'] });
  ad.title = 'E2E product ad';
  ad.scenes = [newScene({ title: 'Hook', duration_seconds: 4, narration: 'Meet E2E Serum.', asset_ids: [assetId] }), newScene({ title: 'Offer', duration_seconds: 5 })];
  const save = await rpcFor(A)('save_studio_project_v2', toRpcArgsV2(A.orgId, toSaveRequest(ad)));
  check('product ad saves with no characters', !save.error && typeof save.data === 'string', save.error?.message);
  const adId = save.data as string;
  const { data: row } = await A.client.from('studio_projects').select('creation_mode, creation_brief, project_cast').eq('id', adId).single();
  check('mode, brief and empty cast persist', row?.creation_mode === 'product_ad' && (row?.creation_brief as { productName?: string })?.productName === 'E2E Serum' && JSON.stringify(row?.project_cast) === '[]', row);
  const { data: sc } = await A.client.from('project_scenes').select('narration, asset_ids').eq('project_id', adId).order('scene_number');
  check('scene narration and assets persist', sc?.[0]?.narration === 'Meet E2E Serum.' && JSON.stringify(sc?.[0]?.asset_ids) === JSON.stringify([assetId]), sc);

  const story = emptyProject({ content_type: contentType, language_code: 'en', creation_mode: 'story' });
  story.title = 'E2E story without cast';
  story.scenes = [newScene({ title: 'Opening', duration_seconds: 5 })];
  const storySave = await rpcFor(A)('save_studio_project_v2', toRpcArgsV2(A.orgId, toSaveRequest(story)));
  check('story mode still requires characters', !!storySave.error && /characters/i.test(storySave.error.message), storySave.error?.message ?? 'accepted');

  const bAd = { ...ad, title: 'E2E foreign asset' };
  const bSave = await rpcFor(B)('save_studio_project_v2', toRpcArgsV2(B.orgId, toSaveRequest(bAd)));
  check('another workspace cannot use the asset in a scene', !!bSave.error && /does not belong/i.test(bSave.error.message), bSave.error?.message ?? 'accepted');

  const inUse = await rpcFor(A)('delete_media_asset', { p_asset_id: assetId });
  check('asset used by a scene cannot be deleted', !!inUse.error && /used by a project scene/i.test(inUse.error.message), inUse.error?.message ?? 'accepted');
  const bDel = await rpcFor(B)('delete_media_asset', { p_asset_id: assetId });
  check('another workspace cannot delete the asset', !!bDel.error);

  // Brand kit.
  const kit = await rpcFor(A)('save_brand_kit', { p_organization_id: A.orgId, p_kit: { brand_name: 'E2E Brand', primary_color: '#123456', logo_asset_id: assetId } });
  check('owner saves a brand kit with its own logo', !kit.error, kit.error?.message);
  const bKit = await rpcFor(B)('save_brand_kit', { p_organization_id: B.orgId, p_kit: { brand_name: 'X', logo_asset_id: assetId } });
  check('brand kit refuses another workspace’s logo', !!bKit.error);

  // Cleanup: project first, then the asset can go.
  await rpcFor(A)('delete_studio_project', { p_project_id: adId });
  const del = await rpcFor(A)('delete_media_asset', { p_asset_id: assetId });
  check('unused asset can be deleted', !del.error, del.error?.message);
  await A.client.storage.from('workspace-assets').remove([path]);
}

/** Script revisions, concurrency, approval (migration 20261017120000). */
async function scriptChecks(A: Session, B: Session, contentType: string) {
  console.log('\nScript revisions and approval (migration 20261017120000)');
  const probe = await rpcFor(B)('remove_script_approval', { p_project_id: '00000000-0000-4000-8000-000000000000' });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  script revision functions not deployed');
    return;
  }
  type Saved = { project_id: string; updated_at: string; script_status: string; revision_number: number };
  type Rev = { id: string; revision_number: number; source: string; label: string | null; snapshot: { scenes: Array<{ narration: string }> } };
  const revisions = (s: Session, projectId: string) =>
    (s.client.from('project_revisions' as never) as unknown as { select: (c: string) => { eq: (k: string, v: string) => { order: (k: string) => Promise<{ data: Rev[] | null }> } } })
      .select('id, revision_number, source, label, snapshot')
      .eq('project_id', projectId)
      .order('revision_number');

  const ad = emptyProject({ content_type: contentType, language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'E2E Lamp' }, export_presets: ['vertical_9_16'] });
  ad.title = 'E2E script revisions';
  ad.scenes = [newScene({ title: 'Hook', duration_seconds: 4, narration: 'Version one.' }), newScene({ title: 'End', duration_seconds: 5, narration: 'Order now.' })];
  const v3 = (s: Session, d: ProjectDraft, base: string | null, extra: object = {}) =>
    rpcFor(s)('save_studio_project_v3', { ...toRpcArgsV2(s.orgId, toSaveRequest(d)), p_base_updated_at: base, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false, ...extra });

  const created = await v3(A, ad, null);
  const c = created.data as Saved | null;
  check('v3 creates a character-free project with revision 1', !created.error && c?.revision_number === 1, created.error?.message);
  if (!c) return;
  const id = c.project_id;
  const edit1: ProjectDraft = { ...ad, id, scenes: [{ ...ad.scenes[0]!, narration: 'Version two.' }, ad.scenes[1]!] };
  const stale = await v3(A, edit1, '2000-01-01T00:00:00Z');
  check('a save based on an old version is refused (conflict)', !!stale.error && /changed since it was loaded/i.test(stale.error.message), stale.error?.message ?? 'accepted');
  const saved2 = await v3(A, edit1, c.updated_at);
  const r2 = saved2.data as Saved;
  check('a save based on the current version creates revision 2', !saved2.error && r2?.revision_number === 2, saved2.error?.message);

  const withNarration = (text: string): ProjectDraft => ({ ...edit1, scenes: [{ ...edit1.scenes[0]!, narration: text }, edit1.scenes[1]!] });
  const auto1 = await v3(A, withNarration('Auto A.'), r2.updated_at, { p_revision_source: 'autosave' });
  const a1 = auto1.data as Saved;
  const auto2 = await v3(A, withNarration('Auto B.'), a1?.updated_at ?? null, { p_revision_source: 'autosave' });
  const a2 = auto2.data as Saved;
  check('consecutive autosaves update one revision', !auto1.error && !auto2.error && a1?.revision_number === 3 && a2?.revision_number === 3, auto2.error?.message ?? [a1?.revision_number, a2?.revision_number]);

  const list = (await revisions(A, id)).data ?? [];
  check('history keeps created, manual and autosave revisions', list.map((r) => r.source).join(',') === 'created,manual,autosave', list.map((r) => r.source));
  check('revision snapshots hold the saved text', list[1]?.snapshot.scenes[0]?.narration === 'Version two.' && list[2]?.snapshot.scenes[0]?.narration === 'Auto B.');
  const bList = (await revisions(B, id)).data ?? [];
  check('another workspace cannot read the revisions', bList.length === 0);
  const rev2 = list.find((r) => r.revision_number === 2);
  const bRestore = await rpcFor(B)('restore_project_revision', { p_revision_id: rev2?.id, p_base_updated_at: a2.updated_at, p_remove_approval: false });
  check('another workspace cannot restore a revision', !!bRestore.error);
  const bApprove = await rpcFor(B)('approve_project_script', { p_project_id: id, p_base_updated_at: a2.updated_at });
  check('another workspace cannot approve the script', !!bApprove.error);

  const approve = await rpcFor(A)('approve_project_script', { p_project_id: id, p_base_updated_at: a2.updated_at });
  const ap = approve.data as { revision_number: number; updated_at: string } | null;
  check('owner approves the script (approval revision 4)', !approve.error && ap?.revision_number === 4, approve.error?.message);
  const { data: proj } = await A.client.from('studio_projects').select('*').eq('id', id).single();
  const p = proj as unknown as { script_status: string; approved_revision_id: string | null } | null;
  check('project records the approved revision', p?.script_status === 'approved' && !!p.approved_revision_id, p);

  const v2Overwrite = await rpcFor(A)('save_studio_project_v2', toRpcArgsV2(A.orgId, toSaveRequest({ ...edit1, title: 'Silent overwrite' })));
  check('approved script cannot be overwritten through save_studio_project_v2', !!v2Overwrite.error && /approved/i.test(v2Overwrite.error.message), v2Overwrite.error?.message ?? 'accepted');
  const v3NoFlag = await v3(A, { ...edit1, title: 'Edit without removing approval' }, ap?.updated_at ?? null);
  check('approved script cannot be edited without removing the approval', !!v3NoFlag.error && /approved/i.test(v3NoFlag.error.message), v3NoFlag.error?.message ?? 'accepted');
  const { data: stillApproved } = await A.client.from('project_scenes').select('narration').eq('project_id', id).order('scene_number');
  check('approved content unchanged after refused writes', (stillApproved as Array<{ narration: string }> | null)?.[0]?.narration === 'Auto B.', stillApproved);

  const removed = await rpcFor(A)('remove_script_approval', { p_project_id: id });
  const rm = removed.data as { script_status: string; updated_at: string } | null;
  check('removing the approval marks the script as changed', !removed.error && rm?.script_status === 'changed', removed.error?.message);
  const restore = await rpcFor(A)('restore_project_revision', { p_revision_id: rev2?.id, p_base_updated_at: rm?.updated_at, p_remove_approval: false });
  const rs = restore.data as { revision_number: number } | null;
  const { data: after } = await A.client.from('project_scenes').select('narration').eq('project_id', id).order('scene_number');
  check('restoring revision 2 brings its text back as revision 5', !restore.error && rs?.revision_number === 5 && (after as Array<{ narration: string }> | null)?.[0]?.narration === 'Version two.', restore.error?.message ?? after);
  const last = ((await revisions(A, id)).data ?? []).find((r) => r.revision_number === 5);
  check('the restore is recorded in the history', last?.source === 'restore', last?.source);

  // An approved project can still be deleted (its scenes and revisions go with it).
  const { data: cur } = await A.client.from('studio_projects').select('updated_at').eq('id', id).single();
  await rpcFor(A)('approve_project_script', { p_project_id: id, p_base_updated_at: cur?.updated_at });
  const del = await rpcFor(A)('delete_studio_project', { p_project_id: id });
  check('an approved project can be deleted with its scenes and revisions', !del.error, del.error?.message);
}

/** 1×1 PNG used only as a local test fixture (never real character artwork). */
const FIXTURE_PNG = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });
const FULL_CHECKLIST = { identity_matches_spec: true, proportions_match: true, palette_matches: true, family_friendly: true, view_correct: true, no_text_or_watermark: true };

/** Workspace characters (migration 20261017140000): isolation, references, use in a project cast. */
async function customCharacterChecks(A: Session, B: Session, contentType: string) {
  console.log('\nWorkspace characters (migration 20261017140000)');
  const probe = await rpcFor(B)('archive_custom_character', { p_character_id: '00000000-0000-4000-8000-000000000000' });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  character functions not deployed');
    return;
  }
  const { data: specs } = await A.client.from('character_design_specs' as never).select('character_id, version, status');
  const specRows = (specs ?? []) as Array<{ character_id: string; status: string }>;
  check('18 canonical design specs are readable', new Set(specRows.map((s) => s.character_id)).size === 18, specRows.length);
  check('no design spec is approved by the migration', specRows.every((s) => s.status !== 'approved'));
  const { data: cat } = await A.client.from('character_catalog').select('id, reference_status').not('family_code', 'is', null);
  check('no canonical character is marked approved without review', (cat ?? []).every((c) => c.reference_status !== 'approved'), cat);

  const spec = { identity_prompt: 'E2E Mascot: test character', personality: 'calm' };
  const created = await rpcFor(A)('save_custom_character', { p_organization_id: A.orgId, p_character_id: null, p_name: 'E2E Mascot', p_description: 'Round blue mascot', p_base_family: null, p_age_group: 'adult', p_gender_code: 'unspecified', p_spec: spec });
  check('owner creates a workspace character', !created.error && typeof created.data === 'string', created.error?.message);
  const charId = created.data as string;
  const { data: bSees } = await B.client.from('characters').select('id').eq('id', charId);
  check('another workspace cannot see the character', (bSees ?? []).length === 0);
  const bCreate = await rpcFor(B)('save_custom_character', { p_organization_id: A.orgId, p_character_id: null, p_name: 'Intruder', p_description: '', p_base_family: null, p_age_group: null, p_gender_code: null, p_spec: {} });
  check('another workspace cannot create characters in this workspace', !!bCreate.error);
  const direct = await A.client.from('characters').update({ reference_status: 'approved' } as never).eq('id', charId).select('id');
  check('reference status cannot be set directly', !!direct.error || (direct.data ?? []).length === 0, direct.error?.message);

  const path = `${A.orgId}/custom/${charId}/v1/${crypto.randomUUID()}.png`;
  const up = await A.client.storage.from('character-library').upload(path, FIXTURE_PNG(), { contentType: 'image/png' });
  check('owner uploads a reference into its own character folder', !up.error, up.error?.message);
  const bUp = await B.client.storage.from('character-library').upload(`${A.orgId}/custom/${charId}/v1/${crypto.randomUUID()}.png`, FIXTURE_PNG(), { contentType: 'image/png' });
  check('another workspace cannot upload into that folder', !!bUp.error);
  const bRead = await B.client.storage.from('character-library').download(path);
  check('another workspace cannot read the reference file', !!bRead.error);
  const reg = (extra: object) =>
    rpcFor(A)('register_character_reference', {
      p_catalog_character_id: null, p_custom_character_id: charId, p_object_path: path, p_asset_kind: 'rendered_reference', p_view: 'front',
      p_expression_key: null, p_outfit_key: null, p_mime_type: 'image/png', p_size_bytes: 68, p_width: 1, p_height: 1,
      p_provenance: 'uploaded_artwork', p_provenance_note: 'E2E test fixture, not artwork', p_model_meta: {}, ...extra,
    });
  const asModel = await reg({ p_asset_kind: 'rigged_model', p_view: null });
  check('an image cannot be registered as a rigged 3D model', !!asModel.error, asModel.error?.message ?? 'accepted');
  const ref = await reg({});
  check('owner registers the reference (pending review)', !ref.error && typeof ref.data === 'string', ref.error?.message);
  const refId = ref.data as string;
  const bReview = await rpcFor(B)('record_character_reference_view', { p_asset_id: refId });
  check('another workspace cannot review it', !!bReview.error);
  const early = await rpcFor(A)('review_character_reference', { p_asset_id: refId, p_approve: true, p_note: null, p_checklist: FULL_CHECKLIST });
  check('approval without opening the file is refused', !!early.error && /open the reference/i.test(early.error.message), early.error?.message ?? 'accepted');
  await rpcFor(A)('record_character_reference_view', { p_asset_id: refId });
  const partial = await rpcFor(A)('review_character_reference', { p_asset_id: refId, p_approve: true, p_note: null, p_checklist: { ...FULL_CHECKLIST, palette_matches: false } });
  check('approval with an incomplete checklist is refused', !!partial.error && /checklist incomplete/i.test(partial.error.message), partial.error?.message ?? 'accepted');
  const approved = await rpcFor(A)('review_character_reference', { p_asset_id: refId, p_approve: true, p_note: 'E2E', p_checklist: FULL_CHECKLIST });
  check('one approved view does not make the character ready (front only)', !approved.error && approved.data === 'pending', approved.error?.message ?? approved.data);

  // The workspace character can be cast in a project of its own workspace only.
  const story = emptyProject({ content_type: contentType, language_code: 'en', creation_mode: 'story' });
  story.title = 'E2E custom cast';
  story.cast = [`custom:${charId}`];
  story.scenes = [newScene({ title: 'Hello', duration_seconds: 4, participants: [`custom:${charId}`] })];
  const own = await rpcFor(A)('save_studio_project_v2', toRpcArgsV2(A.orgId, toSaveRequest(story)));
  check('a workspace character can be cast in its own workspace', !own.error && typeof own.data === 'string', own.error?.message);
  const foreign = await rpcFor(B)('save_studio_project_v2', toRpcArgsV2(B.orgId, toSaveRequest(story)));
  check('another workspace cannot cast it', !!foreign.error && /unavailable/i.test(foreign.error.message), foreign.error?.message ?? 'accepted');

  await rpcFor(A)('delete_studio_project', { p_project_id: own.data });
  const archived = await rpcFor(A)('archive_custom_character', { p_character_id: charId });
  check('the character can be archived', !archived.error, archived.error?.message);
}

/** Canonical references: platform admins with two-factor only, approval needs viewing + checklist. */
async function canonicalReferenceChecks(A: Session, ADMIN: Session) {
  console.log('\nCanonical references (migration 20261017140000)');
  const path = `canonical/limo_boy/v1/${crypto.randomUUID()}.png`;
  const customerUp = await A.client.storage.from('character-library').upload(`canonical/limo_boy/v1/${crypto.randomUUID()}.png`, FIXTURE_PNG(), { contentType: 'image/png' });
  check('customers cannot upload canonical references', !!customerUp.error);
  const up = await ADMIN.client.storage.from('character-library').upload(path, FIXTURE_PNG(), { contentType: 'image/png' });
  if (up.error && /bucket not found/i.test(up.error.message)) {
    console.log('  SKIP  character-library bucket missing');
    return;
  }
  check('admin (two-factor) uploads a canonical reference file', !up.error, up.error?.message);
  const reg = await rpcFor(ADMIN)('register_character_reference', {
    p_catalog_character_id: 'limo_boy', p_custom_character_id: null, p_object_path: path, p_asset_kind: 'rendered_reference', p_view: 'side',
    p_expression_key: null, p_outfit_key: null, p_mime_type: 'image/png', p_size_bytes: 68, p_width: 1, p_height: 1,
    p_provenance: 'uploaded_artwork', p_provenance_note: 'E2E test fixture, not artwork', p_model_meta: {},
  });
  check('admin registers it as pending review', !reg.error && typeof reg.data === 'string', reg.error?.message);
  const refId = reg.data as string;
  const customerReg = await rpcFor(A)('register_character_reference', {
    p_catalog_character_id: 'limo_boy', p_custom_character_id: null, p_object_path: path, p_asset_kind: 'rendered_reference', p_view: 'side',
    p_expression_key: null, p_outfit_key: null, p_mime_type: 'image/png', p_size_bytes: 68, p_width: 1, p_height: 1, p_provenance: 'uploaded_artwork', p_provenance_note: null, p_model_meta: {},
  });
  check('customers cannot register canonical references', !!customerReg.error);
  const { data: hidden } = await A.client.from('character_reference_assets' as never).select('id').eq('id', refId);
  check('customers cannot see a pending canonical reference', ((hidden ?? []) as unknown[]).length === 0);
  check('customers cannot download a pending canonical file', !!(await A.client.storage.from('character-library').download(path)).error);
  const customerReview = await rpcFor(A)('record_character_reference_view', { p_asset_id: refId });
  check('customers cannot review canonical references', !!customerReview.error);
  await rpcFor(ADMIN)('record_character_reference_view', { p_asset_id: refId });
  const approve = await rpcFor(ADMIN)('review_character_reference', { p_asset_id: refId, p_approve: true, p_note: null, p_checklist: FULL_CHECKLIST });
  check('admin approves after viewing with a full checklist', !approve.error, approve.error?.message);
  const { data: visible } = await A.client.from('character_reference_assets' as never).select('id').eq('id', refId);
  check('customers can see the approved canonical reference', ((visible ?? []) as unknown[]).length === 1);
  check('customers can download the approved canonical file', !(await A.client.storage.from('character-library').download(path)).error);
  const { data: boy } = await A.client.from('character_catalog').select('reference_status').eq('id', 'limo_boy').single();
  check('the character is still not approved (spec unapproved, one of three views)', boy?.reference_status !== 'approved', boy);
  const retire = await rpcFor(ADMIN)('retire_character_reference', { p_asset_id: refId, p_note: 'E2E cleanup of a test fixture' });
  check('the test fixture is retired again', !retire.error, retire.error?.message);
  const { data: after } = await A.client.from('character_reference_assets' as never).select('id').eq('id', refId);
  check('a retired reference is no longer visible to customers', ((after ?? []) as unknown[]).length === 0);
}

/** Story Engine (migration 20261017160000): three episodes, continuation, revision, review, isolation. */
async function storyChecks(A: Session, B: Session, contentType: string) {
  console.log('\nStory Engine (migration 20261017160000)');
  const probe = await rpcFor(B)('resolve_episode_review', { p_episode_id: '00000000-0000-4000-8000-000000000000', p_note: 'probe' });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  story functions not deployed');
    return;
  }
  const db = (s: Session) => s.client as unknown as { from: (t: string) => any };
  const bible: StoryBible = normalizeBible({
    premise: 'E2E market mystery', genre: 'Comedy', tone: 'warm',
    characters: [
      { ref: 'limo_boy', name: 'Limo', role: 'kid' },
      { ref: 'nova_elder_woman', name: 'Grandma Nova', role: 'stall owner' },
      { ref: 'adam_man', name: 'Adam', role: 'neighbour' },
    ],
    relationships: [{ a: 'limo_boy', b: 'nova_elder_woman', kind: 'grandson' }],
    locations: [{ key: 'market', name: 'Market' }, { key: 'kitchen', name: 'Kitchen' }],
    world_rules: [{ id: 'no-magic', text: 'magic', kind: 'forbidden' }],
    arcs: [{ id: 'lost-key', title: 'The lost key', status: 'open', opened_in: 1 }],
  });

  // Series + isolation.
  const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
  const anonCreate = await (anon.rpc.bind(anon) as unknown as Rpc)('create_story_series', { p_organization_id: A.orgId, p_title: 'x', p_language_code: 'en', p_continuity_mode: 'strict', p_bible: bible });
  check('anonymous users cannot create a series', !!anonCreate.error);
  const bCreate = await rpcFor(B)('create_story_series', { p_organization_id: A.orgId, p_title: 'Intruder', p_language_code: 'en', p_continuity_mode: 'strict', p_bible: bible });
  check('another workspace cannot create a series here', !!bCreate.error);
  const badRef = await rpcFor(A)('create_story_series', { p_organization_id: A.orgId, p_title: 'Bad', p_language_code: 'en', p_continuity_mode: 'strict', p_bible: { ...bible, characters: [{ ref: 'not_real', name: 'x' }] } });
  check('a series cannot use unknown characters', !!badRef.error && /unknown character/i.test(badRef.error.message), badRef.error?.message ?? 'accepted');
  const created = await rpcFor(A)('create_story_series', { p_organization_id: A.orgId, p_title: 'E2E Market Mystery', p_language_code: 'en', p_continuity_mode: 'strict', p_bible: bible });
  check('owner creates a series with Story Bible v1', !created.error && typeof created.data === 'string', created.error?.message);
  const seriesId = created.data as string;
  const { data: bSeries } = await db(B).from('content_series').select('id').eq('id', seriesId);
  check('another workspace cannot read the series', (bSeries ?? []).length === 0);
  const { data: bBible } = await db(B).from('story_bible_versions').select('version').eq('series_id', seriesId);
  check('another workspace cannot read the Story Bible', (bBible ?? []).length === 0);
  const direct = await db(A).from('content_series').update({ title: 'direct write' }).eq('id', seriesId).select('id');
  check('series cannot be written directly (functions only)', !!direct.error || (direct.data ?? []).length === 0);

  const stale = await rpcFor(A)('save_story_bible', { p_series_id: seriesId, p_base_version: 0, p_bible: bible, p_note: null });
  check('a Story Bible save based on an old version is refused', !!stale.error && /changed since/i.test(stale.error.message), stale.error?.message ?? 'accepted');
  const v2 = await rpcFor(A)('save_story_bible', { p_series_id: seriesId, p_base_version: 1, p_bible: { ...bible, tone: 'warm and funny' }, p_note: 'tone' });
  check('a canon change creates version 2', !v2.error && v2.data === 2, v2.error?.message ?? v2.data);
  let bibleVersion = 2;

  type Ep = { episode_id: string; project_id: string; episode_number: number };
  const create = (basedOn: string | null, fp: string | null, draft: ReturnType<typeof buildContinueDraft>, who: Session = A) => {
    const p = emptyProject({ content_type: contentType, language_code: 'en', creation_mode: 'story', export_presets: ['vertical_9_16'] });
    p.title = draft.title;
    p.cast = draft.cast;
    p.scenes = draft.scenes;
    const args = toRpcArgsV2(A.orgId, toSaveRequest(p));
    return rpcFor(who)('create_story_episode', {
      p_series_id: seriesId, p_season_id: null, p_based_on_episode_id: basedOn, p_based_on_fingerprint: fp, p_title: draft.title,
      p_content_type: contentType, p_project_cast: args.p_project_cast, p_scenes: args.p_scenes, p_export_presets: args.p_export_presets,
    });
  };
  const epRow = async (id: string) => (await db(A).from('content_episodes').select('*').eq('id', id).single()).data as Record<string, any>;
  const approveScript = async (projectId: string) => {
    const { data: p } = await A.client.from('studio_projects').select('updated_at').eq('id', projectId).single();
    return rpcFor(A)('approve_project_script', { p_project_id: projectId, p_base_updated_at: p?.updated_at });
  };
  const saveEnding = async (episodeId: string, cp: EpisodeCheckpoint) => {
    const row = await epRow(episodeId);
    return rpcFor(A)('save_episode_checkpoint', { p_episode_id: episodeId, p_checkpoint: cp, p_base_updated_at: row.checkpoint_updated_at });
  };
  const state = (ref: string, present: boolean, loc: string, emo = '', phys = '', goal = ''): CharacterState => ({ ref, present, location_key: loc, emotional_state: emo, physical_state: phys, current_goal: goal });

  // Episode 1.
  const d1 = buildContinueDraft(bible, null, 1);
  const e1r = await create(null, null, d1);
  check('episode 1 is created from the Story Bible', !e1r.error && (e1r.data as Ep)?.episode_number === 1, e1r.error?.message);
  const e1 = e1r.data as Ep;
  const bEp = await create(null, null, d1, B);
  check('another workspace cannot add episodes', !!bEp.error);
  const again = await create(null, null, d1);
  check('a second "episode 1" is refused (continue from the latest)', !!again.error && /latest episode/i.test(again.error.message), again.error?.message ?? 'accepted');
  const early = await create(e1.episode_id, null, buildContinueDraft(bible, null, 2));
  check('continuing before episode 1 is approved is refused', !!early.error && /approve episode 1 first/i.test(early.error.message), early.error?.message ?? 'accepted');
  const noEnding = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('an episode without an ending cannot be approved', !!noEnding.error && /ending first/i.test(noEnding.error.message), noEnding.error?.message ?? 'accepted');

  const cp1: EpisodeCheckpoint = {
    ...EMPTY_CHECKPOINT, summary: 'Limo and Grandma search the market; a map turns up.', ending_hook: 'Grandma finds a map in the kitchen.', location_key: 'kitchen', time_label: 'Monday evening',
    characters: [state('limo_boy', true, 'kitchen', 'excited', 'scraped knee', 'read the map'), state('nova_elder_woman', true, 'kitchen', 'worried'), state('adam_man', false, 'market', 'annoyed')],
    events: [{ text: 'The stall key goes missing', characters: ['nova_elder_woman'], scenes: [1] }, { text: 'Grandma finds a map', characters: ['nova_elder_woman', 'limo_boy'], scenes: [d1.scenes.length] }],
    arcs_progressed: ['lost-key'], arcs_opened: [{ id: 'the-map', title: 'The map', description: 'Who drew it?' }],
  };
  const staleEnding = await rpcFor(A)('save_episode_checkpoint', { p_episode_id: e1.episode_id, p_checkpoint: cp1, p_base_updated_at: '2000-01-01T00:00:00Z' });
  check('an ending save based on an old version is refused', !!staleEnding.error && /changed since/i.test(staleEnding.error.message), staleEnding.error?.message ?? 'accepted');
  check('the owner saves the ending of episode 1', !(await saveEnding(e1.episode_id, { ...cp1, characters: [...cp1.characters, state('nova_boy', true, 'kitchen')] })).error);
  const noScript = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('an episode cannot be approved before its script', !!noScript.error && /script first/i.test(noScript.error.message), noScript.error?.message ?? 'accepted');
  check('the episode script is approved (Milestone 3)', !(await approveScript(e1.project_id)).error);
  // Video export (migration 20261017200000): an episode exports only when approved and reviewed.
  const render = (projectId: string) =>
    rpcFor(A)('enqueue_render_job', { p_project_id: projectId, p_idempotency_key: `e2e-ep-${crypto.randomUUID()}`, p_aspect: '9:16', p_resolution: 480, p_quality: 'draft', p_settings: {} });
  const renderReady = !(await render(e1.project_id)).error?.message.match(/could not find the function/i);
  if (renderReady) {
    const early = await render(e1.project_id);
    check('video: an episode whose script is approved but whose ending is not cannot be exported', !!early.error && /approve the episode/i.test(early.error.message), early.error?.message ?? 'accepted');
  }
  const outsider = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('an ending with a character outside the canon is refused', !!outsider.error && /outside the canon/i.test(outsider.error.message), outsider.error?.message ?? 'accepted');
  await saveEnding(e1.episode_id, { ...cp1, events: [...cp1.events, { text: 'Invented earlier event', characters: [], scenes: [99] }] });
  const invented = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('an event that is not in this episode’s scenes is refused', !!invented.error && /scene of this episode/i.test(invented.error.message), invented.error?.message ?? 'accepted');
  await saveEnding(e1.episode_id, cp1);
  const bApprove = await rpcFor(B)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('another workspace cannot approve an episode', !!bApprove.error);
  const a1 = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('episode 1 is approved', !a1.error, a1.error?.message);
  bibleVersion = (a1.data as { bible_version: number }).bible_version;
  check('the new thread from episode 1 becomes canon (new bible version)', bibleVersion === 3);
  const { data: ev1 } = await db(A).from('story_events').select('text').eq('episode_id', e1.episode_id);
  check('the timeline holds exactly the approved events of episode 1', (ev1 ?? []).length === 2);
  const { data: bEv } = await db(B).from('story_events').select('id').eq('series_id', seriesId);
  check('another workspace cannot read the timeline', (bEv ?? []).length === 0);

  // Episode 2: continues from the exact approved ending.
  const r1 = await epRow(e1.episode_id);
  const bibleV3 = normalizeBible((await db(A).from('story_bible_versions').select('bible').eq('series_id', seriesId).eq('version', 3).single()).data.bible);
  const d2 = buildContinueDraft(bibleV3, { number: 1, checkpoint: normalizeCheckpoint(r1.approved_checkpoint) }, 2);
  const wrongFp = await create(e1.episode_id, 'not-the-fingerprint', d2);
  check('continuing from a different ending fingerprint is refused', !!wrongFp.error && /previous ending changed/i.test(wrongFp.error.message), wrongFp.error?.message ?? 'accepted');
  const e2r = await create(e1.episode_id, r1.checkpoint_fingerprint, d2);
  check('episode 2 continues from the approved ending of episode 1', !e2r.error && (e2r.data as Ep)?.episode_number === 2, e2r.error?.message);
  const e2 = e2r.data as Ep;
  const { data: s2 } = await A.client.from('project_scenes').select('narration, location_prompt, participants, continuity_notes').eq('project_id', e2.project_id).order('scene_number');
  const first2 = (s2 ?? [])[0] as { narration: string; location_prompt: string; participants: string[]; continuity_notes: string } | undefined;
  check('episode 2 opens with episode 1’s ending hook, place and present characters', first2?.narration === cp1.ending_hook && (first2.location_prompt ?? '').startsWith('Kitchen') && JSON.stringify(first2.participants) === '["limo_boy","nova_elder_woman"]', first2);
  check('episode 2 carries the character states forward', !!first2?.continuity_notes?.includes('scraped knee'));
  const { data: p2 } = await A.client.from('studio_projects').select('project_cast, series_id').eq('id', e2.project_id).single();
  check('episode 2 casts only characters present at the approved ending', JSON.stringify(p2?.project_cast) === '[{"id":"limo_boy"},{"id":"nova_elder_woman"}]' && p2?.series_id === seriesId, p2);
  check('every open thread gets a scene in episode 2', (s2 ?? []).filter((s: { continuity_notes: string | null }) => (s.continuity_notes ?? '').startsWith('Open thread')).length === 2);
  const r2 = await epRow(e2.episode_id);
  check('episode 2 records which ending it started from', r2.based_on_episode_id === e1.episode_id && r2.based_on_fingerprint === r1.checkpoint_fingerprint);

  const cp2: EpisodeCheckpoint = { ...EMPTY_CHECKPOINT, summary: 'The key is found in the map case.', ending_hook: 'Adam knocks on the door.', location_key: 'kitchen',
    characters: [state('limo_boy', true, 'kitchen', 'proud', 'scraped knee'), state('nova_elder_woman', true, 'kitchen', 'relieved')],
    events: [{ text: 'Limo finds the key', characters: ['limo_boy'], scenes: [2] }], arcs_resolved: ['lost-key'], arcs_progressed: ['the-map'] };
  await saveEnding(e2.episode_id, cp2);
  await approveScript(e2.project_id);
  const a2 = await rpcFor(A)('approve_story_episode', { p_episode_id: e2.episode_id, p_bible_version: bibleVersion });
  check('episode 2 is approved and resolves "the lost key"', !a2.error, a2.error?.message);
  bibleVersion = (a2.data as { bible_version: number }).bible_version;
  const bibleV4 = normalizeBible((await db(A).from('story_bible_versions').select('bible').eq('series_id', seriesId).eq('version', bibleVersion).single()).data.bible);
  check('the resolved thread is recorded in the canon with its episode', bibleV4.arcs.find((a) => a.id === 'lost-key')?.status === 'resolved' && bibleV4.arcs.find((a) => a.id === 'lost-key')?.resolved_in === 2);

  // Episode 3.
  const r2b = await epRow(e2.episode_id);
  const d3 = buildContinueDraft(bibleV4, { number: 2, checkpoint: normalizeCheckpoint(r2b.approved_checkpoint) }, 3);
  check('resolved threads are not reopened; open ones are kept', d3.scenes.filter((s) => s.title.startsWith('Thread:')).map((s) => s.title).join('|') === 'Thread: The map');
  const e3r = await create(e2.episode_id, r2b.checkpoint_fingerprint, d3);
  const e3 = e3r.data as Ep;
  check('episode 3 continues from episode 2', !e3r.error && e3?.episode_number === 3, e3r.error?.message);
  await saveEnding(e3.episode_id, { ...EMPTY_CHECKPOINT, summary: 'Adam joins the search for the mapmaker.', location_key: 'market', characters: [state('limo_boy', true, 'market'), state('nova_elder_woman', true, 'market')], events: [{ text: 'They return to the market', characters: ['limo_boy'], scenes: [1] }], arcs_progressed: ['the-map'] });
  await approveScript(e3.project_id);
  check('episode 3 is approved', !(await rpcFor(A)('approve_story_episode', { p_episode_id: e3.episode_id, p_bible_version: bibleVersion })).error);

  // Canon protection.
  const removeUsed = await rpcFor(A)('save_story_bible', { p_series_id: seriesId, p_base_version: bibleVersion, p_bible: { ...bibleV4, characters: bibleV4.characters.filter((c) => c.ref !== 'limo_boy') }, p_note: 'remove' });
  check('a character used by approved episodes cannot be removed from the canon', !!removeUsed.error && /appears in approved episodes/i.test(removeUsed.error.message), removeUsed.error?.message ?? 'accepted');

  // Revise episode 1: removing its script approval reopens it and flags episodes 2 and 3.
  const { data: rm } = await rpcFor(A)('remove_script_approval', { p_project_id: e1.project_id });
  check('removing episode 1’s script approval works', !!rm);
  const f1 = await epRow(e1.episode_id);
  const f2 = await epRow(e2.episode_id);
  const f3 = await epRow(e3.episode_id);
  check('episode 1 is reopened automatically', f1.checkpoint_status === 'draft');
  check('episodes 2 and 3 are flagged for review (not rewritten)', f2.review_status === 'needs_review' && f3.review_status === 'needs_review' && f2.checkpoint_status === 'approved' && f3.checkpoint_status === 'approved');
  if (renderReady) {
    const flagged = await render(e2.project_id);
    check('video: an episode flagged for review cannot be exported', !!flagged.error && /needs review/i.test(flagged.error.message), flagged.error?.message ?? 'accepted');
  }
  check('episode 2 is directly affected', f2.review_reasons?.[0]?.impact === 'direct' && f2.review_reasons?.[0]?.episode_number === 1);
  const { data: ev1b } = await db(A).from('story_events').select('id').eq('episode_id', e1.episode_id);
  check('the reopened episode’s events leave the timeline', (ev1b ?? []).length === 0);
  const blocked = await create(e3.episode_id, f3.checkpoint_fingerprint, d3);
  check('the story cannot continue while episode 3 needs review', !!blocked.error && /needs review first/i.test(blocked.error.message), blocked.error?.message ?? 'accepted');

  // Change episode 1's ending: Adam is now present and scared → later episodes get a "changed" reason.
  await saveEnding(e1.episode_id, { ...cp1, characters: [cp1.characters[0]!, cp1.characters[1]!, state('adam_man', true, 'kitchen', 'scared')] });
  await approveScript(e1.project_id);
  const a1b = await rpcFor(A)('approve_story_episode', { p_episode_id: e1.episode_id, p_bible_version: bibleVersion });
  check('the revised episode 1 is approved again', !a1b.error, a1b.error?.message);
  const g3 = await epRow(e3.episode_id);
  const changed = (g3.review_reasons as Array<{ kind: string; characters: string[]; impact: string }>).find((r) => r.kind === 'earlier_episode_changed');
  check('episode 3 lists exactly the changed characters', JSON.stringify(changed?.characters) === '["adam_man"]', changed);
  check('episode 3 is marked downstream (it does not cast the changed character)', changed?.impact === 'downstream', changed);
  const order = await rpcFor(A)('resolve_episode_review', { p_episode_id: e3.episode_id, p_note: 'checked episode 3' });
  check('episode 3 cannot be marked reviewed before episode 2', !!order.error && /earlier episodes first/i.test(order.error.message), order.error?.message ?? 'accepted');
  const shortNote = await rpcFor(A)('resolve_episode_review', { p_episode_id: e2.episode_id, p_note: 'ok' });
  check('a review needs a description of what was checked', !!shortNote.error);
  const bResolve = await rpcFor(B)('resolve_episode_review', { p_episode_id: e2.episode_id, p_note: 'not mine at all' });
  check('another workspace cannot resolve reviews', !!bResolve.error);
  check('episode 2 is reviewed', !(await rpcFor(A)('resolve_episode_review', { p_episode_id: e2.episode_id, p_note: 'Adam’s new presence fits episode 2' })).error);
  check('episode 3 is reviewed', !(await rpcFor(A)('resolve_episode_review', { p_episode_id: e3.episode_id, p_note: 'Episode 3 still fits' })).error);
  if (renderReady) {
    const ok = await render(e3.project_id);
    const jobId = (ok.data as { id?: string } | null)?.id;
    const { data: job } = await db(A).from('render_jobs').select('episode_id, checkpoint_fingerprint, notes, spec').eq('id', jobId ?? '').maybeSingle();
    const { data: ep3 } = await db(A).from('content_episodes').select('checkpoint_fingerprint').eq('id', e3.episode_id).single();
    check('video: an approved, reviewed episode exports with its ending checkpoint fingerprint', !ok.error && job?.episode_id === e3.episode_id && job?.checkpoint_fingerprint === ep3?.checkpoint_fingerprint, ok.error?.message);
    check('video: the export says honestly that characters are not animated and scenes without media are text cards', JSON.stringify(job?.notes) === '["characters_not_animated","text_card_scenes"]', job?.notes);
    if (jobId) await rpcFor(A)('cancel_render_job', { p_job_id: jobId });
  }
  const g3b = await epRow(e3.episode_id);
  check('the review is kept in the episode history', g3b.review_status === 'ok' && (g3b.review_history ?? []).length === 1);

  // Concurrency: two "continue" requests from the same state; only the first succeeds.
  const d4 = buildContinueDraft(bibleV4, { number: 3, checkpoint: normalizeCheckpoint(g3b.approved_checkpoint) }, 4);
  const c1 = await create(e3.episode_id, g3b.checkpoint_fingerprint, d4);
  const c2 = await create(e3.episode_id, g3b.checkpoint_fingerprint, d4);
  check('two concurrent continuations: the second is refused', !c1.error && !!c2.error && /latest episode/i.test(c2.error.message), c2.error?.message ?? 'accepted');

  // Restore an earlier canon version (new version, nothing deleted).
  const { data: cur } = await db(A).from('content_series').select('current_bible_version').eq('id', seriesId).single();
  const restored = await rpcFor(A)('restore_story_bible', { p_series_id: seriesId, p_version: 2, p_base_version: cur?.current_bible_version });
  check('an earlier Story Bible version is restored as a new version', !restored.error && restored.data === (cur?.current_bible_version ?? 0) + 1, restored.error?.message);
}

/** Image Studio and social posts (migration 20261017180000). */
async function imageChecks(A: Session, B: Session) {
  console.log('\nImage Studio and social posts (migration 20261017180000)');
  const probe = await rpcFor(B)('set_social_post_approval', { p_post_id: '00000000-0000-4000-8000-000000000000', p_approve: false, p_base_updated_at: null });
  if (probe.error && /could not find the function/i.test(probe.error.message)) {
    console.log('  SKIP  image functions not deployed');
    return;
  }
  const db = (s: Session) => s.client as unknown as { from: (t: string) => any };
  const uploadPhoto = async (s: Session, folder = '') => {
    const path = `${s.orgId}/${folder}${crypto.randomUUID()}.png`;
    const up = await s.client.storage.from('workspace-assets').upload(path, FIXTURE_PNG(), { contentType: 'image/png' });
    if (up.error) return { path, id: null as string | null, error: up.error.message };
    const reg = await rpcFor(s)('register_media_asset', { p_organization_id: s.orgId, p_object_path: path, p_kind: 'product', p_mime_type: 'image/png', p_size_bytes: 68, p_file_name: 'serum.png', p_width: 1, p_height: 1 });
    return { path, id: reg.data as string | null, error: reg.error?.message };
  };
  const photoA = await uploadPhoto(A);
  const photoB = await uploadPhoto(B);
  check('product photos are uploaded to each workspace library', !!photoA.id && !!photoB.id, photoA.error ?? photoB.error);

  const doc = (photo: string | null, headline = 'Glow Serum', size = { width: 1080, height: 1080 }) => ({
    version: 1, ...size, background: { kind: 'color', color: '#ffffff' }, meta: { generator: 'manual' },
    layers: [
      ...(photo ? [{ id: 'p', name: 'product', type: 'image', x: 100, y: 100, w: 800, h: 700, rotation: 0, opacity: 1, visible: true, locked: false, asset_id: photo, fit: 'contain', crop: null, radius: 0, role: 'product' }] : []),
      { id: 't', name: 'headline', type: 'text', x: 60, y: 840, w: 960, h: 120, rotation: 0, opacity: 1, visible: true, locked: false, content: headline, font: 'Arial', size: 72, weight: 900, italic: false, color: '#211e2b', align: 'center', line_height: 1.2, background: null, padding: 0, radius: 0, role: 'headline' },
    ],
  });
  type Saved = { id: string; updated_at: string; revision_number: number; status: string };
  const save = (s: Session, id: string | null, base: string | null, document: object, extra: object = {}) =>
    rpcFor(s)('save_image_project', {
      p_organization_id: s.orgId, p_project_id: id, p_base_updated_at: base, p_title: 'E2E serum ad', p_purpose: 'product_ad', p_aspect: '1:1', p_style: 'modern',
      p_prompt: 'Serum ad', p_brief: { product_name: 'Glow Serum', price: '2 400 DA' }, p_document: document, p_source: 'manual', p_label: null, p_series_id: null, p_source_project_id: null, ...extra,
    });

  const wrongSize = await save(A, null, null, doc(photoA.id, 'x', { width: 1080, height: 1920 }));
  check('a design whose size does not match the aspect is refused', !!wrongSize.error && /aspect/i.test(wrongSize.error.message), wrongSize.error?.message ?? 'accepted');
  const foreign = await save(A, null, null, doc(photoB.id));
  check('a design cannot use another workspace’s photo', !!foreign.error && /outside this workspace/i.test(foreign.error.message), foreign.error?.message ?? 'accepted');
  const bInA = await rpcFor(B)('save_image_project', { p_organization_id: A.orgId, p_project_id: null, p_base_updated_at: null, p_title: 'x', p_purpose: 'custom', p_aspect: '1:1', p_style: 'modern', p_prompt: '', p_brief: {}, p_document: doc(null), p_source: 'manual', p_label: null, p_series_id: null, p_source_project_id: null });
  check('another workspace cannot create images here', !!bInA.error);
  const created = await save(A, null, null, doc(photoA.id), { p_source: 'mock_generation', p_label: 'Mock layout: hero' });
  const c = created.data as Saved | null;
  check('a product ad design is created (revision 1, from a mock layout)', !created.error && c?.revision_number === 1, created.error?.message);
  if (!c) return;
  const { data: bSees } = await db(B).from('image_projects').select('id').eq('id', c.id);
  check('another workspace cannot read the design', (bSees ?? []).length === 0);
  const { data: bRevs } = await db(B).from('image_revisions').select('id').eq('image_project_id', c.id);
  check('another workspace cannot read its revisions', (bRevs ?? []).length === 0);
  const stale = await save(A, c.id, '2000-01-01T00:00:00Z', doc(photoA.id, 'Edited'));
  check('a save based on an old version is refused', !!stale.error && /changed since/i.test(stale.error.message), stale.error?.message ?? 'accepted');
  const s2 = await save(A, c.id, c.updated_at, doc(photoA.id, 'Glow Serum — new'));
  const r2 = s2.data as Saved;
  check('an edit creates revision 2', !s2.error && r2?.revision_number === 2, s2.error?.message);
  const a1 = await save(A, c.id, r2.updated_at, doc(photoA.id, 'Auto 1'), { p_source: 'autosave' });
  const a2 = await save(A, c.id, (a1.data as Saved).updated_at, doc(photoA.id, 'Auto 2'), { p_source: 'autosave' });
  check('consecutive autosaves share one revision', (a1.data as Saved)?.revision_number === 3 && (a2.data as Saved)?.revision_number === 3, [a1.error?.message, a2.error?.message]);
  const { data: rev1 } = await db(A).from('image_revisions').select('id').eq('image_project_id', c.id).eq('revision_number', 1).single();
  const restored = await rpcFor(A)('restore_image_revision', { p_revision_id: rev1?.id, p_base_updated_at: (a2.data as Saved).updated_at });
  const rs = restored.data as Saved | null;
  const { data: afterRestore } = await db(A).from('image_projects').select('document').eq('id', c.id).single();
  check('restoring revision 1 brings its design back as a new revision', !restored.error && rs?.revision_number === 4 && afterRestore?.document?.layers?.[1]?.content === 'Glow Serum', restored.error?.message);

  const withPlaceholder = await save(A, c.id, rs!.updated_at, doc(photoA.id, '[Headline]'));
  const ph = await rpcFor(A)('approve_image_project', { p_project_id: c.id, p_base_updated_at: (withPlaceholder.data as Saved).updated_at });
  check('a design with [placeholder] text cannot be approved', !!ph.error && /placeholder/i.test(ph.error.message), ph.error?.message ?? 'accepted');
  const fixed = await save(A, c.id, (withPlaceholder.data as Saved).updated_at, doc(photoA.id, 'Glow Serum'));
  const ap = await rpcFor(A)('approve_image_project', { p_project_id: c.id, p_base_updated_at: (fixed.data as Saved).updated_at });
  check('the design is approved', !ap.error, ap.error?.message);
  const apData = ap.data as { updated_at: string };
  const locked = await save(A, c.id, apData?.updated_at, doc(photoA.id, 'Silent change'));
  check('an approved design cannot be edited without removing approval', !!locked.error && /approved/i.test(locked.error.message), locked.error?.message ?? 'accepted');
  const bApprove = await rpcFor(B)('approve_image_project', { p_project_id: c.id, p_base_updated_at: apData?.updated_at });
  check('another workspace cannot approve it', !!bApprove.error);

  // Exports.
  const exportPath = `${A.orgId}/exports/${crypto.randomUUID()}.png`;
  await A.client.storage.from('workspace-assets').upload(exportPath, FIXTURE_PNG(), { contentType: 'image/png' });
  const reg = (extra: object) => rpcFor(A)('register_image_export', { p_project_id: c.id, p_object_path: exportPath, p_format: 'png', p_width: 1080, p_height: 1080, p_size_bytes: 68, p_revision_number: 6, ...extra });
  const badPath = await reg({ p_object_path: photoA.path });
  check('exports must live in the workspace exports folder', !!badPath.error && /export path/i.test(badPath.error.message), badPath.error?.message ?? 'accepted');
  const badSize = await reg({ p_width: 500, p_height: 500 });
  check('an export must match the design size (1× or 2×)', !!badSize.error && /size does not match/i.test(badSize.error.message), badSize.error?.message ?? 'accepted');
  const exp = await reg({});
  const e = exp.data as { media_asset_id: string; from_approved: boolean } | null;
  check('the export is saved to the library from the approved design', !exp.error && e?.from_approved === true, exp.error?.message);
  const { data: lib } = await db(A).from('media_assets').select('kind, mime_type').eq('id', e?.media_asset_id).single();
  check('the export is a library design file', lib?.kind === 'design' && lib?.mime_type === 'image/png', lib);
  const { data: bExp } = await db(B).from('image_exports').select('id').eq('image_project_id', c.id);
  check('another workspace cannot see the exports', (bExp ?? []).length === 0);
  check('another workspace cannot download the exported file', !!(await B.client.storage.from('workspace-assets').download(exportPath)).error);
  const bReg = await rpcFor(B)('register_image_export', { p_project_id: c.id, p_object_path: exportPath, p_format: 'png', p_width: 1080, p_height: 1080, p_size_bytes: 68, p_revision_number: null });
  check('another workspace cannot register exports for it', !!bReg.error);

  // Social posts.
  type Post = { id: string; updated_at: string; status: string };
  const savePost = (s: Session, id: string | null, base: string | null, extra: object = {}) =>
    rpcFor(s)('save_social_post', { p_organization_id: s.orgId, p_post_id: id, p_base_updated_at: base, p_title: 'E2E serum post', p_caption: '', p_hashtags: ['serum'], p_image_project_id: null, p_media_asset_id: null, ...extra });
  const p1 = await savePost(A, null, null);
  const post = p1.data as Post;
  check('a post draft is created', !p1.error && post?.status === 'draft', p1.error?.message);
  const noImg = await rpcFor(A)('set_social_post_approval', { p_post_id: post.id, p_approve: true, p_base_updated_at: post.updated_at });
  check('a post without caption cannot be approved', !!noImg.error && /caption/i.test(noImg.error.message), noImg.error?.message ?? 'accepted');
  const badTags = await savePost(A, post.id, post.updated_at, { p_hashtags: ['has space'] });
  check('invalid hashtags are refused', !!badTags.error && /hashtags/i.test(badTags.error.message), badTags.error?.message ?? 'accepted');
  const foreignImg = await savePost(A, post.id, post.updated_at, { p_caption: 'New serum!', p_media_asset_id: photoB.id });
  check('a post cannot use another workspace’s image', !!foreignImg.error, foreignImg.error?.message ?? 'accepted');
  const p2 = await savePost(A, post.id, post.updated_at, { p_caption: 'New Glow Serum, 2 400 DA.', p_image_project_id: c.id, p_media_asset_id: e?.media_asset_id });
  const post2 = p2.data as Post;
  check('caption and approved image are attached', !p2.error, p2.error?.message);
  const bPost = await rpcFor(B)('set_social_post_approval', { p_post_id: post.id, p_approve: true, p_base_updated_at: post2.updated_at });
  check('another workspace cannot approve the post', !!bPost.error);
  const okPost = await rpcFor(A)('set_social_post_approval', { p_post_id: post.id, p_approve: true, p_base_updated_at: post2.updated_at });
  check('the post is approved (ready for the future publishing step)', !okPost.error && (okPost.data as Post)?.status === 'approved', okPost.error?.message);
  const editApproved = await savePost(A, post.id, (okPost.data as Post).updated_at, { p_caption: 'changed', p_image_project_id: c.id, p_media_asset_id: e?.media_asset_id });
  check('an approved post cannot be edited silently', !!editApproved.error && /approved/i.test(editApproved.error.message), editApproved.error?.message ?? 'accepted');
  await rpcFor(A)('remove_image_approval', { p_project_id: c.id });
  const { data: back } = await db(A).from('social_posts').select('status').eq('id', post.id).single();
  check('removing the image approval returns its posts to draft', back?.status === 'draft', back);
  const { data: bPosts } = await db(B).from('social_posts').select('id').eq('id', post.id);
  check('another workspace cannot read the post', (bPosts ?? []).length === 0);
  const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data: anonRows } = await (anon as unknown as { from: (t: string) => any }).from('image_projects').select('id').limit(1);
  check('signed-out users cannot read image projects', (anonRows ?? []).length === 0);
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
