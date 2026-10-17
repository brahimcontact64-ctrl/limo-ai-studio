import { fontString, isRtl, wrapText, type Ctx2D } from '../images/render.ts';
import type { ImageDoc, Layer, TextLayer } from '../images/types.ts';
import type { RenderSpec, SpecScene } from './types.ts';

/**
 * Per-scene overlay drawn with the Image Studio renderer and composited over the scene by FFmpeg:
 * on-screen text (from the approved script), optional subtitles (narration or dialogue), the brand logo.
 * Scenes without any picture or clip become an honest text card (brand colours + the scene's text);
 * nothing is drawn to look like footage or characters.
 */
const TEXT_SIZE = { small: 0.042, medium: 0.058, large: 0.078 } as const;

/** Font families the renderer has installed: Latin text, and right-to-left (Arabic) text. */
export interface OverlayFonts {
  latin: string;
  rtl: string;
}
const DEFAULT_FONTS: OverlayFonts = { latin: 'Arial', rtl: 'Tahoma' };
const CLEAR = 'rgba(0,0,0,0)';

function textLayer(fonts: OverlayFonts, id: string, content: string, x: number, y: number, w: number, size: number, extra: Partial<TextLayer> = {}): TextLayer {
  return {
    id, name: id, type: 'text', x, y, w, h: size * 1.3, rotation: 0, opacity: 1, visible: true, locked: false,
    // The canvas engine does not fall back per glyph, so Arabic text gets a font that contains Arabic.
    content, font: isRtl(content) ? fonts.rtl : fonts.latin, size, weight: 700, italic: false, color: '#ffffff', align: 'center', line_height: 1.25,
    background: 'rgba(24,20,33,0.72)', padding: Math.round(size * 0.45), radius: Math.round(size * 0.35), role: 'caption', ...extra,
  };
}

/** Gives a text layer the height its wrapped lines need (measured with the real font). */
export function fitHeight(ctx: Pick<Ctx2D, 'measureText' | 'font'>, l: TextLayer): TextLayer {
  ctx.font = fontString(l);
  const lines = wrapText(ctx, l.content, Math.max(4, l.w - l.padding * 2));
  return { ...l, h: Math.ceil(lines.length * l.size * l.line_height + l.padding * 2) };
}

export function subtitleText(spec: Pick<RenderSpec, 'subtitles'>, scene: Pick<SpecScene, 'narration' | 'dialogue'>): string {
  if (spec.subtitles === 'narration') return scene.narration.trim();
  if (spec.subtitles === 'dialogue') return scene.dialogue.trim();
  return '';
}

export function sceneOverlay(spec: RenderSpec, scene: SpecScene, ctx: Pick<Ctx2D, 'measureText' | 'font'>, fonts: OverlayFonts = DEFAULT_FONTS): ImageDoc {
  const W = spec.width;
  const H = spec.height;
  const unit = Math.min(W, H);
  const m = Math.round(unit * 0.06);
  const layers: Layer[] = [];
  const card = !scene.visual;
  const background: ImageDoc['background'] = card ? { kind: 'gradient', from: spec.brand.primary, to: spec.brand.secondary, angle: 135 } : { kind: 'color', color: CLEAR };

  const sub = subtitleText(spec, scene);
  let bottom = H - m;
  if (sub) {
    const l = fitHeight(ctx, textLayer(fonts, 'subtitle', sub, m, 0, W - m * 2, Math.round(unit * 0.036), { weight: 400 }));
    l.y = bottom - l.h;
    bottom = l.y - Math.round(unit * 0.02);
    layers.push(l);
  }

  // Text cards always show the scene's words; otherwise on-screen text only when the user keeps it.
  const words = scene.on_screen_text.trim() || (card ? scene.title.trim() : '');
  if (words && (scene.show_text || card)) {
    const size = Math.round(unit * (card ? TEXT_SIZE.large : TEXT_SIZE[spec.text_size]));
    const l = fitHeight(ctx, textLayer(fonts, 'text', words, m, 0, W - m * 2, size, { weight: 900, background: card ? null : 'rgba(24,20,33,0.72)' }));
    const pos = card ? 'center' : spec.text_position;
    l.y = pos === 'top' ? m + (spec.logo ? Math.round(unit * 0.19) : 0) : pos === 'center' ? Math.round((H - l.h) / 2) : bottom - l.h;
    layers.push(l);
  }

  if (spec.logo) {
    const lw = Math.round(unit * 0.16);
    layers.push({ id: 'logo', name: 'logo', type: 'image', x: W - m - lw, y: m, w: lw, h: lw, rotation: 0, opacity: 1, visible: true, locked: false, asset_id: spec.logo.asset_id, fit: 'contain', crop: null, radius: 0, role: 'logo' });
  }
  return { version: 1, width: W, height: H, background, layers, meta: { generator: 'video-overlay-v1' } };
}
