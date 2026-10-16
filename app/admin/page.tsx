import type { Metadata } from 'next';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.admin.title };
}

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const [payments, audit] = await Promise.all([
    supabase
      .from('payment_submissions')
      .select('id, organization_id, purchase_type, item_code, method, amount_dzd, amount_usdt, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('platform_audit_events').select('id, event_type, entity_type, organization_id, created_at').order('created_at', { ascending: false }).limit(50),
  ]);
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

      <div className="callout">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01" />
        </svg>
        <div>
          <strong>{t.admin.providers}</strong>
          {t.admin.providersNote} {t.admin.limitedVisibility}
        </div>
      </div>

      <section className="panel" aria-labelledby="adm-pay">
        <div className="panel-head">
          <h2 id="adm-pay">{t.admin.payments}</h2>
          <span className="badge plain mono ltr">{payments.data?.length ?? 0}</span>
        </div>
        {(payments.data ?? []).length === 0 ? (
          <div className="panel-body">
            <p className="small muted">{t.billing.noPayments}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {(payments.data ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(intl, p.created_at, dt)}</td>
                    <td className="mono xsmall ltr">{p.organization_id.slice(0, 8)}…</td>
                    <td className="mono">{p.item_code}</td>
                    <td>{p.method}</td>
                    <td className="mono ltr">{p.amount_dzd ?? p.amount_usdt ?? '—'}</td>
                    <td>
                      <span className="badge">{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                    <td className="mono">{e.event_type}</td>
                    <td>{e.entity_type}</td>
                    <td className="mono xsmall ltr">{e.organization_id ? `${e.organization_id.slice(0, 8)}…` : '—'}</td>
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
