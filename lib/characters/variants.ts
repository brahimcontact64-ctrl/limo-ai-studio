/**
 * Scene-specific character VARIANTS: a costume and/or an expression for one production, layered on an unchanged
 * canonical spec (identity — head, crown, face, colours, proportions — never changes). A variant starts `proposed` and
 * is used for artwork only after the owner approves it; the canonical spec in canon.ts is never edited by a variant.
 * The database (migration 20261019180000, table character_variants) is the authority for approval; this file mirrors
 * the approved rows for prompts and planning. Approving a variant never approves any artwork.
 */
import { EXPRESSION_KEYS, NEGATIVE_PROMPT, canonFor, type CharacterSpec, type ExpressionKey } from './canon.ts';
import { SHEET_DIRECTION } from './artwork.ts';

/** Expressions that exist only inside an approved variant (never one of the 8 canonical sheets). */
export const VARIANT_EXPRESSION_KEYS = ['angry'] as const;
/** Expression of a character in a shot: canonical, or the expression of the variant selected for that shot. */
export type SceneExpression = ExpressionKey | (typeof VARIANT_EXPRESSION_KEYS)[number];

export interface CharacterVariant {
  id: string;
  /** Database key (character_variants.variant_key) + version. */
  key: string;
  version: number;
  character: string;
  /** Canonical spec version the variant is drawn on. */
  baseSpecVersion: number;
  status: 'proposed' | 'approved' | 'rejected';
  approvalNote?: string;
  purpose: string;
  outfit?: { key: string; description: string; colors: string[]; accessories: string[] };
  expression?: { key: SceneExpression; description: string };
}

/** Flagship #1 "The Supernatural Eye": the wealthy, angry father. APPROVED by the owner (variant only, no artwork). */
export const ADAM_MAN_FORMAL_ANGRY: CharacterVariant = {
  id: 'adam_man.formal_angry.v1',
  key: 'adam_man.formal_angry',
  version: 1,
  character: 'adam_man',
  baseSpecVersion: 1,
  status: 'approved',
  approvalNote: 'Approved by the owner in writing on 2026-10-19 (scene variant only; canonical spec unchanged; no artwork approved).',
  purpose: 'Flagship #1 "The Supernatural Eye", shots 1–2: wealthy family-drama father.',
  outfit: {
    key: 'formal',
    description: 'Tailored charcoal three-piece suit with a crisp white dress shirt, burgundy silk tie and pocket square, gold cufflinks, polished black shoes; elegant and expensive-looking, clean stylized folds',
    colors: ['#2E3138', '#F4F1EA', '#7A1F2B', '#E0A526'],
    accessories: ['gold wristwatch on the LEFT wrist (story prop used in shot 2; its design is generic, no brand or logo)'],
  },
  expression: {
    key: 'angry',
    description: 'brows pulled down and together, eyes narrowed, mouth open mid-sentence with a hint of teeth, tense cheeks; strong but family-friendly anger, no distortion of the canonical face layout, no scary features',
  },
};

export const VARIANTS: readonly CharacterVariant[] = [ADAM_MAN_FORMAL_ANGRY];

/** Approved variant by database key (latest version), optionally only for one character. */
export function approvedVariant(key: string | undefined, character?: string): CharacterVariant | undefined {
  if (!key) return undefined;
  return VARIANTS.filter((v) => v.key === key && v.status === 'approved' && (!character || v.character === character)).sort((a, b) => b.version - a.version)[0];
}

/** An expression is allowed when it is canonical or it is the expression of the variant selected for the character. */
export function expressionAllowed(expression: string, variantKey: string | undefined, character: string): boolean {
  if ((EXPRESSION_KEYS as readonly string[]).includes(expression)) return true;
  return !!variantKey && approvedVariant(variantKey, character)?.expression?.key === expression;
}

/** Variant text for clip / keyframe prompts (outfit + expression description); empty without a variant. */
export function variantSceneText(variantKey: string | undefined, character: string): string {
  const v = approvedVariant(variantKey, character);
  if (!v) return '';
  return [
    v.outfit ? ` Outfit in this scene (approved variant "${v.outfit.key}"): ${v.outfit.description} (colours ${v.outfit.colors.join(', ')}); ${v.outfit.accessories.join('; ')}.` : '',
    v.expression ? ` Variant expression "${v.expression.key}": ${v.expression.description}.` : '',
  ].join('');
}

const VIEW_TEXT = {
  front: 'Front view, facing the camera, standing pose, arms slightly away from the body (about 15°), feet shoulder width.',
  three_quarter: 'Three-quarter view turned 45° to the left, same pose and outfit as the reference.',
  side: 'Side view (profile facing left), same pose and outfit as the reference.',
} as const;

/** Artwork prompt for one variant sheet: canonical identity text + the variant's outfit/expression. */
export function variantPrompt(v: CharacterVariant, sheet: { view: keyof typeof VIEW_TEXT } | { expression: true }): string {
  const spec = canonFor(v.character) as CharacterSpec | undefined;
  if (!spec) throw new Error(`unknown character ${v.character}`);
  const outfit = v.outfit ? `Outfit (scene variant "${v.outfit.key}", not the canonical outfit): ${v.outfit.description} (colours ${v.outfit.colors.join(', ')}). Accessories: ${v.outfit.accessories.join('; ')}.` : '';
  const what = 'view' in sheet ? VIEW_TEXT[sheet.view] : 'Head and shoulders, front view.';
  const expr = v.expression && ('expression' in sheet || sheet.view === 'front') ? `Expression (scene variant "${v.expression.key}"): ${v.expression.description}.` : 'Neutral expression.';
  return [
    spec.consistency.identity_prompt,
    outfit,
    what,
    expr,
    'The character identity must stay exactly canonical: same head shape, crown, potato-eye spots, skin colour, face layout and proportions as the approved canonical references.',
    SHEET_DIRECTION,
    `Locked colours: ${spec.consistency.locked_colors.join(', ')}.`,
    `Never: ${NEGATIVE_PROMPT.join('; ')}.`,
  ].filter(Boolean).join('\n');
}
