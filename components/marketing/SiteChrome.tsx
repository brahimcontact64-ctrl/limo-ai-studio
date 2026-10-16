import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Icon } from '@/components/ui/Icon';
import { fmt } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

export function SiteHeader({ t, signedIn }: { t: Dictionary; signedIn: boolean }) {
  const links = [
    { href: '/#safety', label: t.nav.safety },
    { href: '/#how', label: t.nav.howItWorks },
    { href: '/#characters', label: t.nav.characters },
    { href: '/#pricing', label: t.nav.pricing },
    { href: signedIn ? '/app' : '/login', label: t.nav.customerLogin },
  ];
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" aria-label={t.common.brand}>
          <Logo />
        </Link>
        <nav className="site-nav" aria-label={t.nav.mainNavigation}>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="site-header-actions">
          <span className="hide-sm">
            <LocaleSwitcher compact />
          </span>
          <Link className="btn btn-primary" href={signedIn ? '/app' : '/signup'}>
            {signedIn ? t.common.openStudio : t.home.navCta}
          </Link>
          <details className="mobile-menu">
            <summary className="btn btn-icon" aria-label={t.nav.menu}>
              <Icon name="menu" />
            </summary>
            <div className="mobile-menu-panel">
              {links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
              <Link href="/faq">{t.nav.faq}</Link>
              <div style={{ padding: '8px 12px' }}>
                <LocaleSwitcher />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ t }: { t: Dictionary }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <nav aria-label={t.nav.product}>
          <Link href="/pricing">{t.nav.pricing}</Link>
          <Link href="/faq">{t.nav.faq}</Link>
          <Link href="/contact">{t.nav.contact}</Link>
          <Link href="/legal/terms">{t.nav.terms}</Link>
          <Link href="/legal/privacy">{t.nav.privacy}</Link>
        </nav>
        <LocaleSwitcher />
        <p className="row" style={{ justifyContent: 'center', gap: 6 }}>
          <Logo compact /> {fmt(t.footer.rights, { year: new Date().getFullYear() })} · {t.footer.tagline}
        </p>
      </div>
    </footer>
  );
}
