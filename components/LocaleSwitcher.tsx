'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALES, LOCALE_META } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { setLocaleAction } from '@/lib/i18n/actions';
import { Icon } from './ui/Icon';

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={`locale-switch${compact ? ' compact' : ''}`}>
      <Icon name="globe" size={15} />
      <span className="sr-only">{t.common.language}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            await setLocaleAction(next);
            router.refresh();
          });
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {compact ? l.toUpperCase() : LOCALE_META[l].native}
          </option>
        ))}
      </select>
    </label>
  );
}
