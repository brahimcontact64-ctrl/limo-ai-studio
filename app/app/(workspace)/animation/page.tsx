import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listAnimationProjects } from '@/lib/data/animation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { NewAnimation } from '@/components/animation/NewAnimation';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.animation.title };
}

export default async function AnimationPage() {
  const ctx = await requireAppContext();
  const { t, locale } = await getI18n();
  const a = t.animation;
  const projects = ctx.org ? await listAnimationProjects(await getSupabaseServer(), ctx.org.organization_id) : [];
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{a.title}</h1>
          <p>{a.lead}</p>
        </div>
        {ctx.canEdit && projects !== null && (
          <div className="page-actions">
            <NewAnimation defaultLanguage={locale} />
          </div>
        )}
      </div>
      {projects === null ? (
        <p className="callout callout-warning">{a.unavailable}</p>
      ) : projects.length === 0 ? (
        <p className="empty">{a.empty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="animation-list">
          {projects.map((p) => (
            <li key={p.id} className="panel panel-pad row">
              <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/app/animation/${p.id}`} dir="auto"><b>{p.title}</b></Link>
                <span className="xsmall muted">
                  {fmt(a.shotsCount, { n: p.shots, s: p.seconds })} · {p.aspect} · {p.language_code.toUpperCase()} · <RelativeTime iso={p.updated_at} />
                </span>
              </div>
              <span className="badge plain">{(a.statuses as Record<string, string>)[p.status] ?? p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
