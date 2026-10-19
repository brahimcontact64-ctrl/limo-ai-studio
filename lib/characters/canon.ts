/**
 * Canonical design specification for the 18 LIMO characters (version 1).
 *
 * This is a written design brief, not artwork. It is the single source of truth for identity:
 * the database seed (`character_design_specs`) is generated from it, reference images are reviewed
 * against it, and generation prompts are built from it. Family traits are defined once and shared
 * by all six variants of a family, so identity and proportions stay consistent.
 *
 * Status: proposed. A platform admin approves a spec version after reading it; reference artwork is
 * approved separately, per view, only after visual review of the actual image.
 */
import { CHARACTER_FAMILIES, CHARACTER_VARIANTS, type CharacterFamily, type CharacterVariant } from '../studio/limits.ts';

export const CANON_SPEC_VERSION = 1;
export const REQUIRED_VIEWS = ['front', 'side', 'three_quarter'] as const;
export const OPTIONAL_VIEWS = ['back'] as const;
export const REFERENCE_VIEWS = [...REQUIRED_VIEWS, ...OPTIONAL_VIEWS] as const;
export type ReferenceView = (typeof REFERENCE_VIEWS)[number];
export const EXPRESSION_KEYS = ['neutral', 'happy', 'laughing', 'surprised', 'sad', 'thinking', 'determined', 'worried'] as const;
export type ExpressionKey = (typeof EXPRESSION_KEYS)[number];

export interface PaletteColor {
  key: string;
  hex: string;
  use: string;
}
export interface Outfit {
  key: 'everyday' | 'special' | 'school';
  name: string;
  description: string;
  colors: string[];
}
export interface CharacterSpec {
  character_id: string;
  /** Set on versions after 1 (lib/characters/spec-versions.ts); absent = version 1. */
  spec_version?: number;
  /** Owner-supplied design reference of this version (metadata only; the file stays private). */
  design_source?: { kind: string; provenance: string; sha256: string; width: number; height: number; approvedByOwner: string; limits: string };
  family: CharacterFamily;
  variant: CharacterVariant;
  species: string;
  render_style: string;
  age_group: 'child' | 'adult' | 'elder';
  gender: 'male' | 'female';
  personality: string;
  head: string;
  crown: string;
  surface: string;
  face: string;
  body: string;
  proportions: { height_in_heads: number; head_width_to_shoulders: number; posture: string };
  palette: PaletteColor[];
  signature_details: string[];
  outfits: Outfit[];
  expressions: Array<{ key: ExpressionKey; description: string }>;
  required_views: readonly string[];
  consistency: { identity_prompt: string; negative_prompt: string[]; locked_colors: string[]; rules: string[]; final_check?: string };
}

interface FamilyCanon {
  species: string;
  head: string;
  crown: string;
  surface: string;
  face: string;
  palette: PaletteColor[];
  signature: string[];
  outfitColors: string[];
}

