'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Icon } from '@/components/ui/Icon';
import { AssetThumb, type ClientAsset } from './AssetThumb';

/** Dialog listing the workspace library (GET /api/assets); returns the selected ids. */
export function AssetPicker({
  open,
  selected,
  max = 10,
  filter,
  onClose,
}: {
  open: boolean;
  selected: string[];
  max?: number;
  filter?: (a: ClientAsset) => boolean;
  onClose: (ids: string[] | null, assets: ClientAsset[]) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<ClientAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>(selected);
  const done = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPicked(selected);
    done.current = false;
    ref.current?.showModal();
    let alive = true;
    fetch('/api/assets')
      .then(async (r) => {
        const body = (await r.json()) as { assets?: ClientAsset[]; error?: string };
        if (!alive) return;
        if (!r.ok) setError(body.error === 'unavailable' ? t.assets.unavailable : t.common.errorGeneric);
        else setAssets((body.assets ?? []).filter((a) => (filter ? filter(a) : true)));
      })
      .catch(() => alive && setError(t.common.errorGeneric));
    return () => {
      alive = false;
    };
    // Runs once per opening; the selection and filter are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : max === 1 ? [id] : p.length < max ? [...p, id] : p));

  return (
    <dialog
      ref={ref}
      className="dialog wide"
      onClose={() => {
        if (!done.current) onClose(null, assets ?? []);
      }}
      aria-labelledby="asset-picker-h"
    >
      <div className="dialog-body">
        <h2 id="asset-picker-h">{t.studio.scenes.fields.addAssets}</h2>
        {error && <p className="callout callout-warning">{error}</p>}
        {!assets && !error && <div className="skeleton" style={{ height: 160 }} />}
        {assets && assets.length === 0 && <p className="small muted">{t.studio.scenes.fields.noAssets}</p>}
        {assets && assets.length > 0 && (
          <ul className="asset-grid picker">
            {assets.map((a) => {
              const on = picked.includes(a.id);
              return (
                <li key={a.id}>
                  <button type="button" className="asset-card pick" aria-pressed={on} onClick={() => toggle(a.id)}>
                    <AssetThumb asset={a} size="sm" />
                    <span className="asset-meta">
                      <b title={a.file_name}>{a.label ?? a.file_name}</b>
                    </span>
                    <span className="char-check" aria-hidden="true">
                      <Icon name="check" size={13} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            done.current = true;
            ref.current?.close();
            onClose(picked, assets ?? []);
          }}
        >
          {t.assets.done}
        </button>
      </div>
    </dialog>
  );
}
