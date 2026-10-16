import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { getPlans } from '@/lib/data/catalog';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { Meter } from '@/components/app/ProjectBits';
import { PlanCards } from '@/components/marketing/PlanCards';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.billing.title };
}

export default async function BillingPage() {
  const ctx = await requireAppContext();
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const [plans, payments] = await Promise.all([
    getPlans(),
    ctx.org
      ? supabase
          .from('payment_submissions')
          .select('id, purchase_type, item_code, method, status, created_at')
          .eq('organization_id', ctx.org.organization_id)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const sub = ctx.subscription;
  const usage = ctx.usage;
  const plan = plans?.find((p) => p.code === sub?.plan_code);
  const statusKey = (sub?.status ?? 'none') as keyof typeof t.billing.status;

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.billing.title}</h1>
          <p>{t.billing.lead}</p>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 0 }}>
        <section className="panel" aria-labelledby="cur-h">
          <div className="panel-head">
            <h2 id="cur-h">{t.billing.currentPlan}</h2>
            <span className={`badge ${ctx.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>{t.billing.status[statusKey] ?? sub?.status}</span>
          </div>
          <div className="panel-body stack">
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 650 }}>{plan?.name ?? sub?.plan_code ?? t.dashboard.noPlan}</p>
            {sub?.started_at && <p className="small muted">{fmt(t.billing.startedOn, { date: formatDate(intl, sub.started_at) })}</p>}
            {sub?.renews_at && <p className="small muted">{fmt(t.billing.renewsOn, { date: formatDate(intl, sub.renews_at) })}</p>}
            {usage && (
              <div className="stack" style={{ marginTop: 8 }}>
                <Meter
                  label={t.dashboard.videoSlots}
                  used={usage.used_video_slots}
                  total={usage.base_video_slots + usage.extra_video_slots}
                  hint={fmt(t.billing.used, { used: usage.used_video_slots, total: usage.base_video_slots + usage.extra_video_slots })}
                />
                <Meter
                  label={t.dashboard.images}
                  used={usage.used_images}
                  total={usage.base_images + usage.extra_images}
                  hint={fmt(t.billing.used, { used: usage.used_images, total: usage.base_images + usage.extra_images })}
                />
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="act-h">
          <div className="panel-head">
            <h2 id="act-h">{t.billing.activationTitle}</h2>
          </div>
          <div className="panel-body stack">
            <p className="small muted">{t.billing.activationBody}</p>
            <Link className="btn btn-sm" href="/contact">
              {t.billing.contactToActivate}
            </Link>
          </div>
        </section>
      </div>

      <section aria-labelledby="plans-h">
        <h2 id="plans-h" style={{ fontSize: 'var(--fs-xl)', marginBottom: 16 }}>
          {t.billing.availablePlans}
        </h2>
        <PlanCards plans={plans} t={t} intl={intl} ctaHref="/contact" />
      </section>

      <section className="panel" aria-labelledby="pay-h">
        <div className="panel-head">
          <h2 id="pay-h">{t.billing.paymentHistory}</h2>
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
                    <td>{formatDate(intl, p.created_at)}</td>
                    <td className="mono">{p.item_code}</td>
                    <td>{p.method}</td>
                    <td>
                      <span className="badge">{(t.billing.paymentStatus as Record<string, string>)[p.status] ?? p.status}</span>
                    </td>
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
