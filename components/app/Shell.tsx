'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useI18n } from '@/lib/i18n/client';
import { setActiveOrgAction } from '@/lib/data/actions';

export interface ShellProps {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  memberships: Array<{ organization_id: string; name: string }>;
  isPlatformAdmin: boolean;
  children: React.ReactNode;
}

function useNav(isPlatformAdmin: boolean) {
  const { t } = useI18n();
  const items: Array<{ href: string; label: string; icon: IconName; mobile?: boolean }> = [
    { href: '/app', label: t.nav.dashboard, icon: 'home', mobile: true },
    { href: '/app/projects', label: t.nav.projects, icon: 'film', mobile: true },
    { href: '/app/characters', label: t.nav.characterLibrary, icon: 'users', mobile: true },
    { href: '/app/billing', label: t.nav.billing, icon: 'card' },
    { href: '/app/settings', label: t.nav.settings, icon: 'settings', mobile: true },
  ];
  if (isPlatformAdmin) items.push({ href: '/admin', label: t.nav.admin, icon: 'shield' });
  return items;
}

function isActive(pathname: string, href: string) {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function WorkspaceSwitcher({ orgId, memberships }: { orgId: string | null; memberships: ShellProps['memberships'] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (memberships.length < 2) return null;
  return (
    <label>
      <span className="sr-only">{t.app.switchWorkspace}</span>
      <select
        className="select"
        value={orgId ?? ''}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            await setActiveOrgAction(id);
            router.push('/app');
            router.refresh();
          });
        }}
      >
        {memberships.map((m) => (
          <option key={m.organization_id} value={m.organization_id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={`btn btn-ghost ${compact ? 'btn-icon' : 'btn-sm'}`} aria-label={t.common.signOut} title={t.common.signOut}>
        <Icon name="logout" className="flip-rtl" />
        {!compact && <span>{t.common.signOut}</span>}
      </button>
    </form>
  );
}

export function AppShell({ email, orgId, orgName, role, memberships, isPlatformAdmin, children }: ShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const nav = useNav(isPlatformAdmin);
  const roleLabel = role && role in t.app.role ? t.app.role[role as keyof typeof t.app.role] : null;
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t.nav.mainNavigation}>
        <Link href="/app" className="sidebar-brand" aria-label={t.common.brand}>
          <Logo />
        </Link>
        <Link href="/app/projects/new" className="btn btn-primary btn-block">
          <Icon name="plus" />
          {t.nav.newProject}
        </Link>
        <nav className="side-nav">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="side-link" aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="workspace-card">
            <span>{t.app.workspace}</span>
            <b title={orgName ?? undefined}>{orgName ?? '—'}</b>
            {roleLabel && <span>{roleLabel}</span>}
            <WorkspaceSwitcher orgId={orgId} memberships={memberships} />
          </div>
          <LocaleSwitcher />
          <div className="user-row">
            <span title={email}>{email}</span>
            <SignOutButton compact />
          </div>
        </div>
      </aside>

      <div className="content has-mobile-nav">
        <header className="topbar mobile-only">
          <Link href="/app" aria-label={t.common.brand}>
            <Logo compact />
          </Link>
          <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {orgName}
          </span>
          <span className="spacer" />
          <LocaleSwitcher compact />
          <Link href="/app/projects/new" className="btn btn-primary btn-icon btn-sm" aria-label={t.nav.newProject}>
            <Icon name="plus" />
          </Link>
          <SignOutButton compact />
        </header>
        <main id="main">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label={t.nav.mainNavigation}>
        {nav
          .filter((n) => n.mobile)
          .map((item) => (
            <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
              <Icon name={item.icon} size={20} />
              {item.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}
