/**
 * Imports an owner scenario (JSON template, docs/ANIMATION_PIPELINE.md §9) into Animation Studio as a NEW project of a
 * signed-in user's workspace, through the same database functions the editor uses (validation, 30 s limit, RLS).
 * Nothing is generated, approved or attached: shots start as drafts; references are attached later in the editor once
 * approved artwork exists. LOCAL stack only.
 *
 * Env: SUPABASE_URL (local), SUPABASE_ANON_KEY, IMPORT_EMAIL, IMPORT_PASSWORD
 * Usage: node scripts/import-animation-scenario.ts <scenario.json> [--voice-mode separate|native] [--lip-sync] [--project <id>]
 *   --project updates that project (title/settings and ALL shots are replaced; shots being generated block it).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseScenarioJson } from '../lib/animation/scenario-import.ts';
import { toSavePayload } from '../lib/animation/storyboard.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env ${k}`);
    process.exit(2);
  }
  return v;
};
const URL_ = env('SUPABASE_URL');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_)) {
  console.error('Local stack only.');
  process.exit(2);
}
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-animation-scenario.ts <scenario.json>');
  process.exit(2);
}
const voiceMode = process.argv.includes('--voice-mode') ? process.argv[process.argv.indexOf('--voice-mode') + 1] : 'separate';

async function main() {
  const { scenario, errors } = parseScenarioJson(readFileSync(file!, 'utf8'));
  if (!scenario || errors.length) {
    console.error('Scenario problems:\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  const client = createClient(URL_, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error } = await client.auth.signInWithPassword({ email: env('IMPORT_EMAIL'), password: env('IMPORT_PASSWORD') });
  if (error || !auth.user) throw new Error(`sign-in failed: ${error?.message}`);
  const { data: m } = await client.from('organization_members').select('organization_id').eq('user_id', auth.user.id).limit(1);
  const org = m?.[0]?.organization_id as string;
  const rpc = client.rpc.bind(client) as unknown as (fn: string, a: object) => Promise<{ data: any; error: { message: string } | null }>;
  const pIdx = process.argv.indexOf('--project');
  const existing = pIdx > 0 ? process.argv[pIdx + 1] ?? null : null;
  const created = await rpc('save_animation_project', {
    p_organization_id: org, p_project_id: existing, p_title: scenario.title ?? 'Imported scenario', p_language: scenario.language ?? 'fr', p_aspect: scenario.aspect ?? '9:16',
    p_music_asset_id: null, p_music_note: scenario.music ?? '', p_settings: { tier: 'fast', resolution: '720p', voice_mode: voiceMode === 'native' ? 'native' : 'separate', lip_sync: process.argv.includes('--lip-sync'), takes: 2 },
  });
  if (created.error) throw new Error(`project: ${created.error.message}`);
  const saved = await rpc('save_animation_shots', { p_project_id: created.data, p_shots: toSavePayload(scenario.shots.map((s) => ({ ...s, reference_asset_ids: [] }))), p_expected_revision: null });
  if (saved.error) throw new Error(`shots: ${saved.error.message}`);
  console.log(JSON.stringify({ project_id: created.data, shots: scenario.shots.length, total_seconds: saved.data.total_seconds, url: `/app/animation/${created.data}` }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
