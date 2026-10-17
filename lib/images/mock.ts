import { ASPECT_SIZE, type Aspect, type ImageBrief, type ImageDoc, type ImagePurpose, type ImageStyle, type Layer, type TextRole } from './types.ts';
import { layerId } from './doc.ts';

/**
 * Deterministic "mock layout" generator. It is NOT an AI image model: it arranges the customer's own
 * photos, logo, brand colours and typed text into four layout variations. It never invents products,
 * prices, offers or claims; anything missing becomes a visible [placeholder] that blocks approval.
 * Every result is labelled "Mock layout — not AI artwork".
 */
export const MOCK_LABEL = 'Mock layout — not AI artwork';
export const VARIATIONS = ['hero', 'split', 'overlay', 'minimal'] as const;
export type Variation = (typeof VARIATIONS)[number];

export interface MockInput {
  purpose: ImagePurpose;
  aspect: Aspect;
  style: ImageStyle;
  prompt: string;
  brief: ImageBrief;
  /** Workspace image assets: first is the main photo (product photo for ads). */
  photos: string[];
  logo: string | null;
  brand: { primary: string; secondary: string; name: string; cta: string };
  characters?: Array<{ ref: string; name: string; identity: string | null; reference_status: string }>;
}

interface StylePreset {
  font: string;
  weight: 700 | 900;
  bg: (b: MockInput['brand']) => ImageDoc['background'];
  text: string;
  accent: (b: MockInput['brand']) => string;
}

const STYLES: Record<ImageStyle, StylePreset> = {
  modern: { font: 'Arial', weight: 900, bg: (b) => ({ kind: 'gradient', from: b.primary, to: b.secondary, angle: 135 }), text: '#ffffff', accent: () => '#ffffff' },
  bold: { font: 'Verdana', weight: 900, bg: (b) => ({ kind: 'color', color: b.primary }), text: '#ffffff', accent: () => '#ffd84d' },
  elegant: { font: 'Georgia', weight: 700, bg: () => ({ kind: 'color', color: '#1d1a24' }), text: '#f5efe2', accent: () => '#c9a96e' },
  playful: { font: 'Trebuchet MS', weight: 900, bg: () => ({ kind: 'gradient', from: '#ff8a5b', to: '#ffd166', angle: 120 }), text: '#2b1d0e', accent: (b) => b.primary },
  minimal: { font: 'Helvetica', weight: 700, bg: () => ({ kind: 'color', color: '#ffffff' }), text: '#211e2b', accent: (b) => b.primary },
  natural: { font: 'Georgia', weight: 700, bg: () => ({ kind: 'color', color: '#f1ede4' }), text: '#33402a', accent: () => '#5f7f3a' },
};

/** Readable text colour on a solid fill (WCAG relative luminance). */
export function inkOn(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return lum > 0.4 ? '#1d1a24' : '#ffffff';
}

const firstSentence = (t: string) => (t.trim().split(/(?<=[.!?؟])\s+/)[0] ?? '').trim().slice(0, 90);

/** Headline from the customer's own words: headline field, then product name, then the description. */
export function headlineFrom(input: Pick<MockInput, 'brief' | 'prompt'>): string {
  return input.brief.headline.trim() || input.brief.product_name.trim() || firstSentence(input.prompt) || '[Headline]';
}

function text(content: string, role: TextRole, box: { x: number; y: number; w: number; h: number }, s: StylePreset, extra: Record<string, unknown> = {}): Layer {
  return {
    id: layerId(), name: role, type: 'text', ...box, rotation: 0, opacity: 1, visible: true, locked: false,
    content, font: s.font, size: 64, weight: s.weight, italic: false, color: s.text, align: 'center', line_height: 1.15, background: null, padding: 0, radius: 0, role,
    ...extra,
  } as Layer;
}

