import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { getSupabaseServer } from '@/lib/supabase/server';
import { EMPTY_BRAND_KIT, getBrandKit, listAssets } from '@/lib/data/assets';
import { getI18n } from '@/lib/i18n/server';
import { AssetLibrary } from '@/components/assets/AssetLibrary';
import { BrandKitForm } from '@/components/assets/BrandKitForm';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.assets.title };
}

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const tab = (await searchParams).tab === 'brand' ? 'brand' : 'library';
  const org = ctx.org;
  const supabase = await getSupabaseServer();
  const [assets, kit] = org ? await Promise.all([listAssets(supabase, org.organization_id), getBrandKit(supabase, org.organization_id)]) : [null, null];

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.assets.title}</h1>
          <p>{t.assets.lead}</p>
        </div>
      </div>
      <nav className="tabs admin-tabs" aria-label={t.assets.title}>
        <Link className="tab" href="/app/assets" aria-current={tab === 'library' ? 'page' : undefined}>
          {t.assets.library}
        </Link>
        <Link className="tab" href="/app/assets?tab=brand" aria-current={tab === 'brand' ? 'page' : undefined}>
          {t.assets.brand}
        </Link>
      </nav>
      {!org || assets === null ? (
        <p className="callout callout-warning">{t.assets.unavailable}</p>
      ) : tab === 'library' ? (
        <AssetLibrary organizationId={org.organization_id} assets={assets} canEdit={ctx.canEdit} />
      ) : (
        <BrandKitForm initial={kit ?? EMPTY_BRAND_KIT} logo={assets.find((a) => a.id === kit?.logo_asset_id) ?? null} canEdit={ctx.canEdit} />
      )}
    </div>
  );
}
