import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { getI18n } from '@/lib/i18n/server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="auth">
      <aside className="auth-side">
        <Link href="/" aria-label={t.common.brand}>
          <Logo />
        </Link>
        <div>
          <h2>{t.auth.sideTitle}</h2>
          <p>{t.auth.sideBody}</p>
        </div>
        <div className="auth-cast" aria-hidden="true">
          <FamilyGlyph family="limo" variant="man" size={72} />
          <FamilyGlyph family="nova" variant="girl" size={72} />
          <FamilyGlyph family="adam" variant="elder_man" size={72} />
          <FamilyGlyph family="nova" variant="elder_woman" size={72} />
          <FamilyGlyph family="limo" variant="boy" size={72} />
        </div>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-top">
          <Link href="/" className="btn btn-ghost btn-sm" aria-label={t.common.brand}>
            <span className="hide-desktop">
              <Logo compact />
            </span>
          </Link>
          <LocaleSwitcher compact />
        </div>
        {children}
      </main>
    </div>
  );
}
