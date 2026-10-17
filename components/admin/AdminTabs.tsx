'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n/client';

export function AdminTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const tabs = [
    { href: '/admin', label: t.admin.tabs.overview },
    { href: '/admin/workspaces', label: t.adminWs.tab },
    { href: '/admin/payments', label: t.admin.tabs.payments },
    { href: '/admin/payment-methods', label: t.admin.tabs.methods },
    { href: '/admin/characters', label: t.adminChars.tab },
  ];
  return (
    <nav className="tabs admin-tabs" aria-label={t.nav.admin}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-selected={pathname === tab.href} aria-current={pathname === tab.href ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
