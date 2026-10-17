import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { untyped } from '../supabase/rpc';
import type { CharacterRecord } from '../studio/types';

export interface CustomCharacter {
  id: string;
  name: string;
  description: string;
  base_family: string | null;
  age_group: string | null;
  gender_code: string | null;
  spec: Record<string, unknown>;
  spec_version: number;
  reference_status: string;
  visual_ref: string | null;
  status: string;
}

/** Workspace characters (migration 20261017140000). Returns [] before the migration is applied. */
export async function listCustomCharacters(supabase: ServerSupabase, organizationId: string, includeArchived = false): Promise<CustomCharacter[]> {
  let q = untyped(supabase)
    .from('characters')
    .select('id, name, description, base_family, age_group, gender_code, spec, spec_version, reference_status, visual_ref, status')
    .eq('organization_id', organizationId)
    .order('created_at');
  if (!includeArchived) q = q.eq('status', 'active');
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as CustomCharacter[];
}

/** Workspace characters in the shape the studio uses for the cast ("custom:<uuid>"). */
export function customAsRecords(chars: CustomCharacter[]): CharacterRecord[] {
  return chars.map((c, i) => ({
    id: `custom:${c.id}`,
    name: c.name,
    family_code: null,
    base_family: c.base_family,
    age_group: c.age_group,
    gender_code: c.gender_code,
    reference_status: c.reference_status,
    visual_description: c.description || null,
    tone: typeof c.spec?.personality === 'string' ? (c.spec.personality as string) : '',
    visual_ref: c.visual_ref,
    sort_order: 1000 + i,
    identity_prompt: typeof c.spec?.identity_prompt === 'string' ? (c.spec.identity_prompt as string) : null,
    spec_version: c.spec_version,
    spec_status: null,
    custom: true,
  }));
}
