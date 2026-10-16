import type { Metadata } from 'next';
import Link from 'next/link';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { FlagsPanel, type FlagRow } from '@/components/admin/FlagsPanel';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.admin.title };
}

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const [pending, audit, methods, flags] = await Promise.all([
    supabase.from('payment_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('platform_audit_events').select('id, event_type, entity_type, organization_id, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('payment_method_settings').select('method, enabled'),
    // feature_flags arrives with migration 20261017090000; absent tables simply hide the panel.
    (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)('feature_flags').select('key, enabled, description').order('key'),
  ]);
  const enabledMethods = (methods.data ?? []).filter((m) => m.enabled).length;
  const dt: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow accent">{t.nav.admin}</span>
          <h1 style={{ marginTop: 8 }}>{t.admin.title}</h1>
          <p>{t.admin.lead}</p>
        </div>
      </div>
      <AdminTabs />

      <dl className="stat-row">
        <Link href="/admin/payments" className="stat">
          <dt>{t.admin.queueTitle}</dt>
          <dd className="ltr">{pending.count ?? 0}</dd>
        </Link>
        <Link href="/admin/payment-methods" className="stat">
          <dt>{t.admin.methodsTitle}</dt>
          <dd className="ltr">
            {enabledMethods}/{(methods.data ?? []).length}
          </dd>
        </Link>
      </dl>

      <div className="callout">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01" />
        </svg>
        <div>
          <strong>{t.admin.providers}</strong>
          {t.admin.providersNote}
        </div>
      </div>

      {!flags.error && (flags.data ?? []).length > 0 && (
        <section className="panel" aria-labelledby="adm-flags">
          <div className="panel-head">
            <h2 id="adm-flags">{t.flags.title}</h2>
          </div>
          <div className="panel-body stack">
            <p className="small muted">{t.flags.lead}</p>
            <FlagsPanel flags={(flags.data ?? []) as unknown as FlagRow[]} />
          </div>
        </section>
      )}

      <section className="panel" aria-labelledby="adm-audit">
        <div className="panel-head">
          <h2 id="adm-audit">{t.admin.audit}</h2>
        </div>
        {(audit.data ?? []).length === 0 ? (
          <div className="panel-body">
            <p className="small muted">{t.admin.noAudit}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(intl, e.created_at, dt)}</td>
                    <td className="ltr">{e.event_type}</td>
                    <td>{e.entity_type}</td>
                    <td className="xsmall muted ltr">{e.organization_id ? `${e.organization_id.slice(0, 8)}…` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
