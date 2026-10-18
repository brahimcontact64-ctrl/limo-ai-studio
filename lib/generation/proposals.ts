/**
 * AI generation results as the Video step shows them (Milestone 10): one proposal per scene, built from the
 * completed stages of the latest run and the customer's recorded decisions. Pure, so it is unit-tested.
 */
export interface StageRow {
  stage_type: string;
  scene_number: number | null;
  status: string;
  output_asset_id: string | null;
  output_payload: Record<string, unknown> | null;
}
export interface DecisionRow {
  scene_number: number;
  asset_id: string;
  decision: 'applied' | 'rejected';
}
export interface ProposalItem {
  scene_number: number;
  asset_id: string;
  role: 'image' | 'video' | 'voice';
  decision: 'applied' | 'rejected' | null;
}

export function proposalItems(stages: StageRow[], decisions: DecisionRow[]): ProposalItem[] {
  const render = stages.find((s) => s.stage_type === 'render' && s.status === 'completed');
  const rows = ((render?.output_payload?.proposal ?? []) as Array<Record<string, unknown>>);
  const items: ProposalItem[] = [];
  for (const r of rows) {
    const scene = Number(r.scene_number);
    const add = (asset: unknown, role: ProposalItem['role']) => {
      if (typeof asset !== 'string' || !asset) return;
      const d = decisions.find((x) => x.scene_number === scene && x.asset_id === asset);
      items.push({ scene_number: scene, asset_id: asset, role, decision: d?.decision ?? null });
    };
    add(r.video_asset_id, 'video');
    add(r.image_asset_id, 'image');
    add(r.voice_asset_id, 'voice');
  }
  return items;
}

/** Map a database error from the generation functions to an API error code. */
export function generationError(message: string | undefined | null): { code: string; status: number } {
  const m = (message ?? '').toLowerCase();
  if (m.includes('not enabled') || m.includes('not verified') || m.includes('ai is disabled')) return { code: 'not_enabled', status: 409 };
  if (m.includes('videos are limited to')) return { code: 'video_too_long', status: 422 };
  if (m.includes('approve the script') || m.includes('script')) return { code: 'script_not_approved', status: 409 };
  if (m.includes('budget')) return { code: 'budget_exceeded', status: 402 };
  if (m.includes('too many') || m.includes('rate limit')) return { code: 'too_many', status: 429 };
  if (m.includes('character visual reference') || m.includes('voice')) return { code: 'missing_reference', status: 409 };
  if (m.includes('not ready')) return { code: 'already_generated', status: 409 };
  if (m.includes('active subscription')) return { code: 'subscription_required', status: 402 };
  if (m.includes('not produced by that generation')) return { code: 'not_from_generation', status: 422 };
  if (m.includes('not authorized') || m.includes('authentication')) return { code: 'not_authorized', status: 403 };
  if (m.includes('not found')) return { code: 'not_found', status: 404 };
  return { code: 'invalid', status: 422 };
}
