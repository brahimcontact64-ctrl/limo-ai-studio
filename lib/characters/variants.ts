/**
 * Scene-specific character VARIANTS: a costume and/or an expression for one production, layered on an unchanged
 * canonical spec (identity — head, crown, face, colours, proportions — never changes). A variant starts `proposed` and
 * is used for artwork only after the owner approves it; the canonical spec in canon.ts is never edited by a variant.
 */
import { NEGATIVE_PROMPT, canonFor, type CharacterSpec } from './canon.ts';
import { SHEET_DIRECTION } from './artwork.ts';

export interface CharacterVariant {
  id: string;
  character: string;
  /** Canonical spec version the variant is drawn on. */
  baseSpecVersion: number;
  status: 'proposed' | 'approved' | 'rejected';
  purpose: string;
  outfit?: { key: string; description: string; colors: string[]; accessories: string[] };
  expression?: { key: string; description: string };
}

/** Flagship #1 "The Supernatural Eye": the wealthy, angry father. PROPOSED — owner review pending. */
export const ADAM_MAN_FORMAL_ANGRY: CharacterVariant = {
  id: 'adam_man.formal_angry.v1',
  character: 'adam_man',
  baseSpecVersion: 1,
  status: 'proposed',
  purpose: 'Flagship #1 "The Supernatural Eye", shot 1–2: wealthy family-drama father.',
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
