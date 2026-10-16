import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getI18n } from '@/lib/i18n/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { SignInForm } from '@/components/auth/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signInTitle, robots: { index: false } };
}

export default async function Page() {
  const { t } = await getI18n();
  return (
    <AuthCard
      t={t}
      title={t.auth.signInTitle}
      lead={t.auth.signInLead}
      footer={
        <div className="auth-separation">
          <span>{t.auth.platformAdmin}</span>
          <Link href="/login?next=/admin">{t.auth.adminSignIn}</Link>
        </div>
      }
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthCard>
  );
}
