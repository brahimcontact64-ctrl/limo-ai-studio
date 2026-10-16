'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useToast } from '@/components/ui/Toast';
import { LOCKED_FLAGS } from '@/lib/admin/flags';

export interface FlagRow {
  key: string;
  enabled: boolean;
  description: string;
}

export function FlagsPanel({ flags }: { flags: FlagRow[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(f: FlagRow) {
    setBusy(f.key);
    const res = await fetch('/api/admin/flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key, enabled: !f.enabled }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return toast(t.common.errorGeneric, 'error');
    toast(t.flags.saved);
    router.refresh();
  }

  return (
    <ul className="flag-list">
      {flags.map((f) => {
        const locked = LOCKED_FLAGS.has(f.key);
        return (
          <li key={f.key}>
            <div>
              <b className="ltr">{f.key}</b>
              <p className="xsmall muted" lang="en">
                {f.description}
              </p>
              {locked && <span className="xsmall" style={{ color: 'var(--warning)', fontWeight: 700 }}>{t.flags.locked}</span>}
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={f.enabled} disabled={locked || busy === f.key} onChange={() => void toggle(f)} />
              <span className="sr-only">{f.key}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
