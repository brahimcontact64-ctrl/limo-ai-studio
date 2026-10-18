import { createHash } from 'node:crypto';
import type { Provenance } from './contracts.ts';

export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

/** Idempotency key for one provider operation: the same inputs never create (or pay for) a second generation. */
export function operationKey(parts: Array<string | number | null | undefined>): string {
  return sha256(parts.map((p) => String(p ?? '')).join('␟')).slice(0, 40);
}

/** Compact provenance stored with the media asset (metadata) and the generation stage (output_payload). */
export function provenanceRecord(p: Provenance): Record<string, unknown> {
  return {
    ai_generated: p.aiGenerated, mock: p.mock, capability: p.capability, provider: p.provider, model: p.model, model_version: p.modelVersion,
    request_key: p.requestKey, prompt_sha256: p.promptSha256, input_asset_ids: p.inputAssetIds, reference_asset_ids: p.referenceAssetIds,
    character_spec_versions: p.characterSpecVersions, content_credentials: p.contentCredentials, provider_request_id: p.providerRequestId ?? null,
    cost_micros: p.costMicros, currency: p.currency, created_at: p.createdAt,
  };
}
