/**
 * Proposes one design-spec version from code (lib/characters/spec-versions.ts) through the audited admin function
 * `admin_propose_character_spec` (platform admin with two-factor). LOCAL stack only. It never approves anything:
 * approval is a separate, human step in Admin → Characters.
 *
 * Default is a DRY RUN that prints the exact JSON and note. `--apply` signs in as the admin (password + TOTP) and
 * proposes; it refuses if that version already exists or if the database would number it differently.
 *
 * Env: SUPABASE_URL (local), SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP_SECRET (only with --apply)
 * Usage: node scripts/characters/propose-spec.ts --character adam_boy --version 2 [--apply]
 */
import { createClient } from '@supabase/supabase-js';
import { specRevision } from '../../lib/characters/spec-versions.ts';
import { totp } from '../lib/totp.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const character = arg('character') ?? '';
const version = Number(arg('version'));
const rev = specRevision(character, version);
if (!rev) {
  console.error(`no spec revision ${character} v${arg('version')} in lib/characters/spec-versions.ts`);
  process.exit(2);
}

/** The stored spec JSON: the spec itself + the recorded differences, continuity flags and design-source metadata. */
export const proposal = {
  spec: { ...rev.spec, changes_from_previous: rev.changes, continuity_flags: rev.continuityFlags },
  note: [
    `Proposed for owner review (not approved). ${character} v${version} from the owner-approved design sheet`,
    rev.designSource ? `(${rev.designSource.provenance}; sha256 ${rev.designSource.sha256.slice(0, 16)}…).` : '.',
    'Only this character changes; all earlier versions and the other characters stay as they are.',
  ].join(' '),
};

async function main() {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run (nothing written)', character, version, note: proposal.note, spec: proposal.spec }, null, 2));
    return;
  }
  const url = process.env.SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    console.error('Refusing to run: SUPABASE_URL is not a local stack.');
    process.exit(2);
  }
  const need = (k: string) => process.env[k] ?? (console.error(`Missing ${k}`), process.exit(2));
  const client = createClient(url, need('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email: need('ADMIN_EMAIL'), password: need('ADMIN_PASSWORD') });
  if (signErr) throw new Error(`sign-in failed: ${signErr.message}`);
  const { data: factors } = await client.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) throw new Error('the admin has no TOTP factor');
  const { error: mfaErr } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(need('ADMIN_TOTP_SECRET')) });
  if (mfaErr) throw new Error(`two-factor failed: ${mfaErr.message}`);
  const { data: rows } = await client.from('character_design_specs').select('version').eq('character_id', character);
  const versions = ((rows ?? []) as Array<{ version: number }>).map((r) => r.version);
  if (versions.includes(version)) return console.log(`${character} v${version} already exists — nothing done`);
  if (Math.max(0, ...versions) + 1 !== version) throw new Error(`the database would number this proposal v${Math.max(0, ...versions) + 1}, not v${version}`);
  const rpc = client.rpc.bind(client) as unknown as (fn: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>;
  const r = await rpc('admin_propose_character_spec', { p_character_id: character, p_spec: proposal.spec, p_note: proposal.note });
  if (r.error) throw new Error(r.error.message);
  console.log(`proposed ${character} v${r.data} (status proposed — approve or reject it in Admin → Characters)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
