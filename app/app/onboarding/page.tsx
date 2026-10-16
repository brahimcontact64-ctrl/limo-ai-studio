import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { OnboardingForm } from '@/components/app/OnboardingForm';
import { loadAppContext } from '@/lib/data/context';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.onboarding.title, robots: { index: false } };
}

export default async function OnboardingPage() {
  const ctx = await loadAppContext();
  if (!ctx) redirect('/login');
  if (ctx.profile) redirect('/app');
  const { t } = await getI18n();
  return (
    <div style={{ minHeight: '100dvh' }}>
      <header className="topbar" style={{ position: 'static' }}>
        <Link href="/" aria-label={t.common.brand}>
          <Logo />
        </Link>
        <span className="spacer" />
        <LocaleSwitcher compact />
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost btn-sm" type="submit">
            {t.common.signOut}
          </button>
        </form>
      </header>
      <main id="main" className="container" style={{ maxWidth: 720, paddingBlock: 48 }}>
        <div className="page-head">
          <div>
            <span className="eyebrow accent">{ctx.user.email}</span>
            <h1 style={{ marginTop: 12 }}>{t.onboarding.title}</h1>
            <p>{t.onboarding.lead}</p>
          </div>
        </div>
        <div className="panel panel-pad">
          <OnboardingForm />
        </div>
      </main>
    </div>
  );
}
