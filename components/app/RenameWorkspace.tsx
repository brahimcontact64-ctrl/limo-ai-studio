'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useToast } from '@/components/ui/Toast';
import { renameWorkspaceAction } from '@/lib/data/actions';

export function RenameWorkspace({ organizationId, name, canRename }: { organizationId: string; name: string; canRename: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await renameWorkspaceAction(organizationId, value);
    setBusy(false);
    if (r.ok) {
      toast(t.settings.renamed);
      router.refresh();
    } else toast(r.unavailable ? t.settings.renameUnavailable : t.common.errorGeneric, r.unavailable ? 'info' : 'error');
  }

  return (
    <form className="field" onSubmit={submit}>
      <label className="field-label" htmlFor="ws-name">
        {t.settings.name}
      </label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id="ws-name" className="input" value={value} maxLength={120} disabled={!canRename} onChange={(e) => setValue(e.target.value)} />
        {canRename && (
          <button className="btn" type="submit" disabled={busy || !value.trim() || value.trim() === name}>
            {t.settings.rename}
          </button>
        )}
      </div>
    </form>
  );
}
