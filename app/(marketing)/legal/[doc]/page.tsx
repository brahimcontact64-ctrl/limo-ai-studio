import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getI18n } from '@/lib/i18n/server';

const DOCS = ['terms', 'privacy'] as const;
type Doc = (typeof DOCS)[number];

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  const { t } = await getI18n();
  return { title: doc === 'privacy' ? t.legal.privacyTitle : t.legal.termsTitle };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!(DOCS as readonly string[]).includes(doc)) notFound();
  const { t } = await getI18n();
  const isPrivacy = (doc as Doc) === 'privacy';
  const body = isPrivacy ? t.legal.privacyBody : t.legal.termsBody;
  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="container prose">
        <h1>{isPrivacy ? t.legal.privacyTitle : t.legal.termsTitle}</h1>
        <div className="callout callout-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 3 2 21h20L12 3zM12 10v4M12 17.5h.01" />
          </svg>
          <p>{t.legal.draftNotice}</p>
        </div>
        <ol style={{ display: 'grid', gap: 16, paddingInlineStart: 20 }}>
          {body.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
