'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { diffBible } from '@/lib/story/bible';
import type { StoryBible } from '@/lib/story/types';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { useToast } from '@/components/ui/Toast';
import { postJson, storyMessage } from './api';

/** Story Bible versions: what each version changed, and restore (saved as a new version). */
export function BibleHistory({
  seriesId,
  current,
  versions,
  canEdit,
}: {
  seriesId: string;
  current: number;
  versions: Array<{ version: number; source: string; note: string | null; created_at: string; bible: StoryBible }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const h = t.stories.history;
  const b = t.stories.bible;
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<number | null>(null);

  async function restore(version: number) {
    const res = await postJson(`/api/stories/${seriesId}/bible`, { action: 'restore', version, base_version: current });
    setConfirm(null);
    if (!res.ok) return toast(storyMessage(t, res.body), 'error');
    toast(fmt(h.restored, { n: version }));
    router.refresh();
  }

  return (
    <section className="panel" aria-label={h.title}>
      <ol className="project-list">
        {versions.map((v, i) => {
          const prev = versions[i + 1];
          const changes = prev ? diffBible(prev.bible, v.bible) : [];
          return (
            <li key={v.version} className="project-row" data-testid={`bible-version-${v.version}`}>
              <div className="project-row-main">
                <div className="project-row-title">
                  <b>{fmt(b.version, { n: v.version })}</b>
                  <span className="badge plain">{(h.sources as Record<string, string>)[v.source] ?? v.source}</span>
                  {v.version === current && <span className="badge badge-success">{h.current}</span>}
                </div>
                <div className="project-meta">
                  <RelativeTime iso={v.created_at} />
                  <span>{fmt(h.sections, { characters: v.bible.characters.length, locations: v.bible.locations.length, arcs: v.bible.arcs.length })}</span>
                  {v.note && <span dir="auto">{v.note}</span>}
                </div>
                {changes.length > 0 && (
                  <ul className="plain-list xsmall muted">
                    {changes.slice(0, 8).map((c, j) => (
                      <li key={j}>
                        {b.changes[c.kind]} · {b.sections[c.section]} · <span dir="auto">{c.key}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {confirm === v.version && (
                  <div className="callout callout-warning stack-sm" role="alert">
                    <strong>{fmt(h.restoreTitle, { n: v.version })}</strong>
                    <span>{fmt(h.restoreBody, { n: v.version })}</span>
                    <div className="row">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>
                        {t.common.cancel}
                      </button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void restore(v.version)}>
                        {h.restore}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {canEdit && v.version !== current && confirm !== v.version && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(v.version)}>
                  {h.restore}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