function image(assetId: string, role: 'product' | 'logo' | 'photo' | 'reference', box: { x: number; y: number; w: number; h: number }, fit: 'cover' | 'contain', radius = 0): Layer {
  return { id: layerId(), name: role, type: 'image', ...box, rotation: 0, opacity: 1, visible: true, locked: false, asset_id: assetId, fit, crop: null, radius, role };
}

function shape(box: { x: number; y: number; w: number; h: number }, fill: string, radius: number, opacity = 1): Layer {
  return { id: layerId(), name: 'shape', type: 'shape', ...box, rotation: 0, opacity, visible: true, locked: false, shape: 'rect', fill, radius };
}

export function generateVariation(input: MockInput, variation: Variation): ImageDoc {
  const { width: W, height: H } = ASPECT_SIZE[input.aspect];
  const s = STYLES[input.style];
  const portrait = H > W;
  const unit = Math.min(W, H);
  const layers: Layer[] = [];
  const photo = input.photos[0] ?? null;
  const needsPhoto = input.purpose === 'product_ad';
  const headline = headlineFrom(input);
  const m = Math.round(unit * 0.06);
  let background = s.bg(input.brand);

  const photoBox = (box: { x: number; y: number; w: number; h: number }, fit: 'cover' | 'contain', radius = 0) => {
    if (photo) layers.push(image(photo, needsPhoto ? 'product' : 'photo', box, fit, radius));
    else if (needsPhoto) {
      layers.push(shape(box, '#ffffff', Math.round(unit * 0.03), 0.35));
      layers.push(text('[Add a product photo]', 'caption', { x: box.x, y: box.y + box.h / 2 - unit * 0.05, w: box.w, h: unit * 0.1 }, s, { size: Math.round(unit * 0.035), weight: 700 }));
    }
  };

  if (variation === 'hero') {
    layers.push(text(headline, 'headline', { x: m, y: m, w: W - m * 2, h: Math.round(H * 0.18) }, s, { size: Math.round(unit * 0.075) }));
    photoBox({ x: Math.round(W * 0.15), y: Math.round(H * 0.24), w: Math.round(W * 0.7), h: Math.round(H * (portrait ? 0.46 : 0.5)) }, 'contain');
  } else if (variation === 'split') {
    if (portrait) {
      photoBox({ x: 0, y: 0, w: W, h: Math.round(H * 0.55) }, 'cover');
      layers.push(text(headline, 'headline', { x: m, y: Math.round(H * 0.58), w: W - m * 2, h: Math.round(H * 0.14) }, s, { size: Math.round(unit * 0.07), align: 'left' }));
    } else {
      photoBox({ x: 0, y: 0, w: Math.round(W * 0.5), h: H }, 'cover');
      layers.push(text(headline, 'headline', { x: Math.round(W * 0.54), y: Math.round(H * 0.18), w: Math.round(W * 0.42), h: Math.round(H * 0.3) }, s, { size: Math.round(unit * 0.075), align: 'left' }));
    }
  } else if (variation === 'overlay') {
    if (photo) {
      layers.push(image(photo, needsPhoto ? 'product' : 'photo', { x: 0, y: 0, w: W, h: H }, 'cover'));
      layers.push(shape({ x: 0, y: Math.round(H * 0.6), w: W, h: Math.round(H * 0.4) }, '#000000', 0, 0.45));
      background = { kind: 'color', color: '#000000' };
    } else photoBox({ x: m, y: m, w: W - m * 2, h: Math.round(H * 0.55) }, 'cover', Math.round(unit * 0.03));
    layers.push(text(headline, 'headline', { x: m, y: Math.round(H * 0.64), w: W - m * 2, h: Math.round(H * 0.14) }, { ...s, text: photo ? '#ffffff' : s.text }, { size: Math.round(unit * 0.07) }));
  } else {
    background = { kind: 'color', color: input.style === 'elegant' ? '#1d1a24' : '#ffffff' };
    photoBox({ x: Math.round(W * 0.2), y: Math.round(H * 0.12), w: Math.round(W * 0.6), h: Math.round(H * 0.5) }, 'contain', Math.round(unit * 0.02));
    layers.push(text(headline, 'headline', { x: m, y: Math.round(H * 0.66), w: W - m * 2, h: Math.round(H * 0.1) }, { ...s, text: input.style === 'elegant' ? '#f5efe2' : '#211e2b' }, { size: Math.round(unit * 0.055) }));
  }

  // Customer-typed details only (price, offer, call to action, body); nothing is invented.
  const lower = Math.round(H * (variation === 'split' && !portrait ? 0.52 : 0.8));
  const leftCol = variation === 'split' && !portrait ? Math.round(W * 0.54) : m;
  const colW = variation === 'split' && !portrait ? Math.round(W * 0.42) : W - m * 2;
  if (input.brief.body.trim()) layers.push(text(input.brief.body.trim(), 'body', { x: leftCol, y: lower - Math.round(unit * 0.12), w: colW, h: Math.round(unit * 0.1) }, s, { size: Math.round(unit * 0.032), weight: 400 }));
  const price = [input.brief.offer.trim(), input.brief.price.trim()].filter(Boolean);
  if (price.length) {
    const pw = Math.round(unit * 0.36);
    layers.push(text(price.join(' · '), input.brief.price.trim() ? 'price' : 'offer', { x: variation === 'hero' ? W - m - pw : leftCol, y: variation === 'hero' ? Math.round(H * 0.24) : lower, w: pw, h: Math.round(unit * 0.09) }, s, {
      size: Math.round(unit * 0.04), background: s.accent(input.brand), color: inkOn(s.accent(input.brand)), radius: Math.round(unit * 0.045), padding: Math.round(unit * 0.015),
    }));
  }
  const cta = input.brief.cta.trim() || input.brand.cta.trim();
  if (cta) {
    const cw = Math.round(unit * 0.5);
    // White button on light-text styles, brand-colour button otherwise; the label always stays readable.
    const ctaBg = s.text === '#ffffff' ? '#ffffff' : input.brand.primary;
    const ctaInk = inkOn(ctaBg) === '#ffffff' ? '#ffffff' : inkOn(input.brand.primary) === '#ffffff' ? input.brand.primary : '#1d1a24';
    layers.push(text(cta, 'cta', { x: variation === 'split' && !portrait ? leftCol : Math.round((W - cw) / 2), y: Math.round(H - m - unit * 0.1), w: cw, h: Math.round(unit * 0.09) }, s, {
      size: Math.round(unit * 0.036), background: ctaBg, color: ctaInk, radius: Math.round(unit * 0.045),
    }));
  }
  if (input.logo) {
    const lw = Math.round(unit * 0.14);
    layers.push(image(input.logo, 'logo', { x: W - m - lw, y: H - m - lw - (cta ? Math.round(unit * 0.12) : 0), w: lw, h: lw }, 'contain'));
  }

  // Story illustrations: canonical characters keep their identity; their artwork is honestly pending.
  if (input.purpose === 'story_illustration' && input.characters?.length) {
    const cs = input.characters.slice(0, 4);
    const bw = Math.round((W - m * (cs.length + 1)) / cs.length);
    cs.forEach((c, i) => {
      const box = { x: m + i * (bw + m), y: Math.round(H * 0.3), w: bw, h: Math.round(H * 0.4) };
      layers.push(shape(box, '#ffffff', Math.round(unit * 0.02), 0.3));
      layers.push(text(`[Character artwork pending: ${c.name}]`, 'caption', { x: box.x, y: box.y + box.h / 2 - unit * 0.06, w: box.w, h: unit * 0.12 }, s, { size: Math.round(unit * 0.026), weight: 700 }));
    });
  }

  return {
    version: 1,
    width: W,
    height: H,
    background,
    layers,
    meta: { generator: 'mock-layout-v1', variation, label: MOCK_LABEL, characters: input.characters },
  };
}

export function generateVariations(input: MockInput): ImageDoc[] {
  return VARIATIONS.map((v) => generateVariation(input, v));
}
