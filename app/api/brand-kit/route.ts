import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

const HEX = /^#[0-9a-fA-F]{6}$/;
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org || !canEditOrg(guard.ctx, org.organization_id)) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as Record<string, unknown>;
  const primary = s(b.primary_color, 7);
  const secondary = s(b.secondary_color, 7);
  if ((primary && !HEX.test(primary)) || (secondary && !HEX.test(secondary))) return json({ error: 'invalid_color' }, 400);
  const logo = b.logo_asset_id === null || b.logo_asset_id === '' ? '' : String(b.logo_asset_id ?? '');
  if (logo && !isUuid(logo)) return json({ error: 'invalid_logo' }, 400);

  const supabase = await getSupabaseServer();
  const { error } = await callRpc(supabase, 'save_brand_kit', {
    p_organization_id: org.organization_id,
    p_kit: {
      brand_name: s(b.brand_name, 120),
      tagline: s(b.tagline, 200),
      website: s(b.website, 200),
      primary_color: primary || '#7157ef',
      secondary_color: secondary || '#211e2b',
      logo_asset_id: logo,
      default_cta: s(b.default_cta, 120),
      tone: s(b.tone, 200),
    },
  });
  if (error) return json({ error: isMissingFunction(error) ? 'unavailable' : 'invalid' }, isMissingFunction(error) ? 501 : 422);
  return json({ ok: true });
}
