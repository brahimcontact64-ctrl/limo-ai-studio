import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { LogoMark } from '@/components/brand/Logo';

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main id="main" className="container" style={{ minHeight: '80dvh', display: 'grid', placeItems: 'center' }}>
      <div className="stack" style={{ justifyItems: 'center', textAlign: 'center', maxWidth: 440 }}>
        <LogoMark size={44} />
        <span className="eyebrow mono">404</span>
        <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{t.errors.notFoundTitle}</h1>
        <p className="muted">{t.errors.notFoundBody}</p>
        <Link className="btn" href="/">
          {t.errors.goHome}
        </Link>
      </div>
    </main>
  );
}
