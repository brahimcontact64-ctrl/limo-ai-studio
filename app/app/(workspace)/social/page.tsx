import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { featureFlag, listPages, listPolicies, loadControls } from '@/lib/data/social';
import { getSupabaseServer } from '@/lib/supabase/server';
import { untyped } from '@/lib/supabase/rpc';
import { getI18n } from '@/lib/i18n/server';
import { SocialSettings } from '@/components/social/SocialSettings';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.social };
}

export default async function SocialPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const org = ctx.org;
  if (!org) return <div className="content-inner"><p className="empty">{t.common.errorGeneric}</p></div>;
  const [pages, policies, controls, autoAvailable, usage] = await Promise.all([
    listPages(supabase, org.organization_id),
    listPolicies(supabase, org.organization_id),
    loadControls(supabase, org.organization_id),
    featureFlag(supabase, 'auto_publishing'),
    untyped(supabase).from('usage_balances').select('base_facebook_pages, extra_facebook_pages').eq('organization_id', org.organization_id).maybeSingle(),
  ]);
  const u = usage.data as { base_facebook_pages: number; extra_facebook_pages: number } | null;
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/posts">
            {t.posts.title}
          </Link>
          <h1>{t.nav.social}</h1>
          <p>{t.social.settingsLead}</p>
        </div>
      </div>
      <SocialSettings
        pages={pages}
        policies={policies}
        paused={controls.paused}
        pausedReason={controls.reason}
        autoAvailable={autoAvailable}
        canEdit={ctx.canEdit}
        canAuthorize={org.role === 'owner' || org.role === 'admin'}
        pageLimit={u ? u.base_facebook_pages + u.extra_facebook_pages : 0}
      />
    </div>
  );
}
