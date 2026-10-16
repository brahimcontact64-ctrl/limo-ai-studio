import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.contact.title };
}

export default async function ContactPage() {
  const { t } = await getI18n();
  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="container prose">
        <h1>{t.contact.title}</h1>
        <p>{t.contact.lead}</p>
        <p>{t.contact.signedInHint}</p>
        <p className="muted small">{t.contact.pendingHint}</p>
        <div className="row">
          <Link className="btn btn-primary" href="/login">
            {t.common.signIn}
          </Link>
          <Link className="btn" href="/faq">
            {t.nav.faq}
          </Link>
        </div>
      </div>
    </section>
  );
}
