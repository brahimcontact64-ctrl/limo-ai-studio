import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getI18n } from '@/lib/i18n/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { SignUpForm } from '@/components/auth/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signUpTitle, robots: { index: false } };
}

export default async function Page() {
  const { t } = await getI18n();
  return (
    <AuthCard
      t={t}
      title={t.auth.signUpTitle}
      lead={t.auth.signUpLead}
    >
      <Suspense>
        <SignUpForm />
      </Suspense>
    </AuthCard>
  );
}
