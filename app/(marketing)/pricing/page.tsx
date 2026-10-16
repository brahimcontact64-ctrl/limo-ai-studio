import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { getPlans } from '@/lib/data/catalog';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { PlanCards } from '@/components/marketing/PlanCards';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.pricing };
}

export default async function PricingPage() {
  const { t, intl } = await getI18n();
  const plans = hasSupabaseEnv() ? await getPlans() : null;
  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow accent">{t.pricing.eyebrow}</span>
          <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{t.pricing.title}</h1>
          <p>{t.pricing.lead}</p>
        </div>
        <PlanCards plans={plans} t={t} intl={intl} />
        <div className="callout" style={{ marginTop: 24 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01" />
          </svg>
          <p>{t.pricing.manualNote}</p>
        </div>
      </div>
    </section>
  );
}
