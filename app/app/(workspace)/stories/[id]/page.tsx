import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAppContext, canEditRole } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { customAsRecords, listCustomCharacters } from '@/lib/data/characters';
import { listBibleVersions, listTimeline, loadSeries, type EpisodeRow } from '@/lib/data/stories';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { isUuid } from '@/lib/studio/validation';
import { EpisodesPanel } from '@/components/stories/EpisodesPanel';
import { BibleEditor } from '@/components/stories/BibleEditor';
import { BibleHistory } from '@/components/stories/BibleHistory';

type Tab = 'episodes' | 'bible' | 'timeline' | 'history';
const TABS: Tab[] = ['episodes', 'bible', 'timeline', 'history'];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) return { title: t.stories.title };
  const series = await loadSeries(await getSupabaseServer(), id);
  return { title: series?.title ?? t.stories.title };
}

export default async function SeriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const series = await loadSeries(supabase, id);
  if (!series) notFound();
  const requested = (await searchParams).tab as Tab | undefined;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'episodes';
  const canEdit = canEditRole(ctx.memberships.find((m) => m.organization_id === series.organization_id)?.role);
  const s = t.stories;
  const nameOf = (ref: string) => series.bible.characters.find((c) => c.ref === ref)?.name ?? ref;

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/stories">
            {s.title}
          </Link>
          <h1 dir="auto">{series.title}</h1>
          {series.bible.premise && (
            <p dir="auto" className="clamp-2">
              {series.bible.premise}
            </p>
          )}
        </div>
      </div>
      <nav className="tabs admin-tabs" aria-label={series.title}>
        {TABS.map((k) => (
          <Link key={k} className="tab" href={`/app/stories/${id}?tab=${k}`} aria-selected={tab === k} aria-current={tab === k ? 'page' : undefined}>
            {s.tabs[k]}
          </Link>
        ))}
      </nav>

      {tab === 'episodes' && (
        <EpisodesPanel
          seriesId={id}
          canEdit={canEdit}
          seasons={series.seasons}
          episodes={series.episodes.map((e) => ({
            id: e.id,
            episode_number: e.episode_number,
            title: e.title,
            season_id: e.season_id,
            project_id: e.project_id,
            checkpoint_status: e.checkpoint_status,
            checkpoint_fingerprint: e.checkpoint_fingerprint,
            review_status: e.review_status,
            script_status: e.script_status,
            summary: (e.approved_checkpoint ?? e.checkpoint).summary,
          }))}
        />
      )}

      {tab === 'bible' && (
        <BibleEditor
          seriesId={id}
          version={series.current_bible_version}
          bible={series.bible}
          canEdit={canEdit}
          characters={[...(await getCatalogs()).characters, ...customAsRecords(await listCustomCharacters(supabase, series.organization_id))]}
        />
      )}

      {tab === 'timeline' && (
        <Timeline
          t={t}
          episodes={series.episodes}
          events={await listTimeline(supabase, id)}
          arcs={series.bible.arcs}
          locations={series.bible.locations}
          nameOf={nameOf}
        />
      )}

      {tab === 'history' && <BibleHistory seriesId={id} current={series.current_bible_version} versions={await listBibleVersions(supabase, id)} canEdit={canEdit} />}
    </div>
  );
}

function Timeline({
  t,
  episodes,
  events,
  arcs,
  locations,
  nameOf,
}: {
  t: Awaited<ReturnType<typeof getI18n>>['t'];
  episodes: EpisodeRow[];
  events: Awaited<ReturnType<typeof listTimeline>>;
  arcs: Array<{ id: string; title: string; status: string; opened_in: number | null; resolved_in: number | null }>;
  locations: Array<{ key: string; name: string }>;
  nameOf: (ref: string) => string;
}) {
  const s = t.stories;
  const approved = episodes.filter((e) => e.checkpoint_status === 'approved' && e.approved_checkpoint);
  const latest = approved[approved.length - 1];
  const loc = (key: string) => locations.find((l) => l.key === key)?.name ?? (key || s.timeline.none);
  return (
    <div className="stack-lg">
      {approved.length === 0 ? (
        <p className="empty">{s.timeline.empty}</p>
      ) : (
        <ol className="story-timeline">
          {approved.map((e) => (
            <li key={e.id} className="story-timeline-episode">
              <h3 className="section-title">{fmt(s.timeline.episode, { n: e.episode_number })}</h3>
              <ol className="plain-list">
                {events
                  .filter((ev) => ev.episode_id === e.id)
                  .map((ev) => (
                    <li key={ev.id} className="small" data-testid="timeline-event">
                      <span dir="auto">{ev.text}</span>
                      {ev.characters.length > 0 && <span className="muted"> · {ev.characters.map(nameOf).join(', ')}</span>}
                      <span className="xsmall muted ltr"> · {fmt(s.timeline.scenes, { list: ev.scenes.join(', ') })}</span>
                    </li>
                  ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      <div className="form-grid cols-2">
        <section className="panel panel-pad stack-sm">
          <h3 className="section-title">{s.timeline.openThreads}</h3>
          <ul className="plain-list small" data-testid="open-threads">
            {arcs.filter((a) => a.status === 'open').map((a) => (
              <li key={a.id} dir="auto">
                {a.title}
                {a.opened_in ? <span className="xsmall muted"> · {fmt(s.bible.openedIn, { n: a.opened_in })}</span> : null}
              </li>
            ))}
          </ul>
          <h3 className="section-title">{s.timeline.resolvedThreads}</h3>
          <ul className="plain-list small">
            {arcs.filter((a) => a.status === 'resolved').map((a) => (
              <li key={a.id} dir="auto">
                {a.title}
                {a.resolved_in ? <span className="xsmall muted"> · {fmt(s.bible.resolvedIn, { n: a.resolved_in })}</span> : null}
              </li>
            ))}
          </ul>
        </section>
        {latest?.approved_checkpoint && (
          <section className="panel panel-pad stack-sm">
            <h3 className="section-title">{s.timeline.latestStates}</h3>
            <ul className="plain-list small">
              {latest.approved_checkpoint.characters.map((c) => (
                <li key={c.ref} dir="auto">
                  <b>{nameOf(c.ref)}</b> · {loc(c.location_key)}
                  {[c.emotional_state, c.physical_state, c.current_goal].filter(Boolean).length > 0 && ` · ${[c.emotional_state, c.physical_state, c.current_goal].filter(Boolean).join('; ')}`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
