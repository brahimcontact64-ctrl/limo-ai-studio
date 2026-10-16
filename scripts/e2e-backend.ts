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

  return finish(A.client, created, rpc);
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
