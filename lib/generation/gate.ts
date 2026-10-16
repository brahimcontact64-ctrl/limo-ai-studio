import type { ProviderAdapter, StageRequest } from './types.ts';

/**
 * Financial safety gate. Paid providers stay disabled unless ALL of these hold:
 *  1. LIMO_ENABLE_PAID_GENERATION === 'true' (server env, set deliberately by the owner),
 *  2. the cost policy is enabled and verified in the database (checked by request_studio_generation),
 *  3. the provider is enabled in ai_provider_registry,
 *  4. every character in a visual stage has an approved canonical reference.
 * Mock providers are always allowed.
 */
export class GenerationBlockedError extends Error {
  readonly reason: 'paid_generation_disabled' | 'provider_disabled' | 'missing_character_reference';
  constructor(reason: GenerationBlockedError['reason']) {
    super(reason);
    this.reason = reason;
  }
}

export interface GateContext {
  env: Record<string, string | undefined>;
  providerEnabledInRegistry: boolean;
  missingReferences: string[];
}

export function assertLiveGenerationAllowed(provider: ProviderAdapter, req: StageRequest, ctx: GateContext): void {
  const visual = req.stage === 'scene_image' || req.stage === 'scene_video';
  if (visual && ctx.missingReferences.length > 0) throw new GenerationBlockedError('missing_character_reference');
  if (!provider.paid) return;
  if (ctx.env.LIMO_ENABLE_PAID_GENERATION !== 'true') throw new GenerationBlockedError('paid_generation_disabled');
  if (!ctx.providerEnabledInRegistry) throw new GenerationBlockedError('provider_disabled');
}
