import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

export function SubscriptionNotice({ t }: { t: Dictionary }) {
  return (
    <div className="callout callout-warning" role="note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3 2 21h20L12 3zM12 10v4M12 17.5h.01" />
      </svg>
      <div>
        <strong>{t.app.subscriptionMissingTitle}</strong>
        {t.app.subscriptionMissingBody}
      </div>
      <div className="callout-actions">
        <Link className="btn btn-sm" href="/app/billing">
          {t.app.viewPlans}
        </Link>
      </div>
    </div>
  );
}
