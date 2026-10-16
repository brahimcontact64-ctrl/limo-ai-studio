import type { Metadata } from 'next';
import { requireAppContext } from '@/lib/data/context';
import { getPlans } from '@/lib/data/catalog';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { isPaymentMethod } from '@/lib/billing/payments';
import { Meter } from '@/components/app/ProjectBits';
import { ActivatePlan, type MethodOption } from '@/components/billing/ActivatePlan';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.billing.title };
}

const PAYMENT_TONE: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

export default async function BillingPage() {
  const ctx = await requireAppContext();
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const org = ctx.org;
  const [plans, methodsRes, payments] = await Promise.all([
    getPlans(),
    // RLS: authenticated users can read enabled methods only.
    supabase.from('payment_method_settings').select('method, display_name, account_holder, account_number, ccp_key, redotpay_uid, instructions').eq('enabled', true),
    org
      ? supabase
          .from('payment_submissions')
          .select('id, item_code, method, amount_dzd, amount_usdt, transaction_ref, status, review_note, created_at')
          .eq('organization_id', org.organization_id)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const sub = ctx.subscription;
  const usage = ctx.usage;
  const plan = plans?.find((p) => p.code === sub?.plan_code);
  const statusKey = (sub?.status ?? 'none') as keyof typeof t.billing.status;
  const methods: MethodOption[] = (methodsRes.data ?? []).filter((m) => isPaymentMethod(m.method)) as MethodOption[];
  const planName = (code: string) => plans?.find((p) => p.code === code)?.name ?? code;

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.billing.title}</h1>
          <p>{t.billing.lead}</p>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 0 }}>
        <section className="panel" aria-labelledby="activate-h">
          <div className="panel-head">
            <h2 id="activate-h">{t.billing.activate.title}</h2>
          </div>
          <div className="panel-body stack">
            <p className="small muted">{t.billing.activate.lead}</p>
            {org && plans && (
              <ActivatePlan
                organizationId={org.organization_id}
                canPay={org.role === 'owner' || org.role === 'admin'}
                plans={plans}
                methods={methods}
                defaultPlan={sub?.plan_code ?? null}
              />
            )}
          </div>
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="cur-h">
            <div className="panel-head">
              <h2 id="cur-h">{t.billing.currentPlan}</h2>
              <span className={`badge ${ctx.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>{t.billing.status[statusKey] ?? sub?.status}</span>
            </div>
            <div className="panel-body stack">
              <p style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800 }}>{plan?.name ?? sub?.plan_code ?? t.dashboard.noPlan}</p>
              {sub?.started_at && <p className="small muted">{fmt(t.billing.startedOn, { date: formatDate(intl, sub.started_at) })}</p>}
              {sub?.renews_at && <p className="small muted">{fmt(t.billing.renewsOn, { date: formatDate(intl, sub.renews_at) })}</p>}
              {usage ? (
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
              ) : (
                <p className="small muted">{t.dashboard.usageNone}</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="how-h">
            <div className="panel-head">
              <h2 id="how-h">{t.billing.activationTitle}</h2>
            </div>
            <div className="panel-body">
              <p className="small muted">{t.billing.activationBody}</p>
            </div>
          </section>
        </div>
      </div>

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
                    <td>{planName(p.item_code)}</td>
                    <td className="ltr">{p.amount_dzd ? `${p.amount_dzd} DZD` : p.amount_usdt ? `${p.amount_usdt} USDT` : '—'}</td>
                    <td className="ltr small muted">{p.transaction_ref}</td>
                    <td>
                      <span className={`badge ${PAYMENT_TONE[p.status] ?? ''}`}>{(t.billing.paymentStatus as Record<string, string>)[p.status] ?? p.status}</span>
                      {p.review_note && (
                        <p className="xsmall muted" style={{ marginTop: 6 }} dir="auto">
                          {t.billing.activate.reviewNote}: {p.review_note}
                        </p>
                      )}
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
