import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { fmt } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import type { PlanRecord } from '@/lib/data/catalog';

export function formatDzd(intl: string, amount: number) {
  return new Intl.NumberFormat(intl, { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 }).format(amount);
}

export function PlanCards({ plans, t, intl, ctaHref = '/signup' }: { plans: PlanRecord[] | null; t: Dictionary; intl: string; ctaHref?: string }) {
  if (!plans || plans.length === 0) {
    return <p className="muted">{t.pricing.unavailable}</p>;
  }
  const featured = plans.length >= 3 ? plans[1]?.code : undefined;
  return (
    <div className="plans">
      {plans.map((p) => (
        <article key={p.code} className={`plan${p.code === featured ? ' featured' : ''}`}>
          <span className="plan-name">{p.name}</span>
          <div>
            <div className="plan-price">
              <span className="ltr">{formatDzd(intl, p.monthly_dzd)}</span>
              <small>{t.pricing.perMonth}</small>
            </div>
            <p className="xsmall muted">{fmt(t.pricing.altPrice, { amount: p.redotpay_usdt })}</p>
          </div>
          <ul>
            <li>
              <Icon name="check" size={14} />
              {fmt(t.pricing.videoSlots, { n: p.video_slots })}
            </li>
            <li>
              <Icon name="check" size={14} />
              {fmt(t.pricing.images, { n: p.ai_images })}
            </li>
            <li>
              <Icon name="check" size={14} />
              AR · FR · EN · DE
            </li>
          </ul>
          <Link className={`btn ${p.code === featured ? 'btn-primary' : ''}`} href={ctaHref}>
            {fmt(t.pricing.choose, { plan: p.name })}
          </Link>
        </article>
      ))}
    </div>
  );
}
