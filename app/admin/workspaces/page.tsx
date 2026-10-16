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
export default async function AdminWorkspacesPage() {
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const [{ data, error }, plans] = await Promise.all([callRpc<WorkspaceRow[]>(supabase, 'admin_list_workspaces'), getPlans()]);
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
      {error ? (
        <p className="callout callout-warning">{isMissingFunction(error) ? t.admin.unavailable : t.common.errorGeneric}</p>
      ) : (
        <WorkspacesTable rows={data ?? []} plans={(plans ?? []).map((p) => ({ code: p.code, name: p.name }))} />
      )}
    </div>
  );
}
