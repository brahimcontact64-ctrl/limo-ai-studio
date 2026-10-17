import { ASPECT_SIZE, FONTS, PLACEHOLDER, type Aspect, type Background, type Crop, type ImageDoc, type ImageLayer, type Layer, type ShapeLayer, type TextLayer } from './types.ts';

/** Limits shared with the database check (migration 20261017180000). */
export const DOC_LIMITS = { layers: 60, text: 1000, name: 80 } as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const O = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let counter = 0;
export function layerId(): string {
  counter = (counter + 1) % 1e6;
  return `l${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDoc(aspect: Aspect): ImageDoc {
  const s = ASPECT_SIZE[aspect];
  return { version: 1, width: s.width, height: s.height, background: { kind: 'color', color: '#f7f7fb' }, layers: [], meta: { generator: 'manual' } };
}

export function aspectOf(doc: Pick<ImageDoc, 'width' | 'height'>): Aspect | null {
  return (Object.entries(ASPECT_SIZE).find(([, s]) => s.width === doc.width && s.height === doc.height)?.[0] as Aspect) ?? null;
}

function normalizeCrop(v: unknown): Crop | null {
  const c = O(v);
  if (!('w' in c)) return null;
  const w = num(c.w, 1, 0.02, 1);
  const h = num(c.h, 1, 0.02, 1);
  return { x: num(c.x, 0, 0, 1 - w), y: num(c.y, 0, 0, 1 - h), w, h };
}

function normalizeLayer(raw: unknown, doc: { width: number; height: number }): Layer | null {
  const l = O(raw);
  const base = {
    id: str(l.id, 40) || layerId(),
    name: str(l.name, DOC_LIMITS.name),
    x: num(l.x, 0, -doc.width, doc.width * 2),
    y: num(l.y, 0, -doc.height, doc.height * 2),
    w: num(l.w, 100, 4, doc.width * 3),
    h: num(l.h, 100, 4, doc.height * 3),
    rotation: num(l.rotation, 0, -180, 180),
    opacity: num(l.opacity, 1, 0, 1),
    visible: l.visible !== false,
    locked: l.locked === true,
  };
  if (l.type === 'image') {
    const asset = str(l.asset_id, 36);
    if (!UUID.test(asset)) return null;
    const role = (['product', 'logo', 'photo', 'reference'] as const).find((r) => r === l.role) ?? 'photo';
    return { ...base, type: 'image', asset_id: asset.toLowerCase(), fit: l.fit === 'contain' ? 'contain' : 'cover', crop: normalizeCrop(l.crop), radius: num(l.radius, 0, 0, 2000), role };
  }
  if (l.type === 'text') {
    const role = (['headline', 'body', 'price', 'offer', 'cta', 'caption'] as const).find((r) => r === l.role) ?? 'body';
    return {
      ...base,
      type: 'text',
      content: str(l.content, DOC_LIMITS.text),
      font: (FONTS as readonly string[]).includes(l.font as string) ? (l.font as string) : 'Arial',
      size: num(l.size, 48, 8, 600),
      weight: l.weight === 900 ? 900 : l.weight === 700 ? 700 : 400,
      italic: l.italic === true,
      color: color(l.color, '#211e2b'),
      align: l.align === 'left' || l.align === 'right' ? l.align : 'center',
      line_height: num(l.line_height, 1.2, 0.8, 3),
      background: l.background === null || l.background === undefined ? null : color(l.background, '#ffffff'),
      padding: num(l.padding, 0, 0, 400),
      radius: num(l.radius, 0, 0, 2000),
      role,
    };
  }
  if (l.type === 'shape') {
    return { ...base, type: 'shape', shape: l.shape === 'ellipse' ? 'ellipse' : 'rect', fill: color(l.fill, '#7157ef'), radius: num(l.radius, 0, 0, 2000) };
  }
  return null;
}

/** Normalises an untrusted document. Unknown layer types and invalid asset ids are dropped. */
export function normalizeDoc(raw: unknown, aspect: Aspect): ImageDoc {
  const d = O(raw);
  const size = ASPECT_SIZE[aspect];
  const bg = O(d.background);
  const background: Background =
    bg.kind === 'gradient' ? { kind: 'gradient', from: color(bg.from, '#7056ed'), to: color(bg.to, '#927dff'), angle: num(bg.angle, 135, 0, 360) } : { kind: 'color', color: color(bg.color, '#f7f7fb') };
  const layers = (Array.isArray(d.layers) ? d.layers : [])
    .slice(0, DOC_LIMITS.layers)
    .map((l) => normalizeLayer(l, size))
    .filter((l): l is Layer => Boolean(l));
  const m = O(d.meta);
  const characters = Array.isArray(m.characters)
    ? m.characters.slice(0, 18).map((c) => {
        const o = O(c);
        return { ref: str(o.ref, 60), name: str(o.name, 80), identity: typeof o.identity === 'string' ? o.identity.slice(0, 4000) : null, reference_status: str(o.reference_status, 20, 'pending') };
      })
    : undefined;
  return {
    version: 1,
    width: size.width,
    height: size.height,
    background,
    layers,
    meta: { generator: str(m.generator, 40, 'manual'), variation: typeof m.variation === 'string' ? m.variation.slice(0, 40) : undefined, label: typeof m.label === 'string' ? m.label.slice(0, 120) : undefined, characters },
  };
}

export function assetIds(doc: ImageDoc): string[] {
  return [...new Set(doc.layers.filter((l): l is ImageLayer => l.type === 'image').map((l) => l.asset_id))];
}

/** Text layers that still contain a [placeholder]. */
export function placeholders(doc: ImageDoc): TextLayer[] {
  return doc.layers.filter((l): l is TextLayer => l.type === 'text' && l.visible && PLACEHOLDER.test(l.content));
}

// ---------- Layer factories ----------
export function newTextLayer(doc: ImageDoc, patch: Partial<TextLayer> = {}): TextLayer {
  const w = Math.round(doc.width * 0.8);
  return {
    id: layerId(), name: patch.role ?? 'text', type: 'text', x: Math.round((doc.width - w) / 2), y: Math.round(doc.height * 0.1), w, h: Math.round((patch.size ?? 72) * 1.4),
    rotation: 0, opacity: 1, visible: true, locked: false, content: 'Text', font: 'Arial', size: 72, weight: 700, italic: false, color: '#211e2b', align: 'center',
    line_height: 1.2, background: null, padding: 0, radius: 0, role: 'body', ...patch,
  };
}

export function newImageLayer(doc: ImageDoc, assetId: string, patch: Partial<ImageLayer> = {}): ImageLayer {
  const w = Math.round(doc.width * 0.6);
  const h = Math.round(Math.min(doc.height * 0.6, w));
  return {
    id: layerId(), name: patch.role ?? 'image', type: 'image', x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), w, h,
    rotation: 0, opacity: 1, visible: true, locked: false, asset_id: assetId, fit: 'contain', crop: null, radius: 0, role: 'photo', ...patch,
  };
}

export function newShapeLayer(doc: ImageDoc, patch: Partial<ShapeLayer> = {}): ShapeLayer {
  const w = Math.round(doc.width * 0.4);
  return {
    id: layerId(), name: 'shape', type: 'shape', x: Math.round((doc.width - w) / 2), y: Math.round(doc.height * 0.4), w, h: Math.round(w * 0.3),
    rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#7157ef', radius: 24, ...patch,
  };
}

// ---------- Edits (each returns a new document; only the targeted layer changes) ----------
export function updateLayer(doc: ImageDoc, id: string, patch: Partial<Layer>): ImageDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id && !l.locked ? ({ ...l, ...patch, type: l.type } as Layer) : l)) };
}

/** Lock/unlock always works (it is how a locked layer becomes editable again). */
export function setLocked(doc: ImageDoc, id: string, locked: boolean): ImageDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, locked } : l)) };
}

export function moveLayer(doc: ImageDoc, id: string, dx: number, dy: number): ImageDoc {
  const l = doc.layers.find((x) => x.id === id);
  return l ? updateLayer(doc, id, { x: Math.round(l.x + dx), y: Math.round(l.y + dy) }) : doc;
}

export function resizeLayer(doc: ImageDoc, id: string, w: number, h: number): ImageDoc {
  return updateLayer(doc, id, { w: Math.max(4, Math.round(w)), h: Math.max(4, Math.round(h)) });
}

export function addLayer(doc: ImageDoc, layer: Layer): ImageDoc {
  return doc.layers.length >= DOC_LIMITS.layers ? doc : { ...doc, layers: [...doc.layers, layer] };
}

export function removeLayer(doc: ImageDoc, id: string): ImageDoc {
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id || l.locked) };
}

export function duplicateLayer(doc: ImageDoc, id: string): ImageDoc {
  const l = doc.layers.find((x) => x.id === id);
  if (!l || doc.layers.length >= DOC_LIMITS.layers) return doc;
  const copy = { ...l, id: layerId(), x: l.x + 24, y: l.y + 24, locked: false } as Layer;
  const i = doc.layers.indexOf(l);
  return { ...doc, layers: [...doc.layers.slice(0, i + 1), copy, ...doc.layers.slice(i + 1)] };
}

/** delta +1 = one step towards the front. */
export function reorderLayer(doc: ImageDoc, id: string, delta: number): ImageDoc {
  const i = doc.layers.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  const [l] = layers.splice(i, 1);
  layers.splice(j, 0, l!);
  return { ...doc, layers };
}

/** Topmost visible layer at a point (document pixels); used for click-to-select on the canvas. */
export function hitTest(doc: ImageDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]!;
    if (l.visible && x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
  }
  return null;
}

/** Source rectangle (pixels of the original image) and destination rectangle for drawing an image layer. */
export function imageGeometry(layer: Pick<ImageLayer, 'x' | 'y' | 'w' | 'h' | 'fit' | 'crop'>, natural: { width: number; height: number }) {
  const c = layer.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  let sx = c.x * natural.width;
  let sy = c.y * natural.height;
  let sw = c.w * natural.width;
  let sh = c.h * natural.height;
  let dx = layer.x;
  let dy = layer.y;
  let dw = layer.w;
  let dh = layer.h;
  const srcRatio = sw / sh;
  const dstRatio = dw / dh;
  if (layer.fit === 'cover') {
    if (srcRatio > dstRatio) {
      const nw = sh * dstRatio;
      sx += (sw - nw) / 2;
      sw = nw;
    } else {
      const nh = sw / dstRatio;
      sy += (sh - nh) / 2;
      sh = nh;
    }
  } else if (srcRatio > dstRatio) {
    const nh = dw / srcRatio;
    dy += (dh - nh) / 2;
    dh = nh;
  } else {
    const nw = dh * srcRatio;
    dx += (dw - nw) / 2;
    dw = nw;
  }
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/** Zoom (≥1) and focus point (0–1) → crop rectangle; how the editor's crop controls work. */
export function cropFromZoom(zoom: number, fx: number, fy: number): Crop | null {
  if (zoom <= 1.0001) return null;
  const w = 1 / zoom;
  const h = 1 / zoom;
  return { x: Math.min(1 - w, Math.max(0, fx - w / 2)), y: Math.min(1 - h, Math.max(0, fy - h / 2)), w, h };
}
