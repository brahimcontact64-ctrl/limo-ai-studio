import { imageGeometry } from './doc.ts';
import type { ImageDoc, Layer, TextLayer } from './types.ts';

/** The subset of CanvasRenderingContext2D the renderer uses (tests pass a recording fake). */
export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  fill(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  fillStyle: unknown;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  direction?: string;
}

export interface LoadedImage {
  source: unknown;
  width: number;
  height: number;
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export function isRtl(text: string): boolean {
  return RTL.test(text);
}

export function fontString(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>): string {
  return `${l.italic ? 'italic ' : ''}${l.weight} ${l.size}px "${l.font}", Arial, sans-serif`;
}

/** Splits text into lines that fit maxWidth (explicit newlines kept; very long words broken by character). */
export function wrapText(ctx: Pick<Ctx2D, 'measureText'>, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        if (!line && ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawLayer(ctx: Ctx2D, l: Layer, images: ReadonlyMap<string, LoadedImage>) {
  ctx.save();
  ctx.globalAlpha = l.opacity;
  if (l.rotation) {
    ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.translate(-(l.x + l.w / 2), -(l.y + l.h / 2));
  }
  if (l.type === 'shape') {
    ctx.fillStyle = l.fill;
    if (l.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(l.x + l.w / 2, l.y + l.h / 2, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
    } else roundRectPath(ctx, l.x, l.y, l.w, l.h, l.radius);
    ctx.fill();
  } else if (l.type === 'image') {
    const img = images.get(l.asset_id);
    if (img && img.width > 0 && img.height > 0) {
      const g = imageGeometry(l, img);
      if (l.radius > 0) {
        roundRectPath(ctx, g.dx, g.dy, g.dw, g.dh, l.radius);
        ctx.clip();
      }
      ctx.drawImage(img.source, g.sx, g.sy, g.sw, g.sh, g.dx, g.dy, g.dw, g.dh);
    } else {
      // File not loaded (or no access): a neutral box keeps the layout honest; nothing is invented.
      ctx.fillStyle = '#e6e2f3';
      roundRectPath(ctx, l.x, l.y, l.w, l.h, l.radius);
      ctx.fill();
    }
  } else {
    if (l.background) {
      ctx.fillStyle = l.background;
      roundRectPath(ctx, l.x, l.y, l.w, l.h, l.radius);
      ctx.fill();
    }
    ctx.font = fontString(l);
    ctx.fillStyle = l.color;
    ctx.textBaseline = 'top';
    const rtl = isRtl(l.content);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    const inner = Math.max(4, l.w - l.padding * 2);
    const lines = wrapText(ctx, l.content, inner);
    const lh = l.size * l.line_height;
    const total = lines.length * lh;
    let y = l.y + Math.max(l.padding, (l.h - total) / 2);
    const align = l.align === 'center' ? 'center' : (l.align === 'left') !== rtl ? 'left' : 'right';
    ctx.textAlign = align;
    const x = align === 'center' ? l.x + l.w / 2 : align === 'left' ? l.x + l.padding : l.x + l.w - l.padding;
    for (const line of lines) {
      ctx.fillText(line, x, y + (lh - l.size) / 2);
      y += lh;
    }
  }
  ctx.restore();
}

/** Draws the whole document at `scale` (1 = document pixels). */
export function renderDoc(ctx: Ctx2D, doc: ImageDoc, images: ReadonlyMap<string, LoadedImage>, scale = 1) {
  ctx.save();
  ctx.scale(scale, scale);
  if (doc.background.kind === 'gradient') {
    const a = (doc.background.angle * Math.PI) / 180;
    const cx = doc.width / 2;
    const cy = doc.height / 2;
    const r = Math.hypot(doc.width, doc.height) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, doc.background.from);
    g.addColorStop(1, doc.background.to);
    ctx.fillStyle = g;
  } else ctx.fillStyle = doc.background.color;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const l of doc.layers) if (l.visible) drawLayer(ctx, l, images);
  ctx.restore();
}
