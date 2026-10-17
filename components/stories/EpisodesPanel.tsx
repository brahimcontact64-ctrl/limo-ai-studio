'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { postJson, storyMessage } from './api';

export interface EpisodeListItem {
  id: string;
  episode_number: number;
  title: string | null;
  season_id: string | null;
  project_id: string | null;
  checkpoint_status: 'none' | 'draft' | 'approved';
  checkpoint_fingerprint: string | null;
  review_status: 'ok' | 'needs_review';
  script_status: string | null;
  summary: string;
}

/** Episode list, optional seasons, and Start / Continue Story (only from the latest approved, reviewed ending). */
export function EpisodesPanel({
  seriesId,
  episodes,
  seasons,
  canEdit,
}: {
  seriesId: string;
  episodes: EpisodeListItem[];
  seasons: Array<{ id: string; season_number: number; title: string }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const e = t.stories.episodes;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<string>(seasons[seasons.length - 1]?.id ?? '');
  const latest = episodes[episodes.length - 1] ?? null;
  const blocked = latest
    ? latest.checkpoint_status !== 'approved'
      ? fmt(e.blockedNotApproved, { n: latest.episode_number })
      : latest.review_status !== 'ok'
        ? fmt(e.blockedReview, { n: latest.episode_number })
        : null
    : null;

  async function continueStory() {
    setBusy(true);
    const res = await postJson<{ episode_number?: number }>(`/api/stories/${seriesId}/episodes`, {
      based_on_episode_id: latest?.id ?? null,
      based_on_fingerprint: latest?.checkpoint_fingerprint ?? null,
      season_id: season || null,
    });
    setBusy(false);
    if (!res.ok || !res.body.episode_number) return toast(storyMessage(t, res.body), 'error');
    toast(fmt(e.created, { n: res.body.episode_number }));
    router.push(`/app/stories/${seriesId}/episodes/${res.body.episode_number}`);
  }

  async function addSeason() {
    const res = await postJson<{ season_number?: number }>(`/api/stories/${seriesId}/seasons`, { title: '' });
    if (!res.ok) return toast(storyMessage(t, res.body), 'error');
    toast(fmt(e.seasonAdded, { n: res.body.season_number ?? '' }));
    router.refresh();
  }

  const seasonTitle = (id: string | null) => seasons.find((s) => s.id === id);
  const status = (ep: EpisodeListItem) => (ep.checkpoint_status === 'approved' ? e.status.approved : ep.script_status === 'approved' ? e.status.script : e.status.draft);

  return (
    <section className="stack">
      {canEdit && (
        <div className="panel panel-pad stack-sm">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void continueStory()} disabled={busy || Boolean(blocked)}>
                <Icon name={latest ? 'arrowRight' : 'plus'} className={latest ? 'flip-rtl' : undefined} />
                {latest ? e.continue : e.start}
              </button>
              {seasons.length > 0 && (
                <select className="select select-sm" value={season} onChange={(ev) => setSeason(ev.target.value)} aria-label={e.season}>
                  <option value="">{e.noSeason}</option>
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {e.season} {s.season_number}: {s.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void addSeason()}>
              {e.addSeason}
            </button>
          </div>
          {blocked ? (
            <p className="small muted" role="note">
              {blocked}
            </p>
          ) : latest ? (
            <p className="small muted">{fmt(e.continueHint, { n: latest.episode_number + 1, prev: latest.episode_number })}</p>
          ) : null}
          <p className="xsmall muted">{e.mockNotice}</p>
        </div>
      )}
      {episodes.length > 0 && (
        <ol className="project-list panel episode-list">
          {episodes.map((ep) => (
            <li key={ep.id} className="project-row" data-testid={`episode-${ep.episode_number}`}>
              <div className="project-row-main">
                <div className="project-row-title">
                  <Link prefetch={false} href={`/app/stories/${seriesId}/episodes/${ep.episode_number}`}>
                    {fmt(e.number, { n: ep.episode_number })}
                    {ep.title && ep.title !== fmt(e.number, { n: ep.episode_number }) ? ` · ${ep.title}` : ''}
                  </Link>
                  <span className={`badge ${ep.checkpoint_status === 'approved' ? 'badge-success' : ''}`}>{status(ep)}</span>
                  {ep.review_status === 'needs_review' && <span className="badge badge-warning">{e.needsReview}</span>}
                </div>
                <div className="project-meta">
                  {seasonTitle(ep.season_id) && (
                    <span>
                      {e.season} {seasonTitle(ep.season_id)!.season_number}
                    </span>
                  )}
                  {ep.summary && (
                    <span dir="auto" className="clamp-1">
                      {ep.summary}
                    </span>
                  )}
                </div>
              </div>
              {ep.project_id && (
                <Link className="btn btn-ghost btn-sm" prefetch={false} href={`/app/projects/${ep.project_id}`}>
                  {e.openScript}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
