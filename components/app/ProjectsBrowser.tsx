'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { formatDuration, plural } from '@/lib/i18n/format';
import { RelativeTime } from '@/components/ui/RelativeTime';
import type { ProjectStatus } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { ProjectMenu } from '@/components/studio/ProjectMenu';
import type { CreationMode } from '@/lib/create/modes';
import { CastStack, StatusBadge } from './ProjectBits';

export interface ProjectListItem {
  id: string;
  title: string;
  status: ProjectStatus;
  creation_mode: CreationMode;
  content_type: string;
  language_code: string;
  cast: string[];
  scene_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
}

type Sort = 'updated' | 'created' | 'title';
const STATUSES: ProjectStatus[] = ['draft', 'ready', 'queued', 'generating', 'generated', 'approved'];

export function ProjectsBrowser({ projects, canEdit }: { projects: ProjectListItem[]; canEdit: boolean }) {
  const { t, intl } = useI18n();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ProjectStatus>('all');
  const [sort, setSort] = useState<Sort>('updated');
  const [showArchived, setShowArchived] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(intl);
    return projects
      .filter((p) => !removed.has(p.id))
      .filter((p) => (showArchived ? true : p.status !== 'archived'))
      .filter((p) => status === 'all' || p.status === status)
      .filter((p) => !q || p.title.toLocaleLowerCase(intl).includes(q))
      .sort((a, b) =>
        sort === 'title' ? a.title.localeCompare(b.title, intl) : sort === 'created' ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at),
      );
  }, [projects, removed, showArchived, status, query, sort, intl]);

  const archivedCount = projects.filter((p) => p.status === 'archived').length;

  return (
    <>
      <div className="toolbar" role="search">
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">{t.common.search}</span>
          <input className="input" type="search" placeholder={t.projects.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          <span className="sr-only">{t.projects.filterStatus}</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'all' | ProjectStatus)}>
            <option value="all">
              {t.projects.filterStatus}: {t.common.all}
            </option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.projects.status[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t.projects.sort}</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="updated">{t.projects.sortUpdated}</option>
            <option value="created">{t.projects.sortCreated}</option>
            <option value="title">{t.projects.sortTitle}</option>
          </select>
        </label>
        {archivedCount > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>
              {t.projects.showArchived} <span className="mono ltr">({archivedCount})</span>
            </span>
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        projects.length === 0 ? (
          <div className="empty">
            <h3>{t.dashboard.emptyTitle}</h3>
            <p>{t.dashboard.emptyBody}</p>
            <Link className="btn btn-primary" href="/app/create">
              {t.dashboard.createFirst}
            </Link>
          </div>
        ) : (
          <div className="empty">
            <p>{t.projects.empty}</p>
          </div>
        )
      ) : (
        <ul className="project-list panel">
          {visible.map((p) => (
            <li key={p.id} className="project-row">
              <div className="project-row-main">
                <div className="project-row-title">
                  <Link href={`/app/projects/${p.id}`}>{p.title}</Link>
                  <StatusBadge status={p.status} t={t} />
                </div>
                <div className="project-meta">
                  <span>{t.create.modes[p.creation_mode].name}</span>
                  <span className="mono">{p.language_code.toUpperCase()}</span>
                  <span>{plural(p.scene_count, t.projects.scene, t.projects.scenes)}</span>
                  <span className="mono ltr">{formatDuration(t, p.total_duration_seconds)}</span>
                  <RelativeTime iso={p.updated_at} template={t.common.updated} />
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="hide-xs">
                  <CastStack ids={p.cast} />
                </span>
                <ProjectMenu
                  projectId={p.id}
                  title={p.title}
                  status={p.status}
                  canEdit={canEdit}
                  onDeleted={() => setRemoved((s) => new Set(s).add(p.id))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
