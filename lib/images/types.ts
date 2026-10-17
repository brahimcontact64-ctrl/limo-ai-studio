/**
 * Image Studio document model (Milestone 6).
 *
 * A design is a canvas size, a background and an ordered list of layers (bottom → top). Layers are
 * editable on their own: text stays text, images keep a reference to the original workspace file (never
 * altered), shapes stay shapes. The same document renders in the editor, in previews and in exports.
 */

export const IMAGE_PURPOSES = ['product_ad', 'social_post', 'banner', 'thumbnail', 'story_illustration', 'educational', 'custom'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export const ASPECTS = ['1:1', '4:5', '9:16', '16:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Canonical pixel sizes per aspect (social-ready). Exports may be rendered at 1× or 2×. */
export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

export const IMAGE_STYLES = ['modern', 'bold', 'elegant', 'playful', 'minimal', 'natural'] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];

/** Fonts available in every browser (canvas cannot use hashed web-font names); Tahoma and Arial cover Arabic. */
export const FONTS = ['Arial', 'Helvetica', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Courier New'] as const;

export type Background = { kind: 'color'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number };

export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

/** Crop rectangle as fractions (0–1) of the source image. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  asset_id: string;
  fit: 'cover' | 'contain';
  crop: Crop | null;
  radius: number;
  role: 'product' | 'logo' | 'photo' | 'reference';
}

export type TextRole = 'headline' | 'body' | 'price' | 'offer' | 'cta' | 'caption';

export interface TextLayer extends LayerBase {
  type: 'text';
  content: string;
  font: string;
  size: number;
  weight: 400 | 700 | 900;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  line_height: number;
  background: string | null;
  padding: number;
  radius: number;
  role: TextRole;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string;
  radius: number;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer;

export interface DocMeta {
  /** "mock-layout-v1" for documents started from the mock generator; "manual" otherwise. */
  generator: string;
  variation?: string;
  /** Shown wherever the design is listed: mock layouts are never AI artwork. */
  label?: string;
  /** Story illustrations: canonical character identities (Milestone 4 specs), kept with the design. */
  characters?: Array<{ ref: string; name: string; identity: string | null; reference_status: string }>;
}

export interface ImageDoc {
  version: 1;
  width: number;
  height: number;
  background: Background;
  layers: Layer[];
  meta: DocMeta;
}

export interface ImageBrief {
  headline: string;
  product_name: string;
  price: string;
  offer: string;
  cta: string;
  body: string;
}

export const EMPTY_BRIEF: ImageBrief = { headline: '', product_name: '', price: '', offer: '', cta: '', body: '' };

/** Placeholder text such as "[Add a product photo]" must be replaced before approval (enforced in the database too). */
export const PLACEHOLDER = /\[[^\]\n]{1,80}\]/;
