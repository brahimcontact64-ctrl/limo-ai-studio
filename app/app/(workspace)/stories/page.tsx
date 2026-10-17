import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { customAsRecords, listCustomCharacters } from '@/lib/data/characters';
import { listSeries } from '@/lib/data/stories';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { NewSeries } from '@/components/stories/NewSeries';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.stories.title };
}

export default async function StoriesPage() {
  const ctx = await requireAppContext();
  const { t, locale } = await getI18n();
  const supabase = await getSupabaseServer();
  const org = ctx.org;
  const [series, catalogs, custom] = await Promise.all([
    org ? listSeries(supabase, org.organization_id) : Promise.resolve([]),
    getCatalogs(),
    org ? listCustomCharacters(supabase, org.organization_id) : Promise.resolve([]),
  ]);
  const codes = catalogs.languages.map((l) => l.code);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.stories.title}</h1>
          <p>{t.stories.lead}</p>
        </div>
        {ctx.canEdit && series !== null && (
          <div className="page-actions">
            <NewSeries characters={[...catalogs.characters, ...customAsRecords(custom)]} languages={catalogs.languages} defaultLanguage={codes.includes(locale) ? locale : (codes[0] ?? 'en')} />
          </div>
        )}
      </div>
      {series === null ? (
        <p className="callout callout-warning">{t.stories.unavailable}</p>
      ) : series.length === 0 ? (
        <p className="empty">{t.stories.empty}</p>
      ) : (
        <ul className="project-list panel">
          {series.map((s) => (
            <li key={s.id} className="project-row">
              <div className="project-row-main">
                <div className="project-row-title">
                  <Link href={`/app/stories/${s.id}`} dir="auto">
                    {s.title}
                  </Link>
                  {s.needs_review > 0 && <span className="badge badge-warning">{fmt(t.stories.needsReviewN, { n: s.needs_review })}</span>}
                </div>
                <div className="project-meta">
                  <span>{fmt(t.stories.episodesN, { n: s.episodes })}</span>
                  <span className="mono">{s.language_code.toUpperCase()}</span>
                  <span>{fmt(t.stories.bible.version, { n: s.current_bible_version })}</span>
                  <RelativeTime iso={s.updated_at} template={t.common.updated} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
