/**
 * Canonical character artwork workflow (Milestone 10) — prompts and order of work for the 18 characters.
 *
 * This module only PREPARES generation requests from the approved written specs (canon.ts). Nothing here creates
 * artwork, uploads a reference, or approves anything: generated sheets go into the existing admin review
 * (character_reference_assets, viewing + checklist + MFA admin approval), exactly like commissioned artwork.
 * Paid generation needs the owner's explicit authorisation (paidCallBlockers); none was run in Milestone 10.
 *
 * Order of work per character (one family's adult man first as the pilot):
 *   1. front (text-only prompt, no reference — establishes the identity)
 *   2. three_quarter and side, each with the APPROVED front as reference (identity locked)
 *   3. back (optional), expressions (8, head and shoulders), outfits (everyday, special)
 *   4. other variants of the family use the family's approved fronts as style references
 * A rendered 3D-style image is NOT a rigged 3D model; rigs are a separate deliverable (references.ts kinds).
 */
import { CANON, EXPRESSION_KEYS, REQUIRED_VIEWS, canonFor, type CharacterSpec, type ExpressionKey } from './canon.ts';

export type SheetKind = { type: 'view'; view: 'front' | 'side' | 'three_quarter' | 'back' } | { type: 'expression'; expression: ExpressionKey } | { type: 'outfit'; outfit: CharacterSpec['outfits'][number]['key'] };

/** Light rig, camera, background and format shared by every sheet (CHARACTER_REFERENCE_GUIDE §1). */
export const SHEET_DIRECTION = [
  'Premium stylized 3D character render for a family-friendly animated series, clean readable shapes, soft global illumination, no photorealism.',
  'Key light 45° camera-left and above, soft fill camera-right at 40 %, rim light from behind; plain neutral grey-lavender background #EFECF7; contact shadow only.',
  '50 mm equivalent lens at chest height, character centred and fully visible with 8 % margin, no perspective exaggeration.',
].join(' ');
/** 3:4 portrait, at least 2048 × 2730 (guide §2) → request the 2K tier and check the size on review. */
export const SHEET_SIZE = { width: 2048, height: 2731 } as const;

const VIEW_TEXT: Record<'front' | 'side' | 'three_quarter' | 'back', string> = {
  front: 'Front view, facing the camera, relaxed neutral standing pose, arms slightly away from the body (about 15°), feet shoulder width.',
  side: 'Side view (profile facing left), same pose and outfit as the reference.',
  three_quarter: 'Three-quarter view turned 45° to the left, same pose and outfit as the reference.',
  back: 'Back view, same pose and outfit as the reference.',
};

export function sheetPrompt(spec: CharacterSpec, kind: SheetKind): string {
  const outfit = kind.type === 'outfit' ? spec.outfits.find((o) => o.key === kind.outfit) : spec.outfits[0]; // the primary outfit (v1: everyday; adam_boy v2: school)
  const what =
    kind.type === 'view'
      ? VIEW_TEXT[kind.view]
      : kind.type === 'expression'
        ? `Head and shoulders, front view, expression: ${(spec.expressions.find((e) => e.key === kind.expression)?.description ?? kind.expression).replace(/\.+$/, '')}.`
        : 'Full body, three-quarter view.';
  return [
    spec.consistency.identity_prompt,
    outfit ? `Outfit: ${outfit.description.replace(/\.+$/, '')} (colours ${outfit.colors.join(', ')}).` : '',
    what,
    kind.type === 'expression' ? '' : 'Neutral expression.',
    SHEET_DIRECTION,
    `Locked colours: ${spec.consistency.locked_colors.join(', ')}.`,
    `Never: ${spec.consistency.negative_prompt.join('; ')}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface SheetTask {
  characterId: string;
  specVersion: number;
  kind: SheetKind;
  slot: string;
  prompt: string;
  /** Which approved sheets must exist first and are sent as references (identity lock). */
  needs: string[];
  required: boolean;
}

export const slotOf = (k: SheetKind) => (k.type === 'view' ? `view:${k.view}` : k.type === 'expression' ? `expression:${k.expression}` : `outfit:${k.outfit}`);

/** Every sheet of one character in work order. */
export function sheetPlan(characterId: string, specVersion: number): SheetTask[] {
  const spec = canonFor(characterId);
  if (!spec) throw new Error(`unknown character ${characterId}`);
  const kinds: SheetKind[] = [
    { type: 'view', view: 'front' },
    { type: 'view', view: 'three_quarter' },
    { type: 'view', view: 'side' },
    { type: 'view', view: 'back' },
    ...EXPRESSION_KEYS.map((expression) => ({ type: 'expression', expression }) as SheetKind),
    { type: 'outfit', outfit: 'everyday' },
    { type: 'outfit', outfit: 'special' },
  ];
  return kinds.map((kind) => ({
    characterId, specVersion, kind, slot: slotOf(kind), prompt: sheetPrompt(spec, kind),
    needs: kind.type === 'view' && kind.view === 'front' ? [] : ['view:front'],
    required: kind.type === 'view' && (REQUIRED_VIEWS as readonly string[]).includes(kind.view),
  }));
}

/** The next sheets that may be generated now: their prerequisites are approved and they are not approved yet. */
export function nextSheets(plan: SheetTask[], approvedSlots: ReadonlySet<string>): SheetTask[] {
  return plan.filter((t) => !approvedSlots.has(t.slot) && t.needs.every((n) => approvedSlots.has(n)));
}

/** Counts used in the plan and the docs: 3 required views × 18 = 54; 14 sheets × 18 = 252. */
export const ARTWORK_TOTALS = { characters: CANON.length, requiredPerCharacter: REQUIRED_VIEWS.length, sheetsPerCharacter: 4 + EXPRESSION_KEYS.length + 2 };

/**
 * Identity checks a reviewer confirms for a generated sheet, derived from the spec (shown with the review
 * checklist). These are human checks: no automated score marks artwork as approved.
 */
export function identityChecks(spec: CharacterSpec): string[] {
  return [
    `Head: ${spec.head}`,
    `Crown: ${spec.crown}`,
    `Face: ${spec.face}`,
    `About ${spec.proportions.height_in_heads} heads tall; ${spec.proportions.posture}`,
    `Colours: ${spec.palette.map((p) => `${p.key} ${p.hex}`).join(', ')}`,
    ...spec.signature_details.map((d) => `Detail: ${d}`),
    spec.consistency.final_check ?? 'Four fingers per hand, no hair, no text or logo, family-friendly',
  ];
}
