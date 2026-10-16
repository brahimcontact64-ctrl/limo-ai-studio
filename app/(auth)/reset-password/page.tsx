import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getI18n } from '@/lib/i18n/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { ResetPasswordForm } from '@/components/auth/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.resetTitle, robots: { index: false } };
}

/** Reached from the recovery email via /auth/confirm, which establishes a short-lived session. */
export default async function Page() {
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AuthCard t={t} title={t.auth.resetLinkTitle} lead={t.auth.resetLinkBody} narrow>
        <div style={{ marginTop: 20 }}>
          <Link className="btn btn-primary btn-lg btn-block" href="/forgot-password">
            {t.auth.requestNewLink}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard t={t} title={t.auth.resetTitle} lead={t.auth.resetLead}>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
