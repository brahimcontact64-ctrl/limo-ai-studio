import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppContext } from '@/lib/data/context';
import { getBrandKit, listAssets } from '@/lib/data/assets';
import { loadProject } from '@/lib/data/projects';
import { loadSeries } from '@/lib/data/stories';
import { getCatalogs } from '@/lib/data/catalog';
import { customAsRecords, listCustomCharacters } from '@/lib/data/characters';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { EMPTY_BRIEF, IMAGE_PURPOSES, type ImageBrief, type ImagePurpose } from '@/lib/images/types';
import { NewImage, type NewImagePrefill } from '@/components/images/NewImage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.images.newImage };
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * New image. Optional starting points (all read with the user's own access, so RLS applies):
 *   ?project=<studio project>  product ad / promo / social post brief and its photos
 *   ?series=<story series>     story illustration with the canonical cast identities
 *   ?post=<social post>        come back to that post afterwards
 */
export default async function NewImagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAppContext();
  if (!ctx.org || !ctx.canEdit) redirect('/app/images');
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const q = await searchParams;
  const org = ctx.org.organization_id;

  const prefill: NewImagePrefill = {
    title: '',
    purpose: (IMAGE_PURPOSES as readonly string[]).includes(q.purpose ?? '') ? (q.purpose as ImagePurpose) : 'product_ad',
    prompt: '',
    brief: { ...EMPTY_BRIEF },
    photos: [],
    series_id: null,
    source_project_id: null,
    characters: [],
    context: null,
    post_id: q.post && isUuid(q.post) ? q.post : null,
  };

  if (q.project && isUuid(q.project)) {
    const project = await loadProject(supabase, q.project);
    if (project && project.organization_id === org) {
      const d = project.draft;
      const b = d.creation_brief as Record<string, unknown>;
      const brief: ImageBrief = {
        headline: s(b.businessName) || s(b.topic) || '',
        product_name: s(b.productName),
        price: s(b.price),
        offer: s(b.offer),
        cta: s(b.callToAction),
        body: '',
      };
      prefill.title = d.title;
      prefill.purpose = d.creation_mode === 'product_ad' ? 'product_ad' : d.creation_mode === 'social_post' ? 'social_post' : 'banner';
      prefill.prompt = s(b.productDescription) || d.brief;
      prefill.brief = brief;
      prefill.source_project_id = q.project;
      prefill.context = { kind: 'project', title: d.title };
      const ids = [...new Set(d.scenes.flatMap((sc) => sc.asset_ids))].slice(0, 6);
      const assets = ids.length ? ((await listAssets(supabase, org, ids)) ?? []) : [];
      prefill.photos = assets.filter((a) => a.media_type === 'image').map((a) => ({ id: a.id, url: a.url, name: a.label ?? a.file_name }));
    }
  }

  if (q.series && isUuid(q.series)) {
    const series = await loadSeries(supabase, q.series);
    if (series && series.organization_id === org) {
      const catalogs = await getCatalogs();
      const records = [...catalogs.characters, ...customAsRecords(await listCustomCharacters(supabase, org))];
      prefill.purpose = 'story_illustration';
      prefill.title = `${series.title} — ${t.images.purposes.story_illustration}`;
      prefill.prompt = series.bible.premise;
      prefill.series_id = q.series;
      prefill.context = { kind: 'series', title: series.title };
      // Identity text comes from the character specs (Milestone 4); their review status is shown, never changed.
      prefill.characters = series.bible.characters.slice(0, 4).map((c) => {
        const rec = records.find((r) => r.id === c.ref);
        return { ref: c.ref, name: c.name, identity: rec?.identity_prompt ?? null, reference_status: rec?.reference_status ?? 'pending' };
      });
    }
  }

  const kit = await getBrandKit(supabase, org);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/images">
            {t.images.title}
          </Link>
          <h1>{t.images.create.title}</h1>
          <p>{t.images.create.lead}</p>
        </div>
      </div>
      <NewImage organizationId={org} prefill={prefill} hasBrandLogo={!!kit?.logo_asset_id} />
    </div>
  );
}
