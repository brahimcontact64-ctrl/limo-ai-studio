'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { setActiveOrgAction } from '@/lib/data/actions';

export interface ShellProps {
  email: string;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  memberships: Array<{ organization_id: string; name: string }>;
  isPlatformAdmin: boolean;
  plan: { name: string | null; active: boolean; slotsUsed: number | null; slotsTotal: number | null };
  children: React.ReactNode;
}

function useNav(isPlatformAdmin: boolean) {
  const { t } = useI18n();
  const items: Array<{ href: string; label: string; icon: IconName; mobile?: boolean }> = [
    { href: '/app', label: t.nav.dashboard, icon: 'home', mobile: true },
    { href: '/app/projects', label: t.nav.projects, icon: 'film', mobile: true },
    { href: '/app/create', label: t.nav.create, icon: 'sparkle' },
    { href: '/app/characters', label: t.nav.characterLibrary, icon: 'users', mobile: true },
    { href: '/app/assets', label: t.nav.assets, icon: 'image' },
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

function WorkspaceChip({ orgId, orgName, role, memberships }: Pick<ShellProps, 'orgId' | 'orgName' | 'role' | 'memberships'>) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const roleLabel = role && role in t.app.role ? t.app.role[role as keyof typeof t.app.role] : null;
  return (
    <div className="workspace-chip">
      <span className="avatar" aria-hidden="true">
        {(orgName ?? 'W').trim().charAt(0)}
      </span>
      <span style={{ minWidth: 0 }}>
        {memberships.length > 1 ? (
          <label>
            <span className="sr-only">{t.app.switchWorkspace}</span>
            <select
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
        ) : (
          <b title={orgName ?? undefined}>{orgName ?? '—'}</b>
        )}
        {roleLabel && <small>{roleLabel}</small>}
      </span>
    </div>
  );
}

function UserMenu({ email }: { email: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <details className="menu user-menu" ref={ref}>
      <summary className="avatar" aria-label={t.app.account} title={email}>
        {email.charAt(0)}
      </summary>
      <div className="menu-list" role="menu">
        <div className="user-menu-head">
          <b>{t.app.account}</b>
          <span className="ltr">{email}</span>
        </div>
        <Link className="menu-item" href="/app/settings" role="menuitem">
          <Icon name="settings" />
          {t.nav.settings}
        </Link>
        <Link className="menu-item" href="/app/billing" role="menuitem">
          <Icon name="card" />
          {t.nav.billing}
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className="menu-item danger" role="menuitem">
            <Icon name="logout" className="flip-rtl" />
            {t.common.signOut}
          </button>
        </form>
      </div>
    </details>
  );
}

export function AppShell({ email, orgId, orgName, role, memberships, isPlatformAdmin, plan, children }: ShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const nav = useNav(isPlatformAdmin);
  const slotsLeft = plan.slotsTotal !== null && plan.slotsUsed !== null ? Math.max(0, plan.slotsTotal - plan.slotsUsed) : null;
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t.nav.mainNavigation}>
        <Link href="/app" className="sidebar-brand" aria-label={t.common.brand}>
          <Logo />
        </Link>
        <Link href="/app/create" className="btn btn-primary btn-block">
          <Icon name="plus" />
          {t.nav.create}
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
          <Link href="/app/billing" className="side-card">
            <span>{plan.name ?? t.dashboard.noPlan}</span>
            <b>{slotsLeft !== null ? fmt(t.app.slotsLeft, { n: slotsLeft }) : plan.active ? t.billing.status.active : t.app.viewPlans}</b>
            {slotsLeft !== null && plan.slotsTotal ? (
              <div className="meter-track" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${Math.min(100, Math.round(((plan.slotsUsed ?? 0) / plan.slotsTotal) * 100))}%` }} />
              </div>
            ) : null}
          </Link>
        </div>
      </aside>

      <div className="content has-mobile-nav">
        <header className="topbar">
          <Link href="/app" className="only-mobile" aria-label={t.common.brand}>
            <Logo compact />
          </Link>
          <WorkspaceChip orgId={orgId} orgName={orgName} role={role} memberships={memberships} />
          <span className="spacer" />
          <span className="secure-pill">
            <Icon name="lock" size={13} />
            {t.app.protectedWorkspace}
          </span>
          <LocaleSwitcher compact />
          <Link href="/app/create" className="btn btn-primary btn-icon only-mobile" aria-label={t.nav.create}>
            <Icon name="plus" />
          </Link>
          <UserMenu email={email} />
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
