/**
 * Creation modes ("Create Content — What would you like to create?").
 * Each mode declares only the inputs it needs; characters are required for 'story' only.
 * Brief values are stored in studio_projects.creation_brief (jsonb, < 32 KB).
 */
export const CREATION_MODES = ['product_ad', 'business_promo', 'social_video', 'social_post', 'story', 'explainer', 'ugc_ad', 'custom'] as const;
export type CreationMode = (typeof CREATION_MODES)[number];

export function isCreationMode(v: unknown): v is CreationMode {
  return typeof v === 'string' && (CREATION_MODES as readonly string[]).includes(v);
}

export type BriefFieldKind = 'text' | 'textarea' | 'list' | 'select';
export interface BriefField {
  key: string;
  kind: BriefFieldKind;
  max: number;
  /** For 'select': option codes (labels come from the dictionary). */
  options?: readonly string[];
  /** Factual marketing claims the user must confirm before publishing (spec §7). */
  claim?: boolean;
}

export const VISUAL_DIRECTIONS = ['realistic', 'cinematic', 'lifestyle', 'studio', 'luxury', 'stylized'] as const;
export const TONES = ['friendly', 'professional', 'playful', 'premium', 'energetic', 'calm'] as const;

const common: BriefField[] = [
  { key: 'audience', kind: 'text', max: 200 },
  { key: 'tone', kind: 'select', max: 40, options: TONES },
];

export const MODE_FIELDS: Record<CreationMode, BriefField[]> = {
  product_ad: [
    { key: 'productName', kind: 'text', max: 120 },
    { key: 'productDescription', kind: 'textarea', max: 1500 },
    { key: 'sellingPoints', kind: 'list', max: 160 },
    { key: 'price', kind: 'text', max: 60, claim: true },
    { key: 'offer', kind: 'text', max: 160, claim: true },
    { key: 'callToAction', kind: 'text', max: 120 },
    { key: 'visualDirection', kind: 'select', max: 40, options: VISUAL_DIRECTIONS },
    ...common,
  ],
  business_promo: [
    { key: 'businessName', kind: 'text', max: 120 },
    { key: 'businessType', kind: 'text', max: 120 },
    { key: 'location', kind: 'text', max: 160 },
    { key: 'offer', kind: 'text', max: 160, claim: true },
    { key: 'callToAction', kind: 'text', max: 120 },
    { key: 'visualDirection', kind: 'select', max: 40, options: VISUAL_DIRECTIONS },
    ...common,
  ],
  social_video: [
    { key: 'topic', kind: 'text', max: 200 },
    { key: 'hook', kind: 'text', max: 200 },
    { key: 'keyPoints', kind: 'list', max: 200 },
    { key: 'callToAction', kind: 'text', max: 120 },
    ...common,
  ],
  social_post: [
    { key: 'topic', kind: 'text', max: 200 },
    { key: 'callToAction', kind: 'text', max: 120 },
    { key: 'hashtags', kind: 'list', max: 60 },
    ...common,
  ],
  story: [
    { key: 'premise', kind: 'textarea', max: 1500 },
    { key: 'genre', kind: 'text', max: 80 },
    { key: 'moral', kind: 'text', max: 200 },
    ...common,
  ],
  explainer: [
    { key: 'topic', kind: 'text', max: 200 },
    { key: 'keyPoints', kind: 'list', max: 200 },
    { key: 'level', kind: 'select', max: 20, options: ['beginner', 'intermediate', 'advanced'] },
    ...common,
  ],
  ugc_ad: [
    { key: 'productName', kind: 'text', max: 120 },
    { key: 'problem', kind: 'text', max: 200 },
    { key: 'talkingPoints', kind: 'list', max: 200 },
    { key: 'callToAction', kind: 'text', max: 120 },
    ...common,
  ],
  custom: [{ key: 'description', kind: 'textarea', max: 2000 }, ...common],
};

/** Default content_type_catalog code per mode (user can change it). */
export const MODE_CONTENT_TYPE: Record<CreationMode, string> = {
  product_ad: 'product_ads',
  business_promo: 'business',
  social_video: 'entertainment',
  social_post: 'custom',
  story: 'storytelling',
  explainer: 'education',
  ugc_ad: 'ugc',
  custom: 'custom',
};

export const MODE_PRESET: Record<CreationMode, string> = {
  product_ad: 'vertical_9_16',
  business_promo: 'vertical_9_16',
  social_video: 'vertical_9_16',
  social_post: 'square_1_1',
  story: 'vertical_9_16',
  explainer: 'landscape_16_9',
  ugc_ad: 'vertical_9_16',
  custom: 'vertical_9_16',
};

export function requiresCharacters(mode: CreationMode): boolean {
  return mode === 'story';
}

export type Brief = Record<string, string | string[]>;

/** Keeps only declared fields, trims, enforces lengths and list sizes (max 8 items). */
export function sanitizeBrief(mode: CreationMode, raw: unknown): Brief {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Brief = {};
  for (const f of MODE_FIELDS[mode]) {
    const v = src[f.key];
    if (f.kind === 'list') {
      const items = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, f.max)).filter(Boolean).slice(0, 8) : [];
      if (items.length) out[f.key] = items;
    } else if (typeof v === 'string') {
      const s = v.trim().slice(0, f.max);
      if (f.kind === 'select' && f.options && !f.options.includes(s)) continue;
      if (s) out[f.key] = s;
    }
  }
  return out;
}

/** Fields the user marked as factual claims and must confirm (spec §7). */
export function claimFields(mode: CreationMode, brief: Brief): string[] {
  return MODE_FIELDS[mode].filter((f) => f.claim && brief[f.key]).map((f) => f.key);
}
