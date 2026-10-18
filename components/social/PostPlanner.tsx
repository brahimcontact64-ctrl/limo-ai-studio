'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { utcToZoned } from '@/lib/social/schedule';
import { POST_STATUSES, type PostStatus } from '@/lib/social/types';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';

export interface PlannerPost {
  id: string;
  title: string;
  caption: string;
  status: PostStatus;
  simulated: boolean;
  origin: string;
  scheduled_at: string | null;
  published_at: string | null;
  updated_at: string;
  last_error: string | null;
}

const BADGE: Record<PostStatus, string> = {
  draft: 'badge-info', awaiting_review: 'badge-warning', approved: 'badge-success', scheduled: 'badge-accent', publishing: 'badge-accent', published: 'badge-success', failed: 'badge-danger', cancelled: 'badge',
};

/** Content planner: list or month calendar of posts, filtered by status. Dates in the viewer's time zone. */
export function PostPlanner({ posts }: { posts: PlannerPost[] }) {
  const { t, intl } = useI18n();
  const s = t.social;
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [filter, setFilter] = useState<PostStatus | 'all'>('all');
  const [month, setMonth] = useState(() => utcToZoned(new Date(), zone).slice(0, 7));
  const shown = posts.filter((p) => filter === 'all' || p.status === filter);
  const dayOf = (p: PlannerPost) => {
    const at = p.published_at ?? p.scheduled_at;
    return at ? utcToZoned(new Date(at), zone).slice(0, 10) : null;
  };
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (d: number) => {
    const n = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const counts = Object.fromEntries(POST_STATUSES.map((st) => [st, posts.filter((p) => p.status === st).length])) as Record<PostStatus, number>;

  return (
    <div className="stack">
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label={s.planner.view}>
          {(['list', 'calendar'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {s.planner[v]}
            </button>
          ))}
        </div>
        <div className="row" role="group" aria-label={s.planner.filter} data-testid="status-filter">
          <button type="button" className={`chip chip-sm${filter === 'all' ? ' is-active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {t.common.all} · {posts.length}
          </button>
          {POST_STATUSES.filter((st) => counts[st] > 0).map((st) => (
            <button key={st} type="button" className={`chip chip-sm${filter === st ? ' is-active' : ''}`} aria-pressed={filter === st} onClick={() => setFilter(st)}>
              {s.status[st]} · {counts[st]}
            </button>
          ))}
        </div>
      </div>

      {view === 'list' ? (
        shown.length === 0 ? (
          <p className="empty">{t.posts.empty}</p>
        ) : (
          <ul className="project-list panel" data-testid="post-list">
            {shown.map((p) => (
              <li key={p.id} className="project-row">
                <div className="project-row-main">
                  <div className="project-row-title">
                    <Link href={`/app/posts/${p.id}`} dir="auto" prefetch={false}>
                      {p.title}
                    </Link>
                    <span className={`badge ${BADGE[p.status]}`}>{s.status[p.status]}</span>
                    {p.simulated && (p.status === 'published' || p.status === 'scheduled') && <span className="badge badge-warning plain">{s.simulatedBadge}</span>}
                    {p.origin === 'automation' && <span className="badge plain">{s.automationBadge}</span>}
                  </div>
                  <div className="project-meta">
                    <span className="clamp-1" dir="auto">
                      {p.caption.trim() || t.posts.noCaption}
                    </span>
                    {p.scheduled_at && p.status === 'scheduled' && (
                      <span>
                        <Icon name="clock" size={12} /> {new Intl.DateTimeFormat(intl, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.scheduled_at))}
                      </span>
                    )}
                    <RelativeTime iso={p.updated_at} template={t.common.updated} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <section className="panel panel-pad stack-sm" data-testid="calendar">
          <div className="row">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => shift(-1)} aria-label={s.planner.previous}>
              <Icon name="chevronLeft" className="flip-rtl" />
            </button>
            <b className="small">{new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</b>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => shift(1)} aria-label={s.planner.next}>
              <Icon name="chevronRight" className="flip-rtl" />
            </button>
            <span className="xsmall muted ltr">{zone}</span>
          </div>
          <div className="calendar-grid">
            {s.planner.weekdays.map((w) => (
              <div key={w} className="calendar-head xsmall muted">
                {w}
              </div>
            ))}
            {cells.map((d, i) => (
              <div key={i} className={`calendar-cell${d ? '' : ' empty'}`}>
                {d && <span className="xsmall muted ltr">{Number(d.slice(8))}</span>}
                {d &&
                  shown
                    .filter((p) => dayOf(p) === d)
                    .map((p) => (
                      <Link key={p.id} href={`/app/posts/${p.id}`} className={`calendar-item ${p.status}`} prefetch={false} dir="auto" title={s.status[p.status]}>
                        {p.title}
                      </Link>
                    ))}
              </div>
            ))}
          </div>
          <p className="xsmall muted">{s.planner.calendarNote}</p>
        </section>
      )}
    </div>
  );
}
