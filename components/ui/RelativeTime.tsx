'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { formatDate, formatRelative } from '@/lib/i18n/format';

/**
 * Relative timestamps depend on "now", which differs between server render and hydration.
 * Render the absolute date first, then switch to relative time on the client.
 */
export function RelativeTime({ iso, template }: { iso: string; template?: string }) {
  const { intl } = useI18n();
  const [text, setText] = useState(() => formatDate(intl, iso));
  useEffect(() => {
    const update = () => setText(formatRelative(intl, iso));
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, [intl, iso]);
  return (
    <time dateTime={iso} title={formatDate(intl, iso, { dateStyle: 'medium', timeStyle: 'short' })}>
      {template ? template.replace('{when}', text) : text}
    </time>
  );
}
