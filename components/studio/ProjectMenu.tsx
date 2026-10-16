'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { downloadProjectJson } from '@/lib/studio/export';
import type { ProjectDraft, ProjectStatus } from '@/lib/studio/types';

export function useProjectActions() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  async function call(url: string, init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (body.error === 'lifecycle_unavailable') toast(t.projects.lifecycleUnavailable, 'info');
        else {
          const key = String(body.error ?? 'unknown') as keyof typeof t.studio.saveErrors;
          toast(t.studio.saveErrors[key] ?? t.common.errorGeneric, 'error');
        }
      }
      return { ok: res.ok, body };
    } catch {
      toast(t.studio.saveErrors.network, 'error');
      return { ok: false, body: {} };
    }
  }

  return {
    async duplicate(id: string) {
      const r = await call(`/api/projects/${id}/duplicate`, { method: 'POST' });
      if (r.ok && typeof r.body.project_id === 'string') {
        toast(t.projects.duplicateDone);
        router.push(`/app/projects/${r.body.project_id}`);
      }
      return r.ok;
    },
    async archive(id: string) {
      const r = await call(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'archive' }) });
      if (r.ok) {
        toast(t.projects.archiveDone);
        router.refresh();
      }
      return r.ok;
    },
    async restore(id: string) {
      const r = await call(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }) });
      if (r.ok) {
        toast(t.projects.restoreDone);
        router.refresh();
      }
      return r.ok;
    },
    async remove(id: string) {
      const r = await call(`/api/projects/${id}`, { method: 'DELETE' });
      if (r.ok) toast(t.projects.deleteDone);
      return r.ok;
    },
  };
}

export function ProjectMenu({
  projectId,
  title,
  status,
  canEdit,
  draft,
  dirty,
  onDeleted,
}: {
  projectId: string;
  title: string;
  status: ProjectStatus;
  canEdit: boolean;
  draft?: ProjectDraft;
  dirty?: boolean;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const actions = useProjectActions();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    setBusy(true);
    await fn();
    setBusy(false);
  };

  const archived = status === 'archived';
  const deletable = ['draft', 'ready', 'archived'].includes(status);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.projects.actions}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {canEdit && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                disabled={dirty}
                onClick={() => run(() => actions.duplicate(projectId))}
              >
                <Icon name="copy" />
                {t.common.duplicate}
              </button>
            </li>
          )}
          {draft && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  downloadProjectJson(draft);
                }}
              >
                <Icon name="download" />
                {t.studio.review.exportJson}
              </button>
            </li>
          )}
          {canEdit && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                disabled={dirty || status === 'queued' || status === 'generating'}
                onClick={() => run(() => (archived ? actions.restore(projectId) : actions.archive(projectId)))}
              >
                <Icon name={archived ? 'restore' : 'archive'} />
                {archived ? t.common.restore : t.common.archive}
              </button>
            </li>
          )}
          {canEdit && deletable && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                className="menu-item danger"
                onClick={() => {
                  setOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Icon name="trash" />
                {t.common.delete}
              </button>
            </li>
          )}
        </ul>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t.projects.deleteTitle}
        body={fmt(t.projects.deleteBody, { title: title || t.studio.untitled })}
        confirmLabel={t.common.delete}
        danger
        busy={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          const ok = await actions.remove(projectId);
          setBusy(false);
          setConfirmDelete(false);
          if (ok) {
            if (onDeleted) onDeleted();
            else {
              router.push('/app/projects');
              router.refresh();
            }
          }
        }}
      />
    </div>
  );
}
