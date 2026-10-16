import type { Metadata } from 'next';
import { requireAppContext } from '@/lib/data/context';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { RenameWorkspace } from '@/components/app/RenameWorkspace';
import { SecurityPanel } from '@/components/app/SecurityPanel';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

export default async function SettingsPage() {
  const ctx = await requireAppContext();
  const { t, intl } = await getI18n();
  const supabase = await getSupabaseServer();
  const org = ctx.org;
  const [members, retention] = org
    ? await Promise.all([
        supabase.from('organization_members').select('user_id, role, created_at').eq('organization_id', org.organization_id).order('created_at'),
        supabase.from('workspace_retention').select('*').eq('organization_id', org.organization_id).maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];
  const profile = ctx.profile;

  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.settings.title}</h1>
          <p>{t.settings.lead}</p>
        </div>
      </div>

      {org && (
        <section className="panel panel-pad stack-lg" aria-label={t.settings.title}>
          <RenameWorkspace organizationId={org.organization_id} name={org.name} canRename={org.role === 'owner' || org.role === 'admin'} />
          <dl className="dl">
            <div>
              <dt>{t.settings.id}</dt>
              <dd className="mono xsmall ltr">{org.organization_id}</dd>
            </div>
            <div>
              <dt>{t.settings.yourRole}</dt>
              <dd>{t.app.role[org.role]}</dd>
            </div>
            <div>
              <dt>{t.settings.created}</dt>
              <dd>{formatDate(intl, org.created_at)}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="panel" aria-labelledby="members-h">
        <div className="panel-head">
          <h2 id="members-h">{t.settings.members}</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {(members.data ?? []).map((m) => (
                <tr key={m.user_id}>
                  <td className="mono xsmall ltr">
                    {m.user_id === ctx.user.id ? ctx.user.email : `${m.user_id.slice(0, 8)}…`}
                    {m.user_id === ctx.user.id && <span className="muted"> ({t.settings.you})</span>}
                  </td>
                  <td>{t.app.role[m.role as keyof typeof t.app.role] ?? m.role}</td>
                  <td className="small muted">{formatDate(intl, m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dash-grid" style={{ marginTop: 0 }}>
        <section className="panel" aria-labelledby="profile-h">
          <div className="panel-head">
            <h2 id="profile-h">{t.settings.profile}</h2>
          </div>
          <div className="panel-body">
            <dl className="dl">
              <div>
                <dt>{t.common.email}</dt>
                <dd className="ltr">{ctx.user.email}</dd>
              </div>
              {profile && (
                <>
                  <div>
                    <dt>{t.onboarding.firstName}</dt>
                    <dd>
                      {profile.first_name} {profile.last_name}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.onboarding.country}</dt>
                    <dd>{new Intl.DisplayNames([intl], { type: 'region' }).of(profile.country_code) ?? profile.country_name}</dd>
                  </div>
                  <div>
                    <dt>{t.onboarding.accountType}</dt>
                    <dd>{t.onboarding.accountTypes[profile.account_type as keyof typeof t.onboarding.accountTypes] ?? profile.account_type}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        </section>
        <section className="panel" aria-labelledby="security-h" id="security">
          <div className="panel-head">
            <h2 id="security-h">{t.security.title}</h2>
          </div>
          <div className="panel-body">
            <SecurityPanel />
          </div>
        </section>
        <section className="panel" aria-labelledby="pref-h">
          <div className="panel-head">
            <h2 id="pref-h">{t.settings.interfaceLanguage}</h2>
          </div>
          <div className="panel-body stack">
            <LocaleSwitcher />
            <hr className="divider" />
            <p className="small" style={{ fontWeight: 600 }}>
              {t.settings.retention}
            </p>
            <p className="small muted">{t.settings.retentionBody}</p>
            {retention.data && (
              <dl className="dl">
                <div>
                  <dt>{t.projects.filterStatus}</dt>
                  <dd className="mono">{retention.data.status}</dd>
                </div>
                {retention.data.purge_after && (
                  <div>
                    <dt>{t.settings.purgeAfter}</dt>
                    <dd>{formatDate(intl, retention.data.purge_after)}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
