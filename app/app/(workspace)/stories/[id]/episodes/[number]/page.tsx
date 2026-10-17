import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAppContext, canEditRole } from '@/lib/data/context';
import { listCheckpointVersions, loadSeries } from '@/lib/data/stories';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { isUuid } from '@/lib/studio/validation';
import { Icon } from '@/components/ui/Icon';
import { EpisodeEditor } from '@/components/stories/EpisodeEditor';

type Params = { params: Promise<{ id: string; number: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t } = await getI18n();
  const { number } = await params;
  return { title: fmt(t.stories.episodes.number, { n: Number(number) || '' }) };
}

export default async function EpisodePage({ params }: Params) {
  const { id, number } = await params;
  const n = Number(number);
  if (!isUuid(id) || !Number.isInteger(n) || n < 1) notFound();
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const series = await loadSeries(supabase, id);
  const episode = series?.episodes.find((e) => e.episode_number === n);
  if (!series || !episode) notFound();
  const prev = series.episodes.find((e) => e.episode_number === n - 1);
  const versions = await listCheckpointVersions(supabase, episode.id);
  const canEdit = canEditRole(ctx.memberships.find((m) => m.organization_id === series.organization_id)?.role);

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href={`/app/stories/${id}`}>
            <Icon name="chevronLeft" className="flip-rtl" size={12} /> {series.title}
          </Link>
          <h1>
            {fmt(t.stories.episodes.number, { n })}
            {episode.title && episode.title !== fmt(t.stories.episodes.number, { n }) ? ` · ${episode.title}` : ''}
          </h1>
        </div>
        <div className="row">
          <span className={`badge ${episode.checkpoint_status === 'approved' ? 'badge-success' : ''}`} data-testid="episode-status">
            {episode.checkpoint_status === 'approved'
              ? t.stories.episodes.status.approved
              : episode.script_status === 'approved'
                ? t.stories.episodes.status.script
                : t.stories.episodes.status.draft}
          </span>
        </div>
      </div>
      <EpisodeEditor
        key={`${episode.checkpoint_updated_at}-${episode.checkpoint_status}-${episode.review_status}`}
        seriesId={id}
        episode={episode}
        previous={prev?.approved_checkpoint ? { episode_number: prev.episode_number, checkpoint: prev.approved_checkpoint } : null}
        bible={series.bible}
        bibleVersion={series.current_bible_version}
        versions={versions}
        canEdit={canEdit}
      />
    </div>
  );
}
