/**
 * Versioned character design specs. `canon.ts` holds version 1 of all 18 characters (unchanged); later versions are
 * defined here per character and only for that character. The database (`character_design_specs`) is the authority
 * for each version's STATUS (proposed / approved / superseded) — nothing here approves anything. Shots record the
 * version they use per character (`animation_shots.character_spec_versions`, migration 20261019210000).
 */
import { CANON_SPEC_VERSION, EXPRESSION_KEYS, REQUIRED_VIEWS, canonFor, type CharacterSpec, type ExpressionKey } from './canon.ts';

/** Where an owner-supplied design reference came from (the file itself stays private, outside the public repo). */
export interface DesignSource {
  kind: 'composite_design_sheet';
  provenance: string;
  sha256: string;
  width: number;
  height: number;
  approvedByOwner: string;
  /** What the file is NOT: its views are not separately generated, reviewed or approved reference sheets. */
  limits: string;
}

export interface SpecRevision {
  version: number;
  spec: CharacterSpec;
  /** Exact identity differences from the previous version (recorded in the proposal note). */
  changes: string[];
  designSource?: DesignSource;
  /** Continuity notes to review later (e.g. differences from family members still on an older version). */
  continuityFlags: string[];
  /** Text/mark rule for generated sheets of this version (replaces the default "no logos" rule); absent = default. */
  imageTextRule?: string;
}

const ADAM_BOY_V1 = canonFor('adam_boy')!;

/** Owner-approved composite sheet (ChatGPT Image Generation) — the visual design reference of adam_boy v2. */
export const ADAM_BOY_V2_SOURCE: DesignSource = {
  kind: 'composite_design_sheet',
  provenance: 'ChatGPT Image Generation (OpenAI); supplied by the owner',
  sha256: '6ffe3206a853a35933848c65a549051adbe5ccb3e807c2bbc01576d5301fd20a',
  width: 1145,
  height: 1374,
  approvedByOwner: 'Approved by the owner on 2026-10-19 as the primary visual design reference for adam_boy.',
  limits: 'One composite sheet (hero image, small front/three-quarter/side/back panels, detail crops, six expression heads, Arabic labels). Its individual views were NOT generated, reviewed or approved as LIMO reference sheets.',
};

/** Colours sampled from the composite (warm-graded JPEG): indicative; confirm on the approved v2 front. */
const ADAM_BOY_V2_PALETTE: CharacterSpec['palette'] = [
  { key: 'skin', hex: '#EC9E50', use: 'golden potato skin: head, hands' },
  { key: 'skin_shadow', hex: '#CB7839', use: 'shadows' },
  { key: 'skin_highlight', hex: '#F9C685', use: 'highlight' },
  { key: 'speckles', hex: '#A65721', use: 'natural speckles and tiny potato-eye dimples' },
  { key: 'cheeks', hex: '#E36439', use: 'rosy cheeks' },
  { key: 'iris', hex: '#66301D', use: 'warm-brown irises' },
  { key: 'brows', hex: '#4B2F21', use: 'brows' },
];

const V2_HEAD = 'Smooth egg-shaped potato head, clearly taller than wide, softly rounded with gentle natural irregularities; the head is the largest part of the silhouette.';
const V2_CROWN = 'No sprout, leaves, stem or hair on top of the head.';
const V2_SURFACE = 'Golden potato skin, softly matte, covered with many small natural darker speckles and a few tiny potato-eye dimples (head and hands), never covering the eyes or mouth.';
const V2_FACE = 'Large expressive eyes with warm-brown irises, black pupils and white catchlights; thick dark-brown expressive brows; round rosy cheeks; small potato-shaped nose; small gentle mouth.';
const V2_BODY = 'Compact childlike body under the large head, short arms and legs, rounded four-finger cartoon hands with golden potato skin.';
const V2_SCHOOL = 'Navy school blazer with brown buttons over a white shirt, red tie with darker diagonal stripes, brown trousers, polished brown leather shoes; brown leather backpack worn on both shoulders, with a small decorative potato emblem on the flap (a character illustration, not a commercial logo).';
const V2_SCHOOL_COLORS = ['#29293D', '#FEF1E3', '#942027', '#613221', '#743E2F'];
const V2_DETAILS = [
  'no sprout: smooth egg-shaped head',
  'many small natural speckles',
  'round rosy cheeks',
  'large warm-brown eyes with catchlights',
  'brown leather backpack with a small decorative potato emblem',
];
const V2_NEGATIVE = [
  'a human child, realistic human skin or a human face',
  'hair, a sprout, leaves or a stem on the head',
  'more or fewer than four fingers per hand',
  'extra limbs or duplicated features',
  'changing the skin colour, head shape or face layout',
  'text, brand logos or watermarks (only the small decorative potato emblem on the backpack is allowed)',
  'scary, violent or adult content',
  'photorealistic food textures',
];

