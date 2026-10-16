import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { getCatalogs, getPlans } from '@/lib/data/catalog';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { PlanCards } from '@/components/marketing/PlanCards';
import { CHARACTER_FAMILIES, CHARACTER_VARIANTS, type CharacterFamily, type CharacterVariant } from '@/lib/studio/limits';

const EXAMPLE_REEL: Array<{ seconds: number; cast: Array<[CharacterFamily, CharacterVariant]> }> = [
  { seconds: 8, cast: [['limo', 'boy']] },
  { seconds: 12, cast: [['limo', 'boy'], ['nova', 'elder_woman']] },
  { seconds: 10, cast: [['adam', 'man'], ['nova', 'girl']] },
  { seconds: 6, cast: [['limo', 'boy'], ['nova', 'girl'], ['adam', 'man']] },
];

const tc = (s: number) => `00:${String(s).padStart(2, '0')}`;

export default async function HomePage() {
  const { t, intl } = await getI18n();
  const [catalogs, plans] = hasSupabaseEnv() ? await Promise.all([getCatalogs(), getPlans()]) : [null, null];
  const liveIds = new Set(catalogs?.characters.map((c) => c.id) ?? []);
  let elapsed = 0;

  const features: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'users', title: t.home.features.castTitle, body: t.home.features.castBody },
    { icon: 'scene', title: t.home.features.scenesTitle, body: t.home.features.scenesBody },
    { icon: 'text', title: t.home.features.scriptTitle, body: t.home.features.scriptBody },
    { icon: 'layers', title: t.home.features.exportTitle, body: t.home.features.exportBody },
    { icon: 'shield', title: t.home.features.controlTitle, body: t.home.features.controlBody },
    { icon: 'grid', title: t.home.features.teamTitle, body: t.home.features.teamBody },
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
  const total = EXAMPLE_REEL.reduce((s, c) => s + c.seconds, 0);

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-copy">
            <span className="eyebrow accent">{t.home.eyebrow}</span>
            <h1>{t.home.title}</h1>
            <p className="hero-lead">{t.home.lead}</p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" href="/signup">
                {t.home.primaryCta}
                <Icon name="arrowRight" className="flip-rtl" />
              </Link>
              <a className="btn btn-lg" href="#how">
                {t.home.secondaryCta}
              </a>
            </div>
          </div>

          <figure className="reel" aria-label={t.home.timelineLabel}>
            <div className="reel-bar">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="mono">{t.home.timelineLabel}</span>
              <span className="spacer" />
              <span className="mono ltr">{tc(total)}</span>
            </div>
            <div className="reel-track">
              {EXAMPLE_REEL.map((clip, i) => {
                const start = elapsed;
                elapsed += clip.seconds;
                return (
                  <div key={i} className="reel-clip" style={{ ['--w' as string]: clip.seconds }}>
                    <div className="reel-clip-head ltr">
                      <span>SC {String(i + 1).padStart(2, '0')}</span>
                      <span>{tc(start)}</span>
                    </div>
                    <span className="reel-clip-title">{t.home.reelScenes[i]}</span>
                    <div className="reel-clip-cast">
                      {clip.cast.map(([f, v]) => (
                        <FamilyGlyph key={`${f}${v}`} family={f} variant={v} size={30} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </figure>

          <div className="status-strip">
            <div>
              <span className="badge badge-success">{t.home.statusAvailable}</span>
              <p>{t.home.statusAvailableItems}</p>
            </div>
            <div>
              <span className="badge badge-warning">{t.home.statusRollout}</span>
              <p>{t.home.statusRolloutItems}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow accent">{t.home.featuresEyebrow}</span>
            <h2>{t.home.featuresTitle}</h2>
          </div>
          <div className="feature-grid">
            {features.map((f) => (
              <article key={f.title} className="feature">
                <span className="feature-icon">
                  <Icon name={f.icon} size={18} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow accent">{t.home.howEyebrow}</span>
            <h2>{t.home.howTitle}</h2>
          </div>
          <ol className="steps">
            {steps.map(([title, body]) => (
              <li key={title} className="step">
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="characters">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow accent">{t.home.castEyebrow}</span>
            <h2>{t.home.castTitle}</h2>
            <p>{t.home.castBody}</p>
          </div>
          <div className="cast-families">
            {CHARACTER_FAMILIES.map((family) => (
              <section key={family} className="cast-family" data-family={family} aria-labelledby={`fam-${family}`}>
                <div className="cast-family-head">
                  <h3 id={`fam-${family}`}>{t.characters.family[family]}</h3>
                  <span className="xsmall muted">{t.characters.familyKind[family]}</span>
                </div>
                <ul>
                  {CHARACTER_VARIANTS.map((variant) => (
                    <li key={variant} style={{ opacity: catalogs && !liveIds.has(`${family}_${variant}`) ? 0.4 : 1 }}>
                      <FamilyGlyph family={family} variant={variant} size={56} />
                      {t.characters.variant[variant]}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="xsmall muted" style={{ marginTop: 16 }}>
            {t.home.castNote}
          </p>
        </div>
      </section>

      <section className="section" id="use-cases">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow accent">{t.home.useCasesEyebrow}</span>
            <h2>{t.home.useCasesTitle}</h2>
          </div>
          <ul className="use-cases">
            {useCases.map(([title, body]) => (
              <li key={title}>
                <b>{title}</b>
                <span>{body}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow accent">{t.pricing.eyebrow}</span>
            <h2>{t.pricing.title}</h2>
            <p>{t.pricing.lead}</p>
          </div>
          <PlanCards plans={plans} t={t} intl={intl} />
          <p className="xsmall muted" style={{ marginTop: 16 }}>
            {t.pricing.manualNote}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2>{t.home.ctaTitle}</h2>
            <p>{t.home.ctaBody}</p>
            <Link className="btn btn-primary btn-lg" href="/signup">
              {t.home.primaryCta}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