const FAMILY: Record<CharacterFamily, FamilyCanon> = {
  limo: {
    species: 'anthropomorphic tomato',
    head: 'Round glossy tomato head, slightly wider than tall, with four soft vertical lobes; the head is the largest part of the silhouette.',
    crown: 'Five-point star-shaped green calyx on top with a short curled stem tilted to the character’s right.',
    surface: 'Smooth glossy skin with one soft specular highlight on the upper left of the head and a subtle warm subsurface glow.',
    face: 'Large oval eyes with dark brown irises and two white catchlights, thick rounded brows one shade darker than the skin, small rounded nose bump, wide expressive mouth, soft cheek blush.',
    palette: [
      { key: 'skin', hex: '#E8412C', use: 'head, hands, legs' },
      { key: 'skin_shadow', hex: '#B82E1F', use: 'shadows, brows' },
      { key: 'skin_highlight', hex: '#FF7A5C', use: 'specular highlight' },
      { key: 'crown', hex: '#3E9B3F', use: 'calyx and stem' },
      { key: 'crown_shadow', hex: '#2C7A31', use: 'calyx shadow' },
      { key: 'iris', hex: '#3B2A20', use: 'eyes' },
    ],
    signature: ['curled stem tilted to the right', 'four soft vertical lobes on the head'],
    outfitColors: ['#2F6FDB', '#F4F1EA', '#1F2A44'],
  },
  nova: {
    species: 'anthropomorphic strawberry',
    head: 'Rounded heart-shaped strawberry head, widest at the brow and tapering gently toward the chin.',
    crown: 'Ruff of five broad pointed green sepals lying flat around the top, with a small upright stem in the centre.',
    surface: 'Soft satin skin with small golden seeds in an even diamond pattern; seeds never cover the eyes, mouth or cheeks.',
    face: 'Big round eyes with dark plum irises and two white catchlights, soft arched brows, tiny nose, rounded smiling mouth, pink cheek blush.',
    palette: [
      { key: 'skin', hex: '#E23D57', use: 'head, hands, legs' },
      { key: 'skin_shadow', hex: '#A8293F', use: 'shadows, brows' },
      { key: 'skin_highlight', hex: '#FF8197', use: 'highlight' },
      { key: 'seeds', hex: '#F5D06A', use: 'seed pattern' },
      { key: 'crown', hex: '#4FAE4A', use: 'sepals and stem' },
      { key: 'iris', hex: '#2E2230', use: 'eyes' },
    ],
    signature: ['diamond seed pattern', 'flat five-sepal ruff with a centred stem'],
    outfitColors: ['#F7F0E3', '#7CC6A4', '#5B4B8A'],
  },
  adam: {
    species: 'anthropomorphic potato',
    head: 'Oval, gently lumpy potato head, a little taller than wide, with a soft asymmetric bump on the upper left.',
    crown: 'Two-leaf green sprout growing from the top; the left leaf is larger than the right.',
    surface: 'Matte, softly textured skin with three small darker “potato eye” spots: one on the upper left forehead, two on the right cheek.',
    face: 'Small bright eyes with dark brown irises and one white catchlight each, expressive brows, round button nose, friendly wide mouth.',
    palette: [
      { key: 'skin', hex: '#C99A62', use: 'head, hands, legs' },
      { key: 'skin_shadow', hex: '#9A7146', use: 'shadows, brows' },
      { key: 'skin_highlight', hex: '#E3BE8A', use: 'highlight' },
      { key: 'spots', hex: '#8C6A43', use: 'potato eye spots' },
      { key: 'crown', hex: '#6CBF4B', use: 'sprout leaves' },
      { key: 'iris', hex: '#2B2118', use: 'eyes' },
    ],
    signature: ['three potato-eye spots in fixed positions', 'two-leaf sprout, left leaf larger'],
    outfitColors: ['#3D5A80', '#E0A526', '#F2EBDD'],
  },
};

interface VariantCanon {
  age_group: 'child' | 'adult' | 'elder';
  gender: 'male' | 'female';
  label: string;
  body: string;
  proportions: CharacterSpec['proportions'];
  details: string[];
  everyday: string;
  special: string;
  specialName: string;
}

const VARIANT: Record<CharacterVariant, VariantCanon> = {
  boy: {
    age_group: 'child', gender: 'male', label: 'young boy',
    body: 'Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 2.6, head_width_to_shoulders: 1.5, posture: 'upright, energetic, slight forward lean' },
    details: ['small cap worn backwards on special occasions only'],
    everyday: 'Striped T-shirt, knee-length shorts and sneakers.',
    special: 'Hoodie with a small leaf badge, joggers and sneakers.', specialName: 'Weekend',
  },
  girl: {
    age_group: 'child', gender: 'female', label: 'young girl',
    body: 'Small rounded child body, short arms and legs, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 2.6, head_width_to_shoulders: 1.5, posture: 'upright, lively, light on her feet' },
    details: ['small hair clip shaped like a flower attached to the crown'],
    everyday: 'Short-sleeved dress over leggings and sneakers.',
    special: 'Dungarees over a T-shirt with rolled cuffs and sneakers.', specialName: 'Play day',
  },
  man: {
    age_group: 'adult', gender: 'male', label: 'adult man',
    body: 'Adult body with broader shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 3.4, head_width_to_shoulders: 1.15, posture: 'relaxed and confident' },
    details: ['short neat brows'],
    everyday: 'Button-up shirt with rolled sleeves, chinos and casual shoes.',
    special: 'Light jacket over a crew-neck T-shirt, dark trousers.', specialName: 'Smart casual',
  },
  woman: {
    age_group: 'adult', gender: 'female', label: 'adult woman',
    body: 'Adult body with slimmer shoulders, medium-length limbs, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 3.4, head_width_to_shoulders: 1.2, posture: 'poised and warm' },
    details: ['soft eyelashes', 'small earrings'],
    everyday: 'Blouse, straight trousers and flats.',
    special: 'Long cardigan over a knit top, midi skirt and ankle boots.', specialName: 'Smart casual',
  },
  elder_man: {
    age_group: 'elder', gender: 'male', label: 'elderly man',
    body: 'Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 3.2, head_width_to_shoulders: 1.2, posture: 'gentle forward lean, calm and dignified' },
    details: ['round glasses', 'bushy light-grey brows', 'gentle smile lines around the eyes'],
    everyday: 'Cardigan over a collared shirt, comfortable trousers and slippers.',
    special: 'Tweed vest, bow tie and polished shoes; optional walking stick.', specialName: 'Celebration',
  },
  elder_woman: {
    age_group: 'elder', gender: 'female', label: 'elderly woman',
    body: 'Slightly smaller adult body, gentle forward posture, four-finger cartoon hands, skin-coloured limbs.',
    proportions: { height_in_heads: 3.2, head_width_to_shoulders: 1.25, posture: 'gentle forward lean, warm and wise' },
    details: ['glasses on a thin chain', 'soft eyelashes', 'gentle smile lines around the eyes'],
    everyday: 'Knitted shawl over a long-sleeved dress and comfortable shoes.',
    special: 'Patterned headscarf, embroidered jacket and long skirt.', specialName: 'Celebration',
  },
};

