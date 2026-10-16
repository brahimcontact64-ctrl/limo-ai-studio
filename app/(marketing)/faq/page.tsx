import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { Icon } from '@/components/ui/Icon';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.faq };
}

export default async function FaqPage() {
  const { t } = await getI18n();
  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow accent">{t.faq.eyebrow}</span>
          <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{t.faq.title}</h1>
        </div>
        <div className="faq">
          {t.faq.items.map((item, i) => (
            <details key={item.q} open={i === 0}>
              <summary>
                {item.q}
                <Icon name="chevronDown" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
