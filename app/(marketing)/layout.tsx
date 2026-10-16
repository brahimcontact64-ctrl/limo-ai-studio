import { SiteFooter, SiteHeader } from '@/components/marketing/SiteChrome';
import { getI18n } from '@/lib/i18n/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  let signedIn = false;
  if (hasSupabaseEnv()) {
    const supabase = await getSupabaseServer();
    signedIn = Boolean((await supabase.auth.getUser()).data.user);
  }
  return (
    <>
      <SiteHeader t={t} signedIn={signedIn} />
      <main id="main">{children}</main>
      <SiteFooter t={t} />
    </>
  );
}
