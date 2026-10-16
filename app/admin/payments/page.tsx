import type { Metadata } from 'next';
import Link from 'next/link';
import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { getPlans } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { PaymentQueue, type QueueItem } from '@/components/admin/PaymentQueue';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.admin.queueTitle };
}

interface Row {
  id: string;
  organization_name: string;
  submitter_email: string | null;
  purchase_type: string;
  item_code: string;
  method: string;
  amount_dzd: number | null;
  amount_usdt: number | null;
  transaction_ref: string;
  receipt_path: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
}

/** Access is enforced by app/admin/layout.tsx and again inside admin_list_payment_submissions(). */
export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { t } = await getI18n();
  const showAll = (await searchParams).status === 'all';
  const supabase = await getSupabaseServer();
  const [{ data, error }, plans] = await Promise.all([
    callRpc<Row[]>(supabase, 'admin_list_payment_submissions', { p_status: showAll ? null : 'pending' }),
    getPlans(),
  ]);

  const rows = data ?? [];
  const paths = rows.map((r) => r.receipt_path).filter((p): p is string => Boolean(p));
  const signed = paths.length ? (await supabase.storage.from('payment-receipts').createSignedUrls(paths, 600)).data ?? [] : [];
  const urlFor = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));

  const items: QueueItem[] = rows.map((r) => ({
    id: r.id,
    organization_name: r.organization_name,
    submitter_email: r.submitter_email,
    item_label: r.purchase_type === 'subscription' ? (plans?.find((p) => p.code === r.item_code)?.name ?? r.item_code) : r.item_code,
    method: r.method,
    amount: r.amount_dzd ? `${r.amount_dzd} DZD` : r.amount_usdt ? `${r.amount_usdt} USDT` : '—',
    transaction_ref: r.transaction_ref,
    receipt_url: r.receipt_path ? (urlFor.get(r.receipt_path) ?? null) : null,
    status: r.status,
    review_note: r.review_note,
    created_at: r.created_at,
  }));

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow accent">{t.nav.admin}</span>
          <h1 style={{ marginTop: 8 }}>{t.admin.queueTitle}</h1>
          <p>{t.admin.queueLead}</p>
        </div>
      </div>
      <AdminTabs />
      <div className="segmented" role="tablist" aria-label={t.projects.filterStatus} style={{ justifySelf: 'start' }}>
        <Link href="/admin/payments" role="tab" aria-selected={!showAll} className="seg-link" aria-current={!showAll ? 'page' : undefined}>
          {t.admin.filterPending}
        </Link>
        <Link href="/admin/payments?status=all" role="tab" aria-selected={showAll} className="seg-link" aria-current={showAll ? 'page' : undefined}>
          {t.admin.filterAll}
        </Link>
      </div>
      {error ? <p className="callout callout-warning">{isMissingFunction(error) ? t.admin.unavailable : t.common.errorGeneric}</p> : <PaymentQueue items={items} />}
    </div>
  );
}
