import type { ImageBrief } from './types.ts';

const S = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Customer-typed advertising text (never generated): headline, product name, price, offer, CTA, body. */
export function parseBrief(v: unknown): ImageBrief {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { headline: S(b.headline, 200), product_name: S(b.product_name, 120), price: S(b.price, 60), offer: S(b.offer, 160), cta: S(b.cta, 80), body: S(b.body, 600) };
}
