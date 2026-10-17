import type { Metadata } from 'next';
import { getSupabaseServer } from '@/lib/supabase/server';
import { untyped } from '@/lib/supabase/rpc';
import { getCatalogs } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { AdminCharacters, type AdminCharacterRow } from '@/components/admin/AdminCharacters';
import { viewSlots, type ReferenceAsset } from '@/lib/characters/references';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.adminChars.title };
}

/** Access: app/admin/layout.tsx (admin + aal2). RLS returns all canonical references only to two-factor admins. */
export default async function AdminCharactersPage() {
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const [catalogs, assetsRes] = await Promise.all([
    getCatalogs(),
    untyped(supabase)
      .from('character_reference_assets')
      .select('id, catalog_character_id, asset_kind, view, expression_key, outfit_key, spec_version, status, mime_type, provenance, created_at')
      .not('catalog_character_id', 'is', null)
      .in('status', ['pending_review', 'approved']),
  ]);
  const assets = (assetsRes.data ?? []) as Array<ReferenceAsset & { catalog_character_id: string }>;
  const rows: AdminCharacterRow[] = catalogs.characters.map((c) => {
    const mine = assets.filter((a) => a.catalog_character_id === c.id);
    return {
      character: c,
      slots: viewSlots(mine, c.spec_version ?? null).map((s) => ({ view: s.view, state: s.state, required: s.required })),
      pending: mine.filter((a) => a.status === 'pending_review').length,
    };
  });
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow accent">{t.nav.admin}</span>
          <h1 style={{ marginTop: 8 }}>{t.adminChars.title}</h1>
          <p>{t.adminChars.lead}</p>
        </div>
      </div>
      <AdminTabs />
      {assetsRes.error ? <p className="callout callout-warning">{t.characters.preview.unavailable}</p> : <AdminCharacters rows={rows} />}
    </div>
  );
}
