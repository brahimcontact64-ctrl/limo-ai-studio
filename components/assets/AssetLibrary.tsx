'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatBytes } from '@/lib/assets/files';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AssetThumb, type ClientAsset } from './AssetThumb';
import { uploadAsset } from './upload';

const UPLOAD_KINDS = ['product', 'photo', 'logo', 'background', 'video', 'audio', 'reference', 'other'] as const;

export function AssetLibrary({ organizationId, assets, canEdit }: { organizationId: string; assets: ClientAsset[]; canEdit: boolean }) {
  const { t } = useI18n();
  const a = t.assets;
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<string>('product');
  const [filter, setFilter] = useState<string>('all');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<ClientAsset | null>(null);
  const [busy, setBusy] = useState(false);
  // The file input stays disabled until the page is interactive: a file chosen before hydration would be lost silently.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);

  const kinds = useMemo(() => ['all', ...new Set(assets.map((x) => x.kind))], [assets]);
  const visible = filter === 'all' ? assets : assets.filter((x) => x.kind === filter);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files];
    let ok = 0;
    setProgress({ done: 0, total: list.length });
    for (const [i, file] of list.entries()) {
      const r = await uploadAsset(organizationId, file, kind);
      if ('id' in r) ok++;
      else if (r.error === 'too_large') toast(fmt(a.tooLarge, { name: file.name }), 'error');
      else if (r.error === 'type_not_allowed') toast(fmt(a.typeNotAllowed, { name: file.name }), 'error');
      else if (r.error === 'unavailable') toast(a.unavailable, 'error');
      else toast(t.common.errorGeneric, 'error');
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (ok) {
      toast(fmt(a.uploaded, { n: ok }));
      router.refresh();
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const res = await fetch(`/api/assets/${removing.id}`, { method: 'DELETE' }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setRemoving(null);
    if (!res?.ok) return toast(body?.error === 'in_use' ? a.inUse : t.common.errorGeneric, 'error');
    toast(a.deleted);
    router.refresh();
  }

  return (
    <div className="stack-lg">
      {canEdit && (
        <div className="upload-bar">
          <div className="field" style={{ minWidth: 180 }}>
            <label className="field-label" htmlFor={`${id}-kind`}>
              {a.kind}
            </label>
            <select id={`${id}-kind`} className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {UPLOAD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {a.kinds[k]}
                </option>
              ))}
            </select>
          </div>
          <label className="btn btn-primary upload-btn">
            <Icon name="plus" />
            {progress ? fmt(a.uploading, { done: progress.done, total: progress.total }) : a.upload}
            <input
              type="file"
              multiple
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm"
              disabled={!interactive || Boolean(progress)}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {assets.length > 0 && (
        <div className="segmented" role="radiogroup" aria-label={a.kind} style={{ justifySelf: 'start' }}>
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
              {k === 'all' ? a.all : ((a.kinds as Record<string, string>)[k] ?? k)}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="empty">
          <p>{a.empty}</p>
        </div>
      ) : (
        <ul className="asset-grid">
          {visible.map((x) => (
            <li key={x.id} className="asset-card">
              <AssetThumb asset={x} />
              <div className="asset-meta">
                <b title={x.file_name}>{x.label ?? x.file_name}</b>
                <span className="xsmall muted">
                  {(a.kinds as Record<string, string>)[x.kind] ?? x.kind} · <span className="ltr">{formatBytes(x.size_bytes)}</span>
                  {x.width && x.height ? (
                    <>
                      {' '}
                      · <span className="ltr">{`${x.width}×${x.height}`}</span>
                    </>
                  ) : null}
                </span>
              </div>
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${a.delete}: ${x.file_name}`} onClick={() => setRemoving(x)}>
                  <Icon name="trash" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title={a.deleteTitle}
        body={fmt(a.deleteBody, { name: removing?.file_name ?? '' })}
        confirmLabel={t.common.delete}
        danger
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
