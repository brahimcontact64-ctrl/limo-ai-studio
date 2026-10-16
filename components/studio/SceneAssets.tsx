'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { Icon } from '@/components/ui/Icon';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { AssetThumb, type ClientAsset } from '@/components/assets/AssetThumb';

const MAX = 10;

/** Workspace library, fetched once when the editor first needs thumbnails. */
export function useWorkspaceAssets(enabled: boolean) {
  const [assets, setAssets] = useState<ClientAsset[] | null>(null);
  useEffect(() => {
    if (!enabled || assets) return;
    let alive = true;
    fetch('/api/assets')
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((b: { assets?: ClientAsset[] }) => alive && setAssets(b.assets ?? []))
      .catch(() => alive && setAssets([]));
    return () => {
      alive = false;
    };
  }, [enabled, assets]);
  return [assets, setAssets] as const;
}

export function SceneAssets({ ids, library, onLibrary, onChange }: { ids: string[]; library: ClientAsset[] | null; onLibrary: (a: ClientAsset[]) => void; onChange: (ids: string[]) => void }) {
  const { t } = useI18n();
  const f = t.studio.scenes.fields;
  const [picking, setPicking] = useState(false);
  return (
    <fieldset className="field plain-fieldset">
      <legend className="field-label">
        {f.assets} <small>({t.common.optional})</small>
      </legend>
      <div className="scene-assets">
        {ids.map((id) => {
          const a = library?.find((x) => x.id === id);
          return (
            <div key={id} className="scene-asset">
              {a ? <AssetThumb asset={a} size="sm" /> : <span className="asset-thumb sm skeleton" aria-hidden="true" />}
              <button
                type="button"
                className="btn btn-sm btn-icon"
                aria-label={fmt(t.create.remove, {
                  item: a?.label ?? a?.file_name ?? '',
                })}
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          );
        })}
        {ids.length < MAX && (
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
            <Icon name="plus" />
            {f.addAssets}
          </button>
        )}
      </div>
      <span className="field-hint">{f.assetsHint}</span>
      <AssetPicker
        open={picking}
        selected={ids}
        max={MAX}
        filter={(a) => a.media_type === 'image' || a.media_type === 'video'}
        onClose={(next, assets) => {
          setPicking(false);
          if (assets.length) onLibrary(assets);
          if (next) onChange(next);
        }}
      />
    </fieldset>
  );
}
