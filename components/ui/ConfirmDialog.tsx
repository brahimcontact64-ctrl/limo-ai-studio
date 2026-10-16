'use client';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n/client';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="confirm-title">
      <div className="dialog-body">
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy} autoFocus>
          {t.common.cancel}
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? t.common.loading : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
