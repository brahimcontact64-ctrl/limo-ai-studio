import { CHARACTER_FAMILIES } from '../studio/limits.ts';
import { NEGATIVE_PROMPT, REQUIRED_VIEWS } from './canon.ts';

/** Form input for a workspace character. The design spec and identity prompt are built from it on the server. */
export interface CustomCharacterInput {
  name: string;
  description: string;
  base_family: string | null;
  age_group: 'child' | 'adult' | 'elder' | null;
  gender_code: 'male' | 'female' | 'unspecified' | null;
  personality: string;
  details: string[];
  colors: { primary: string; secondary: string; accent: string };
  outfit: string;
}

export type CustomCharacterIssue = 'name_required' | 'name_too_long' | 'description_too_long' | 'invalid_color' | 'invalid_option' | 'too_many_details';

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseCustomCharacter(raw: unknown): { ok: true; value: CustomCharacterInput } | { ok: false; issue: CustomCharacterIssue } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, issue: 'name_required' };
  if (name.length > 80) return { ok: false, issue: 'name_too_long' };
  if (typeof b.description === 'string' && b.description.length > 2000) return { ok: false, issue: 'description_too_long' };
  const family = b.base_family === null || b.base_family === '' || b.base_family === undefined ? null : String(b.base_family);
  if (family !== null && !(CHARACTER_FAMILIES as readonly string[]).includes(family)) return { ok: false, issue: 'invalid_option' };
  const age = b.age_group === null || b.age_group === '' || b.age_group === undefined ? null : String(b.age_group);
  if (age !== null && !['child', 'adult', 'elder'].includes(age)) return { ok: false, issue: 'invalid_option' };
  const gender = b.gender_code === null || b.gender_code === '' || b.gender_code === undefined ? null : String(b.gender_code);
  if (gender !== null && !['male', 'female', 'unspecified'].includes(gender)) return { ok: false, issue: 'invalid_option' };
  const details = Array.isArray(b.details) ? b.details.map((d) => str(d, 120)).filter(Boolean) : [];
  if (details.length > 8) return { ok: false, issue: 'too_many_details' };
  const c = (b.colors && typeof b.colors === 'object' ? b.colors : {}) as Record<string, unknown>;
  const colors = { primary: str(c.primary, 7) || '#7157EF', secondary: str(c.secondary, 7) || '#F4F1EA', accent: str(c.accent, 7) || '#211E2B' };
  if (![colors.primary, colors.secondary, colors.accent].every((x) => HEX.test(x))) return { ok: false, issue: 'invalid_color' };
  return {
    ok: true,
    value: {
      name,
      description: str(b.description, 2000),
      base_family: family,
      age_group: age as CustomCharacterInput['age_group'],
      gender_code: gender as CustomCharacterInput['gender_code'],
      personality: str(b.personality, 120),
      details,
      colors,
      outfit: str(b.outfit, 300),
    },
  };
}

const FAMILY_STYLE: Record<string, string> = {
  limo: 'in the LIMO family style (stylized anthropomorphic tomato)',
  nova: 'in the NOVA family style (stylized anthropomorphic strawberry)',
  adam: 'in the ADAM family style (stylized anthropomorphic potato)',
};

/** Design spec stored in characters.spec (same consistency fields as the canonical characters). */
export function buildCustomSpec(input: CustomCharacterInput) {
  const who = [input.age_group, input.gender_code && input.gender_code !== 'unspecified' ? input.gender_code : null].filter(Boolean).join(' ');
  const identity = [
    `${input.name}: premium stylized 3D character for a family-friendly animated series${input.base_family ? ` ${FAMILY_STYLE[input.base_family]}` : ''}${who ? `, ${who}` : ''}.`,
    input.description,
    input.outfit ? `Outfit: ${input.outfit}.` : '',
    `Colours: primary ${input.colors.primary}, secondary ${input.colors.secondary}, accent ${input.colors.accent}.`,
    input.details.length ? `Details: ${input.details.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    personality: input.personality,
    description: input.description,
    outfit: input.outfit,
    palette: [
      { key: 'primary', hex: input.colors.primary },
      { key: 'secondary', hex: input.colors.secondary },
      { key: 'accent', hex: input.colors.accent },
    ],
    signature_details: input.details,
    render_style: 'Premium stylized 3D, animated-feature quality, family-friendly, no photorealism.',
    required_views: REQUIRED_VIEWS,
    identity_prompt: identity,
    negative_prompt: NEGATIVE_PROMPT.filter((n) => !n.startsWith('hair on the head') && !n.startsWith('changing the family')),
  };
}
