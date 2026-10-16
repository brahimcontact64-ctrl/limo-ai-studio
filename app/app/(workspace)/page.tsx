import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listProjects } from '@/lib/data/projects';
import { getPlans } from '@/lib/data/catalog';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/config';
import { formatDate, formatDuration, plural } from '@/lib/i18n/format';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';
import { CastStack, Meter, StatusBadge } from '@/components/app/ProjectBits';
import { SubscriptionNotice } from '@/components/app/SubscriptionNotice';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.dashboard };
}

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const orgId = ctx.org?.organization_id;

  if (!orgId) {
    return (
      <div className="content-inner">
        <div className="empty">
          <h3>{t.app.noMembership}</h3>
          <p>{t.app.noMembershipBody}</p>
        </div>
      </div>
    );
  }

  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
  const [recent, total, drafts, inProduction, runs, memberCount] = await Promise.all([
    listProjects(supabase, orgId, 6),
    count(supabase.from('studio_projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).neq('status', 'archived')),
    count(supabase.from('studio_projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['draft', 'ready'])),
    count(supabase.from('studio_projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['queued', 'generating'])),
    count(supabase.from('generation_runs').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)),
    count(supabase.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId)),
  ]);

  const sub = ctx.subscription;
  const planName = sub ? ((await getPlans())?.find((p) => p.code === sub.plan_code)?.name ?? sub.plan_code) : null;
  const usage = ctx.usage;
  const recentActive = (recent ?? []).filter((p) => p.status !== 'archived');

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <span className="eyebrow">{ctx.org?.name}</span>
          <h1 style={{ marginTop: 8 }}>{t.dashboard.greeting}</h1>
          <p>{t.dashboard.lead}</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" href="/app/projects/new">
            <Icon name="plus" />
            {t.nav.newProject}
          </Link>
        </div>
      </div>

      {!ctx.subscriptionActive && (
        <div style={{ marginBottom: 24 }}>
          <SubscriptionNotice t={t} />
        </div>
      )}

      <dl className="stat-row">
        <div className="stat">
          <dt>{t.dashboard.stats.projects}</dt>
          <dd className="ltr">{total}</dd>
        </div>
        <div className="stat">
          <dt>{t.dashboard.stats.drafts}</dt>
          <dd className="ltr">{drafts}</dd>
        </div>
        <div className="stat">
          <dt>{t.dashboard.stats.inProduction}</dt>
          <dd className="ltr">{inProduction}</dd>
        </div>
        <div className="stat">
          <dt>{t.dashboard.stats.generationRuns}</dt>
          <dd className="ltr">{runs}</dd>
        </div>
      </dl>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="recent-h">
          <div className="panel-head">
            <h2 id="recent-h">{t.dashboard.recentProjects}</h2>
            {recentActive.length > 0 && (
              <Link className="btn btn-ghost btn-sm" href="/app/projects">
                {t.dashboard.viewAll}
                <Icon name="chevronRight" className="flip-rtl" />
              </Link>
            )}
          </div>
          {recent === null ? (
            <div className="panel-body">
              <p className="muted">{t.common.errorGeneric}</p>
            </div>
          ) : recentActive.length === 0 ? (
            <div className="panel-body">
              <div className="empty">
                <h3>{t.dashboard.emptyTitle}</h3>
                <p>{t.dashboard.emptyBody}</p>
                <Link className="btn btn-primary" href="/app/projects/new">
                  {t.dashboard.createFirst}
                </Link>
              </div>
            </div>
          ) : (
            <ul className="project-list">
              {recentActive.map((p) => (
                <li key={p.id} className="project-row">
                  <div className="project-row-main">
                    <div className="project-row-title">
                      <Link href={`/app/projects/${p.id}`}>{p.title}</Link>
                      <StatusBadge status={p.status} t={t} />
                    </div>
                    <div className="project-meta">
                      <span>{plural(p.scene_count, t.projects.scene, t.projects.scenes)}</span>
                      <span className="mono ltr">{formatDuration(t, p.total_duration_seconds)}</span>
                      <RelativeTime iso={p.updated_at} template={t.common.updated} />
                    </div>
                  </div>
                  <CastStack ids={p.cast} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="plan-h">
            <div className="panel-head">
              <h2 id="plan-h">{t.dashboard.plan}</h2>
              <span className={`badge ${ctx.subscriptionActive ? 'badge-success' : 'badge-warning'}`}>
                {sub ? t.billing.status[sub.status as keyof typeof t.billing.status] ?? sub.status : t.billing.status.none}
              </span>
            </div>
            <div className="panel-body stack">
              <p style={{ fontWeight: 600 }}>{planName ?? t.dashboard.noPlan}</p>
              {sub?.renews_at && (
                <p className="small muted">
                  {fmt(ctx.subscriptionActive ? t.dashboard.renews : t.dashboard.expired, { date: formatDate(intl, sub.renews_at) })}
                </p>
              )}
              <Link className="btn btn-sm" href="/app/billing">
                {t.nav.billing}
              </Link>
            </div>
          </section>

          <section className="panel" aria-labelledby="usage-h">
            <div className="panel-head">
              <h2 id="usage-h">{t.dashboard.usage}</h2>
            </div>
            <div className="panel-body stack">
              {usage ? (
                <>
                  <Meter
                    label={t.dashboard.videoSlots}
                    used={usage.used_video_slots}
                    total={usage.base_video_slots + usage.extra_video_slots}
                    hint={fmt(t.billing.used, { used: usage.used_video_slots, total: usage.base_video_slots + usage.extra_video_slots })}
                  />
                  <Meter
                    label={t.dashboard.images}
                    used={usage.used_images}
                    total={usage.base_images + usage.extra_images}
                    hint={fmt(t.billing.used, { used: usage.used_images, total: usage.base_images + usage.extra_images })}
                  />
                  <p className="xsmall muted">{fmt(t.dashboard.cycleEnds, { date: formatDate(intl, usage.cycle_end) })}</p>
                </>
              ) : (
                <p className="small muted">{t.dashboard.usageNone}</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="ws-h">
            <div className="panel-head">
              <h2 id="ws-h">{t.dashboard.workspaceInfo}</h2>
            </div>
            <div className="panel-body">
              <dl className="dl">
                <div>
                  <dt>{t.settings.name}</dt>
                  <dd>{ctx.org?.name}</dd>
                </div>
                <div>
                  <dt>{t.settings.yourRole}</dt>
                  <dd>{ctx.org ? t.app.role[ctx.org.role] : '—'}</dd>
                </div>
                <div>
                  <dt>{t.settings.members}</dt>
                  <dd>{plural(memberCount, t.dashboard.member, t.dashboard.members)}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