function adamBoyV2(): CharacterSpec {
  const locked = ADAM_BOY_V2_PALETTE.filter((p) => ['skin', 'iris', 'cheeks'].includes(p.key)).map((p) => `${p.key} ${p.hex}`);
  const identity = [
    'ADAM young boy (about 10 years old): premium cinematic 3D anthropomorphic potato character for a family-friendly animated series — never a human child.',
    V2_HEAD, V2_CROWN, V2_SURFACE, V2_FACE, V2_BODY,
    'About 2.4 heads tall; upright, slightly shy, often holding the backpack straps.',
    `Colours: ${locked.join(', ')}.`,
    `Details: ${V2_DETAILS.join('; ')}.`,
  ].join(' ');
  return {
    ...ADAM_BOY_V1,
    spec_version: 2,
    render_style: 'Premium cinematic 3D animation style, animated-feature quality, soft global illumination, clean shapes, no photorealism.',
    personality: 'kind, intelligent, sensitive and brave',
    head: V2_HEAD,
    crown: V2_CROWN,
    surface: V2_SURFACE,
    face: V2_FACE,
    body: V2_BODY,
    proportions: { height_in_heads: 2.4, head_width_to_shoulders: 0.7, posture: 'upright, slightly shy, often holding the backpack straps' },
    palette: ADAM_BOY_V2_PALETTE,
    signature_details: V2_DETAILS,
    outfits: [
      { key: 'school', name: 'School', description: V2_SCHOOL, colors: V2_SCHOOL_COLORS },
      ADAM_BOY_V1.outfits.find((o) => o.key === 'special')!,
    ],
    expressions: ADAM_BOY_V1.expressions,
    required_views: REQUIRED_VIEWS,
    design_source: ADAM_BOY_V2_SOURCE,
    consistency: {
      identity_prompt: identity,
      negative_prompt: V2_NEGATIVE,
      locked_colors: locked,
      final_check: 'Four fingers per hand, no hair or sprout, no text or brand logo (backpack potato emblem allowed), family-friendly, never a human child',
      rules: [
        'Approved reference images take priority over text when both are available; the owner-approved design sheet is a style/identity source, not an approved view.',
        'Keep the smooth egg-shaped head (no sprout), the speckles, rosy cheeks, large warm-brown eyes and the golden skin identical in every shot.',
        'Only the outfit and expression may change between scenes.',
        'Child height relationship: ≈ 2.4 heads (v2); ADAM adults are still specified at 3.4 heads (v1).',
      ],
    },
  };
}

/** Versions after v1, per character. Only adam_boy has one (proposed for owner review, 2026-10-19). */
export const SPEC_REVISIONS: Readonly<Record<string, readonly SpecRevision[]>> = {
  adam_boy: [
    {
      version: 2,
      spec: adamBoyV2(),
      designSource: ADAM_BOY_V2_SOURCE,
      imageTextRule: 'Do not render any words, letters, numbers, prices, labels, brand logos or watermarks in the image. The only permitted mark is the small decorative potato emblem on the backpack flap, which is part of the approved character design (a character illustration, not a commercial logo).',
      changes: [
        'Crown: two-leaf green sprout (left leaf larger) → none (no sprout, leaves, stem or hair).',
        'Head: lumpy oval with a soft bump on the upper left → smooth egg shape, clearly taller than wide.',
        'Surface: exactly three potato-eye spots in fixed positions → many small natural speckles and a few tiny dimples.',
        'Skin colour: #C99A62 (shadow #9A7146, highlight #E3BE8A) → golden #EC9E50 (shadow #CB7839, highlight #F9C685); sampled, confirm on the v2 front.',
        'Eyes: small, dark-brown iris #2B2118 → large expressive, warm-brown iris #66301D, black pupils, catchlights.',
        'Cheeks: not specified → round rosy cheeks #E36439.',
        'Nose / mouth: round button nose, friendly wide mouth → small potato-shaped nose, small gentle mouth.',
        'Proportions: 2.6 heads, head 1.5 × shoulders → ≈ 2.4 heads, compact body (by eye from the sheet; re-measure on the v2 front).',
        'Outfit: everyday striped T-shirt, knee shorts, sneakers → school: navy blazer, white shirt, red striped tie, brown trousers, brown shoes; weekend outfit kept from v1.',
        'Accessory: small backwards cap on special occasions → brown leather backpack with a small decorative potato emblem (allowed; not a commercial logo).',
        'Personality: playful and curious → kind, intelligent, sensitive and brave; about 10 years old.',
        'Unchanged: anthropomorphic potato species, four-finger hands, the 8 expression keys, required views, family-friendly rules.',
      ],
      continuityFlags: [
        'adam_man (father, shots 1–2) is still on ADAM v1: two-leaf sprout, three fixed spots, tan #C99A62, small eyes — the son will look different from his father until the owner reviews the ADAM family look.',
        'The approved father variant adam_man.formal_angry v1 is built on adam_man v1 and is unaffected.',
        'Other ADAM members (girl, woman, elders) stay on v1; no automatic change.',
      ],
    },
  ],
};

/** All spec versions known in code for a character (1 = canon.ts). */
export function specVersionsOf(characterId: string): number[] {
  if (!canonFor(characterId)) return [];
  return [CANON_SPEC_VERSION, ...(SPEC_REVISIONS[characterId] ?? []).map((r) => r.version)];
}

export function latestSpecVersion(characterId: string): number {
  return Math.max(...specVersionsOf(characterId), CANON_SPEC_VERSION);
}

export function specRevision(characterId: string, version: number): SpecRevision | undefined {
  return (SPEC_REVISIONS[characterId] ?? []).find((r) => r.version === version);
}

/**
 * The spec of one character at one version. Without a version: version 1 (canon.ts), the baseline every other
 * character keeps — callers that know a shot's pinned version must pass it.
 */
export function specFor(characterId: string, version?: number): CharacterSpec | undefined {
  if (version === undefined || version === CANON_SPEC_VERSION) return canonFor(characterId);
  return specRevision(characterId, version)?.spec;
}

export type { ExpressionKey };
export const SPEC_EXPRESSION_KEYS = EXPRESSION_KEYS;
