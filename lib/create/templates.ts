import { newScene } from '../studio/draft.ts';
import type { SceneDraft } from '../studio/types.ts';
import type { Brief, CreationMode } from './modes.ts';

/**
 * Starter scene structure per creation mode. Deterministic, not AI.
 * On-screen text only ever copies what the user typed (product name, offer, price, CTA…):
 * nothing is invented (spec §7). Durations respect the 1–15 s scene limit.
 */
const DURATIONS: Record<CreationMode, number[]> = {
  product_ad: [3, 4, 5, 3, 3],
  business_promo: [3, 5, 5, 3, 3],
  social_video: [3, 6, 6, 3],
  social_post: [5],
  story: [8, 8, 8, 8],
  explainer: [4, 8, 8, 8, 5],
  ugc_ad: [3, 5, 6, 5, 3],
  custom: [8],
};

const str = (v: Brief[string] | undefined) => (typeof v === 'string' ? v : '');
const list = (v: Brief[string] | undefined) => (Array.isArray(v) ? v : []);

function onScreenText(mode: CreationMode, index: number, b: Brief): string {
  const cta = str(b.callToAction);
  switch (mode) {
    case 'product_ad':
      return [str(b.productName), str(b.productName), list(b.sellingPoints).slice(0, 3).join(' · '), [str(b.price), str(b.offer)].filter(Boolean).join(' — '), cta][index] ?? '';
    case 'business_promo':
      return [str(b.businessName), str(b.businessType), '', str(b.offer), [cta, str(b.location)].filter(Boolean).join(' — ')][index] ?? '';
    case 'social_video':
      return [str(b.hook), list(b.keyPoints)[0] ?? '', list(b.keyPoints)[1] ?? '', cta][index] ?? '';
    case 'social_post':
      return str(b.topic);
    case 'explainer':
      return [str(b.topic), ...list(b.keyPoints).slice(0, 3), ''][index] ?? '';
    case 'ugc_ad':
      return ['', str(b.problem), str(b.productName), '', cta][index] ?? '';
    default:
      return '';
  }
}

/** Product photos (or other selected assets) go to the scenes that show the product. */
function sceneAssets(mode: CreationMode, index: number, assetIds: string[]): string[] {
  if (assetIds.length === 0) return [];
  if (mode === 'product_ad' && (index === 0 || index === 1 || index === 3)) return [assetIds[index % assetIds.length]!];
  if (mode === 'ugc_ad' && index === 2) return [assetIds[0]!];
  if ((mode === 'business_promo' || mode === 'social_video') && index < assetIds.length) return [assetIds[index]!];
  if (mode === 'social_post' && index === 0) return [assetIds[0]!];
  return [];
}

export function buildStarterScenes(mode: CreationMode, brief: Brief, titles: readonly string[], assetIds: string[] = []): SceneDraft[] {
  const durations = DURATIONS[mode];
  return durations.map((duration, i) =>
    newScene({
      title: titles[i] ?? '',
      duration_seconds: duration,
      on_screen_text: onScreenText(mode, i, brief).slice(0, 1500),
      asset_ids: sceneAssets(mode, i, assetIds),
    }),
  );
}
