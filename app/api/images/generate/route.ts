import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { untyped } from '@/lib/supabase/rpc';
import { getBrandKit } from '@/lib/data/assets';
import { signedImageUrls } from '@/lib/data/images';
import { generateVariations, MOCK_LABEL } from '@/lib/images/mock';
import { ASPECTS, IMAGE_PURPOSES, IMAGE_STYLES, type Aspect, type ImagePurpose, type ImageStyle } from '@/lib/images/types';
import { parseBrief } from '@/lib/images/brief';

export const dynamic = 'force-dynamic';

/**
 * Mock image generation adapter. Paid image providers are disabled, so this always returns four
 * deterministic LAYOUTS built from the customer's own photos, logo, brand kit and typed text — labelled
 * "Mock layout — not AI artwork". No external service is called and nothing is saved here.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  const read = await readJson(request, 40_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const aspect = b.aspect as Aspect;
  if (!(ASPECTS as readonly string[]).includes(aspect) || !(IMAGE_PURPOSES as readonly string[]).includes(b.purpose as string)) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'image_generate', 60, 3600))) return json({ error: 'rate_limited' }, 429);

  // Only images of this workspace can be used (RLS + explicit organisation filter).
  const wanted = (Array.isArray(b.photos) ? b.photos : []).filter((x): x is string => typeof x === 'string').slice(0, 6);
  const { data: owned } = wanted.length
    ? await untyped(supabase).from('media_assets').select('id').in('id', wanted).eq('organization_id', org.organization_id).eq('media_type', 'image')
    : { data: [] };
  const ownedIds = new Set(((owned ?? []) as Array<{ id: string }>).map((r) => r.id));
  if (wanted.some((id) => !ownedIds.has(id))) return json({ error: 'foreign_asset' }, 403);

  const kit = await getBrandKit(supabase, org.organization_id);
  const useBrand = b.use_brand !== false;
  const characters = Array.isArray(b.characters)
    ? (b.characters as Array<Record<string, unknown>>).slice(0, 4).map((c) => ({
        ref: String(c.ref ?? '').slice(0, 60),
        name: String(c.name ?? '').slice(0, 80),
        identity: typeof c.identity === 'string' ? c.identity.slice(0, 4000) : null,
        reference_status: String(c.reference_status ?? 'pending').slice(0, 20),
      }))
    : undefined;
  const variations = generateVariations({
    purpose: b.purpose as ImagePurpose,
    aspect,
    style: (IMAGE_STYLES as readonly string[]).includes(b.style as string) ? (b.style as ImageStyle) : 'modern',
    prompt: typeof b.prompt === 'string' ? b.prompt.slice(0, 4000) : '',
    brief: parseBrief(b.brief),
    photos: wanted,
    logo: useBrand ? (kit?.logo_asset_id ?? null) : null,
    brand: useBrand && kit ? { primary: kit.primary_color, secondary: kit.secondary_color, name: kit.brand_name, cta: kit.default_cta } : { primary: '#7157ef', secondary: '#211e2b', name: '', cta: '' },
    characters,
  });
  // Short-lived URLs so the browser can preview the layouts (only this workspace's files).
  const urls = await signedImageUrls(supabase, [...wanted, ...(useBrand && kit?.logo_asset_id ? [kit.logo_asset_id] : [])]);
  return json({ provider: 'mock', label: MOCK_LABEL, variations, urls });
}
