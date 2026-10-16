import type { Metadata } from 'next';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { PaymentMethodsForm, type MethodRow } from '@/components/admin/PaymentMethodsForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.admin.methodsTitle };
}

/** RLS lets platform admins read every method (payment_method_authenticated_read). */
export default async function AdminPaymentMethodsPage() {
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('payment_method_settings')
    .select('method, display_name, enabled, account_holder, account_number, ccp_key, redotpay_uid, instructions')
    .order('method');
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow accent">{t.nav.admin}</span>
          <h1 style={{ marginTop: 8 }}>{t.admin.methodsTitle}</h1>
          <p>{t.admin.methodsLead}</p>
        </div>
      </div>
      <AdminTabs />
      <PaymentMethodsForm rows={(data ?? []) as MethodRow[]} />
    </div>
  );
}
