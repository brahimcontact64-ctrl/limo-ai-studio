import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { getI18n } from '@/lib/i18n/server';
import { CREATION_MODES, type CreationMode } from '@/lib/create/modes';
import { Icon, type IconName } from '@/components/ui/Icon';

const MODE_ICON: Record<CreationMode, IconName> = {
  product_ad: 'box',
  business_promo: 'store',
  social_video: 'play',
  social_post: 'image',
  story: 'book',
  explainer: 'bulb',
  ugc_ad: 'mic',
  custom: 'sparkle',
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.create };
}

export default async function CreatePage() {
  await requireAppContext();
  const { t } = await getI18n();
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.create.title}</h1>
          <p>{t.create.lead}</p>
        </div>
      </div>
      <ul className="mode-grid">
        {CREATION_MODES.map((m) => (
          <li key={m}>
            {/* Story projects need a cast, so they open the full studio wizard. */}
            <Link className="mode-card" href={m === 'story' ? '/app/projects/new' : `/app/create/${m}`} data-mode={m}>
              <span className="mode-icon">
                <Icon name={MODE_ICON[m]} size={22} />
              </span>
              <b>{t.create.modes[m].name}</b>
              <span className="small muted">{t.create.modes[m].body}</span>
              <Icon name="arrowRight" className="mode-arrow flip-rtl" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
