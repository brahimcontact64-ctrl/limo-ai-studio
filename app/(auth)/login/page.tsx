import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getI18n } from '@/lib/i18n/server';
import { SignInForm } from '@/components/auth/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signInTitle, robots: { index: false } };
}

export default async function Page() {
  const { t } = await getI18n();
  return (
    <div className="auth-card">
      <div>
        <h1>{t.auth.signInTitle}</h1>
        <p className="lead">{t.auth.signInLead}</p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  );
}
