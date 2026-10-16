import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { getCatalogs, getPlans } from '@/lib/data/catalog';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { PlanCards } from '@/components/marketing/PlanCards';
import { CHARACTER_FAMILIES, CHARACTER_VARIANTS } from '@/lib/studio/limits';

export default async function HomePage() {
  const { t, intl } = await getI18n();
  const [catalogs, plans] = hasSupabaseEnv() ? await Promise.all([getCatalogs(), getPlans()]) : [null, null];
  const liveIds = new Set(catalogs?.characters.map((c) => c.id) ?? []);

  const features: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'layers', title: t.home.features.nicheTitle, body: t.home.features.nicheBody },
    { icon: 'film', title: t.home.features.continuityTitle, body: t.home.features.continuityBody },
    { icon: 'shield', title: t.home.features.safetyTitle, body: t.home.features.safetyBody },
    { icon: 'clock', title: t.home.features.graceTitle, body: t.home.features.graceBody },
  ];
  const steps = [
    [t.home.steps.brief, t.home.steps.briefBody],
    [t.home.steps.cast, t.home.steps.castBody],
    [t.home.steps.scenes, t.home.steps.scenesBody],
    [t.home.steps.review, t.home.steps.reviewBody],
    [t.home.steps.generate, t.home.steps.generateBody],
  ] as const;
  const useCases = [
    [t.home.useCases.creators, t.home.useCases.creatorsBody],
    [t.home.useCases.brands, t.home.useCases.brandsBody],
    [t.home.useCases.educators, t.home.useCases.educatorsBody],
    [t.home.useCases.agencies, t.home.useCases.agenciesBody],
  ] as const;

  return (
    <>
      <section className="hero">
        <span className="eyebrow">{t.home.eyebrow}</span>
        <h1>{t.home.title}</h1>
        <p className="hero-lead">{t.home.lead}</p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-lg" href="/signup">
            {t.home.primaryCta}
          </Link>
        </div>
      </section>

      <section id="safety" className="container" aria-label={t.nav.safety}>
        <div className="card-grid cols-4">
          {features.map((f) => (
            <article key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section container" aria-label={t.home.statusTitle}>
        <div className="card-grid cols-2">
          <div className="status-card">
            <span>
              <span className="badge badge-success">{t.home.statusAvailable}</span>
            </span>
            <p>{t.home.statusAvailableItems}</p>
          </div>
          <div className="status-card">
            <span>
              <span className="badge badge-warning">{t.home.statusRollout}</span>
            </span>
            <p>{t.home.statusRolloutItems}</p>
          </div>
        </div>
      </section>

      <section className="section container" id="how">
        <div className="section-head">
          <span className="eyebrow">{t.home.howEyebrow}</span>
          <h2>{t.home.howTitle}</h2>
        </div>
        <ol className="card-grid cols-5" style={{ listStyle: 'none' }}>
          {steps.map(([title, body], i) => (
            <li key={title} className="card">
              <span className="step-num ltr">{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section container" id="characters">
        <div className="section-head">
          <span className="eyebrow">{t.home.castEyebrow}</span>
          <h2>{t.home.castTitle}</h2>
          <p>{t.home.castBody}</p>
        </div>
        <div className="card-grid cols-3">
          {CHARACTER_FAMILIES.map((family) => (
            <section key={family} className="cast-family" data-family={family} aria-labelledby={`fam-${family}`}>
              <div className="cast-family-head">
                <h3 id={`fam-${family}`}>{t.characters.family[family]}</h3>
                <span className="xsmall muted">{t.characters.familyKind[family]}</span>
              </div>
              <ul>
                {CHARACTER_VARIANTS.map((variant) => (
                  <li key={variant} style={{ opacity: catalogs && !liveIds.has(`${family}_${variant}`) ? 0.4 : 1 }}>
                    <FamilyGlyph family={family} variant={variant} size={54} />
                    {t.characters.variant[variant]}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="xsmall muted" style={{ marginTop: 16, textAlign: 'center' }}>
          {t.home.castNote}
        </p>
      </section>

      <section className="section container" id="use-cases">
        <div className="section-head">
          <span className="eyebrow">{t.home.useCasesEyebrow}</span>
          <h2>{t.home.useCasesTitle}</h2>
        </div>
        <div className="card-grid cols-4">
          {useCases.map(([title, body]) => (
            <article key={title} className="card">
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section container" id="pricing">
        <div className="section-head">
          <h2>{t.pricing.title}</h2>
          <p>{t.pricing.lead}</p>
        </div>
        <PlanCards plans={plans} t={t} intl={intl} />
        <p className="xsmall muted" style={{ marginTop: 20, textAlign: 'center' }}>
          {t.pricing.manualNote}
        </p>
      </section>

      <section className="section container">
        <div className="cta-band">
          <h2>{t.home.ctaTitle}</h2>
          <p>{t.home.ctaBody}</p>
          <Link className="btn btn-primary btn-lg" href="/signup">
            {t.home.primaryCta}
            <Icon name="arrowRight" className="flip-rtl" />
          </Link>
        </div>
      </section>
    </>
  );
}
