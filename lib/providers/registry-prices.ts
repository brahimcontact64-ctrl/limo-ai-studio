/**
 * Runtime prices come from ai_provider_registry (owner-maintained): `pricing_metadata` holds the published prices
 * and `verified_at` is set only when the owner has confirmed them against the official page. A row without
 * verified_at, or without a price for the unit an operation consumes, yields an unverified/incomplete sheet, and
 * operationCost (and therefore every paid call) refuses it.
 */
import type { PriceSheet } from './contracts.ts';

export interface RegistryRow {
  code: string;
  provider: string;
  stage_type: string;
  model_id: string;
  credential_env_key: string;
  enabled: boolean;
  is_default: boolean;
  pricing_unit: string;
  pricing_metadata: Record<string, unknown> | null;
  official_reference: string | null;
  verified_at: string | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const tiered = (v: unknown, tier?: string) => (v && typeof v === 'object' && tier ? num((v as Record<string, unknown>)[tier]) : num(v));
const micros = (usd: number | undefined) => (usd === undefined ? undefined : Math.round(usd * 1_000_000));

/** Price sheet for one registry row (tier = image size "1K" or video resolution "720p" where prices differ). */
export function sheetFromRegistry(row: RegistryRow, tier?: string): PriceSheet {
  const m = row.pricing_metadata ?? {};
  const prices: PriceSheet['prices'] = {};
  const set = (k: keyof PriceSheet['prices'], v: number | undefined) => {
    if (v !== undefined) prices[k] = v;
  };
  set('input_tokens_1m', micros(num(m.usd_per_1m_input_tokens)));
  set('output_tokens_1m', micros(num(m.usd_per_1m_output_tokens)));
  set('image', micros(tiered(m.usd_per_image, tier)));
  set('video_second', micros(tiered(m.usd_per_second, tier)));
  set('characters_1k', micros(num(m.usd_per_1k_characters)));
  set('audio_minute', micros(num(m.usd_per_minute)));
  set('request', micros(num(m.usd_per_request)));
  if (row.pricing_unit === 'free') prices.request = 0;
  return {
    provider: row.provider, model: row.model_id, currency: 'USD', prices, source: row.official_reference ?? '',
    verifiedAt: row.verified_at, verifiedBy: row.verified_at ? `registry:${row.code}` : null,
    ...(typeof m.price_valid_until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.price_valid_until) ? { validUntil: m.price_valid_until } : {}),
  };
}
