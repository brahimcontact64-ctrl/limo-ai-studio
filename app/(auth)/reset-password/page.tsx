import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getI18n } from '@/lib/i18n/server';
import { ResetPasswordForm } from '@/components/auth/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.resetTitle, robots: { index: false } };
}

export default async function Page() {
  const { t } = await getI18n();
  return (
    <div className="auth-card">
      <div>
        <h1>{t.auth.resetTitle}</h1>
        <p className="lead">{t.auth.resetLead}</p>
      </div>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
