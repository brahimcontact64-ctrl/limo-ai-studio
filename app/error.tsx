'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n/client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="container" style={{ minHeight: '70dvh', display: 'grid', placeItems: 'center' }}>
      <div className="stack" style={{ justifyItems: 'center', textAlign: 'center', maxWidth: 440 }}>
        <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{t.errors.errorTitle}</h1>
        <p className="muted">{t.errors.errorBody}</p>
        {error.digest && <p className="mono xsmall muted ltr">ref {error.digest}</p>}
        <button className="btn btn-primary" type="button" onClick={reset}>
          {t.common.retry}
        </button>
      </div>
    </main>
  );
}
