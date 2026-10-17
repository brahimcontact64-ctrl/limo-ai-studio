/**
 * Prints the SQL seed for character_design_specs (version 1, status "proposed") from lib/characters/canon.ts.
 * Usage: node scripts/gen-character-specs-sql.ts > /tmp/seed.sql   (paste into the migration's seed section)
 * The unit test "migration seed matches the canon" fails if the migration and the canon drift apart.
 */
import { CANON, CANON_SPEC_VERSION } from '../lib/characters/canon.ts';

export function specsSeedSql(): string {
  const rows = CANON.map((c) => {
    const json = JSON.stringify(c).replace(/'/g, "''");
    return `  ('${c.character_id}', ${CANON_SPEC_VERSION}, 'proposed', '${json}'::jsonb, 'Canonical design brief v${CANON_SPEC_VERSION} (text). Awaiting owner review.')`;
  });
  return [
    'insert into public.character_design_specs(character_id, version, status, spec, note) values',
    rows.join(',\n'),
    'on conflict (character_id, version) do nothing;',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('gen-character-specs-sql.ts')) {
  console.log(specsSeedSql());
}
