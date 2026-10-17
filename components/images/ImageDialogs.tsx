'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { LoadedImage } from '@/lib/images/render';
import type { ImageFormat } from '@/lib/images/formats';
import type { ImageDoc, TextLayer } from '@/lib/images/types';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';
import { DocPreview } from './DocPreview';

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

export interface RevisionItem {
  id: string;
  revision_number: number;
  source: string;
  label: string | null;
  updated_at: string;
  document: ImageDoc;
}

export function RevisionsDialog({
  open,
  revisions,
  images,
  canRestore,
  busy,
  onRestore,
  onClose,
}: {
  open: boolean;
  revisions: RevisionItem[];
  images: ReadonlyMap<string, LoadedImage>;
  canRestore: boolean;
  busy: boolean;
  onRestore: (r: RevisionItem) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const r = t.images.revisions;
  const id = useId();
  const ref = useModal(open);
  const [confirm, setConfirm] = useState<RevisionItem | null>(null);
  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose} aria-labelledby={`${id}-h`}>
      <div className="dialog-body stack">
        <h2 id={`${id}-h`}>{r.title}</h2>
        {revisions.length === 0 && <p className="small muted">{r.none}</p>}
        {open && (
          <ul className="revision-grid" data-testid="image-revisions">
            {revisions.map((rev, i) => (
              <li key={rev.id} className="revision-card">
                <DocPreview doc={rev.document} images={images} label={fmt(r.revision, { n: rev.revision_number })} />
                <div className="stack-xs">
                  <b className="small">
                    {fmt(r.revision, { n: rev.revision_number })}
                    {i === 0 && <span className="badge badge-accent plain"> {r.current}</span>}
                  </b>
                  <span className="xsmall muted">
                    {(r.sources as Record<string, string>)[rev.source] ?? rev.source} · <RelativeTime iso={rev.updated_at} />
                  </span>
                  {rev.label && (
                    <span className="xsmall muted" dir="auto">
                      {rev.label}
                    </span>
                  )}
                  {canRestore && i > 0 && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(rev)}>
                      <Icon name="restore" />
                      {r.restore}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {confirm && (
          <div className="callout callout-warning" role="alertdialog" aria-live="polite">
            <Icon name="alert" />
            <div className="stack-sm">
              <span>{fmt(r.confirmRestore, { n: confirm.revision_number })}</span>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onRestore(confirm)}>
                  {fmt(r.restoreN, { n: confirm.revision_number })}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>
                  {t.common.cancel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
      </div>
    </dialog>
  );
}

export function PreviewDialog({
  open,
  doc,
  images,
  title,
  placeholders,
  approved,
  canApprove,
  busy,
  onApprove,
  onClose,
}: {
  open: boolean;
  doc: ImageDoc;
  images: ReadonlyMap<string, LoadedImage>;
  title: string;
  placeholders: TextLayer[];
  approved: boolean;
  canApprove: boolean;
  busy: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const p = t.images.preview;
  const id = useId();
  const ref = useModal(open);
  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose} aria-labelledby={`${id}-h`}>
      <div className="dialog-body stack">
        <h2 id={`${id}-h`}>{p.title}</h2>
        <p className="small muted">{p.note}</p>
        {open && (
          <div className="preview-frame">
            <DocPreview doc={doc} images={images} label={title} />
          </div>
        )}
        {placeholders.length > 0 ? (
          <div className="callout callout-warning" data-testid="preview-placeholders">
            <Icon name="alert" />
            <div>
              <b>{fmt(t.images.editor.placeholders, { n: placeholders.length })}</b>
              <ul className="plain-list xsmall">
                {placeholders.map((l) => (
                  <li key={l.id} dir="auto">
                    {l.content}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          !approved && <p className="small">{p.approveHint}</p>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
        {!approved && canApprove && (
          <button type="button" className="btn btn-primary" disabled={busy || placeholders.length > 0} onClick={onApprove}>
            <Icon name="check" />
            {t.images.editor.approve}
          </button>
        )}
      </div>
    </dialog>
  );
}

export interface ExportItem {
  id: string;
  format: string;
  width: number;
  height: number;
  size_bytes: number;
  from_approved: boolean;
  created_at: string;
}

const FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp'];

export function ExportDialog({
  open,
  doc,
  exports,
  busy,
  error,
  onExport,
  onClose,
}: {
  open: boolean;
  doc: ImageDoc;
  exports: ExportItem[];
  busy: boolean;
  error: string | null;
  onExport: (format: ImageFormat, scale: 1 | 2, quality: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const x = t.images.export;
  const id = useId();
  const ref = useModal(open);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState<1 | 2>(1);
  const [quality, setQuality] = useState(0.92);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby={`${id}-h`}>
      <div className="dialog-body stack">
        <h2 id={`${id}-h`}>{x.title}</h2>
        <div className="field">
          <span className="field-label" id={`${id}-f`}>
            {x.format}
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-f`}>
            {FORMATS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)}>
                {x.formats[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label" id={`${id}-s`}>
            {x.size}
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-s`}>
            {([1, 2] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} onClick={() => setScale(s)}>
                <span className="ltr">
                  {doc.width * s} × {doc.height * s}
                </span>
              </button>
            ))}
          </div>
        </div>
        {format !== 'png' && (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-q`}>
              {x.quality} <small className="ltr">{Math.round(quality * 100)}%</small>
            </label>
            <input id={`${id}-q`} className="range" type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </div>
        )}
        <p className="xsmall muted">{x.libraryNote}</p>
        {error && (
          <p className="callout callout-danger small" role="alert">
            {error}
          </p>
        )}
        <section className="stack-sm">
          <h3 className="section-title">{x.history}</h3>
          {exports.length === 0 ? (
            <p className="xsmall muted">{x.none}</p>
          ) : (
            <ul className="plain-list xsmall" data-testid="export-history">
              {exports.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <span className="mono">{e.format.toUpperCase()}</span> · <span className="ltr">{e.width}×{e.height}</span> · {Math.max(1, Math.round(e.size_bytes / 1024))} KB · {e.from_approved ? x.fromApproved : x.fromDraft} ·{' '}
                  <RelativeTime iso={e.created_at} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onExport(format, scale, quality)} data-testid="export-download">
          <Icon name="download" />
          {busy ? x.downloading : x.download}
        </button>
      </div>
    </dialog>
  );
}