const EXPRESSIONS: Record<ExpressionKey, string> = {
  neutral: 'Relaxed face, eyes open, mouth closed in a soft line.',
  happy: 'Eyes slightly squinted, wide closed-mouth smile, cheeks lifted.',
  laughing: 'Eyes closed in arcs, open mouth laugh, head tilted back slightly.',
  surprised: 'Eyes wide, brows raised high, small round open mouth.',
  sad: 'Brows tilted up in the middle, eyes glossy, mouth turned down.',
  thinking: 'One brow raised, eyes looking up and to the side, mouth pushed to one side.',
  determined: 'Brows lowered and angled, focused eyes, firm closed mouth.',
  worried: 'Brows pinched together, eyes looking aside, small tense mouth.',
};

export const NEGATIVE_PROMPT = [
  'realistic human skin or human face',
  'hair on the head (the crown replaces hair)',
  'more or fewer than four fingers per hand',
  'extra limbs or duplicated features',
  'changing the family colour, crown shape or face layout',
  'text, logos or watermarks',
  'scary, violent or adult content',
  'photorealistic food textures',
];

/** Personality per age group, as in the existing catalog (`character_catalog.tone`). */
const TONE_BY_AGE: Record<VariantCanon['age_group'], string> = {
  child: 'playful and curious',
  adult: 'expressive and confident',
  elder: 'warm and wise',
};

function buildSpec(family: CharacterFamily, variant: CharacterVariant, tone: string): CharacterSpec {
  const f = FAMILY[family];
  const v = VARIANT[variant];
  const id = `${family}_${variant}`;
  const outfits: Outfit[] = [
    { key: 'everyday', name: 'Everyday', description: v.everyday, colors: [f.outfitColors[0]!, f.outfitColors[1]!] },
    { key: 'special', name: v.specialName, description: v.special, colors: [f.outfitColors[2]!, f.outfitColors[1]!] },
  ];
  const lockedColors = f.palette.filter((p) => ['skin', 'crown', 'iris'].includes(p.key)).map((p) => `${p.key} ${p.hex}`);
  const identity = [
    `${family.toUpperCase()} ${v.label}: premium stylized 3D ${f.species} character for a family-friendly animated series.`,
    f.head,
    f.crown,
    f.surface,
    f.face,
    v.body,
    `About ${v.proportions.height_in_heads} heads tall; ${v.proportions.posture}.`,
    `Colours: ${lockedColors.join(', ')}.`,
    `Details: ${[...f.signature, ...v.details].join('; ')}.`,
  ].join(' ');
  return {
    character_id: id,
    family,
    variant,
    species: f.species,
    render_style: 'Premium stylized 3D, animated-feature quality, soft global illumination, clean shapes, no photorealism.',
    age_group: v.age_group,
    gender: v.gender,
    personality: tone,
    head: f.head,
    crown: f.crown,
    surface: f.surface,
    face: f.face,
    body: v.body,
    proportions: v.proportions,
    palette: f.palette,
    signature_details: [...f.signature, ...v.details],
    outfits,
    expressions: (Object.keys(EXPRESSIONS) as ExpressionKey[]).map((key) => ({ key, description: EXPRESSIONS[key] })),
    required_views: REQUIRED_VIEWS,
    consistency: {
      identity_prompt: identity,
      negative_prompt: NEGATIVE_PROMPT,
      locked_colors: lockedColors,
      rules: [
        'Approved reference images take priority over text when both are available.',
        'Keep the crown, face layout and family colours identical in every shot.',
        'Only the outfit and expression may change between scenes.',
        'Keep the height relationship between variants (child 2.6, adult 3.4, elder 3.2 heads).',
      ],
    },
  };
}

export const CANON: readonly CharacterSpec[] = CHARACTER_FAMILIES.flatMap((family) =>
  CHARACTER_VARIANTS.map((variant) => buildSpec(family, variant, TONE_BY_AGE[VARIANT[variant].age_group])),
);

export function canonFor(characterId: string): CharacterSpec | undefined {
  return CANON.find((c) => c.character_id === characterId);
}
