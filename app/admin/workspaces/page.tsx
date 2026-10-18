import type { Metadata } from 'next';
import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { getPlans } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { WorkspacesTable, type WorkspaceRow } from '@/components/admin/WorkspacesTable';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.adminWs.title };
}

/** Access: app/admin/layout.tsx (admin + aal2) and admin_list_workspaces() (is_platform_admin_mfa). */
export default async function AdminWorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { t } = await getI18n();
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  const supabase = await getSupabaseServer();
  const [{ data, error }, plans] = await Promise.all([callRpc<WorkspaceRow[]>(supabase, 'admin_list_workspaces', { p_search: q || null }), getPlans()]);
  const rows = data ?? [];
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow accent">{t.nav.admin}</span>
          <h1 style={{ marginTop: 8 }}>{t.adminWs.title}</h1>
          <p>{t.adminWs.lead}</p>
        </div>
      </div>
      <AdminTabs />
      <form method="get" className="row" role="search" aria-label={t.adminWs.search}>
        <label className="sr-only" htmlFor="ws-search">
          {t.adminWs.search}
        </label>
        <input id="ws-search" type="search" name="q" className="input" defaultValue={q} placeholder={t.adminWs.searchHint} maxLength={200} style={{ maxWidth: 360 }} />
        <button type="submit" className="btn">
          {t.adminWs.search}
        </button>
      </form>
      {!error && rows.length >= 500 && <p className="small muted">{t.adminWs.limited}</p>}
      {error ? (
        <p className="callout callout-warning">{isMissingFunction(error) ? t.admin.unavailable : t.common.errorGeneric}</p>
      ) : (
        <WorkspacesTable rows={rows} plans={(plans ?? []).map((p) => ({ code: p.code, name: p.name }))} />
      )}
    </div>
  );
}
