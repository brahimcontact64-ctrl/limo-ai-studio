'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useToast } from '@/components/ui/Toast';
import { AssetPicker } from './AssetPicker';
import { AssetThumb, type ClientAsset } from './AssetThumb';

export interface BrandKitValue {
  brand_name: string;
  tagline: string;
  website: string;
  primary_color: string;
  secondary_color: string;
  logo_asset_id: string | null;
  default_cta: string;
  tone: string;
}

export function BrandKitForm({ initial, logo, canEdit }: { initial: BrandKitValue; logo: ClientAsset | null; canEdit: boolean }) {
  const { t } = useI18n();
  const b = t.brandKit;
  const toast = useToast();
  const router = useRouter();
  const [kit, setKit] = useState(initial);
  const [logoAsset, setLogoAsset] = useState<ClientAsset | null>(logo);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof BrandKitValue) => (v: string) => setKit((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/brand-kit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kit) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return toast(body?.error === 'unavailable' ? t.assets.unavailable : t.common.errorGeneric, 'error');
    toast(b.saved);
    router.refresh();
  }

  const text = (k: keyof BrandKitValue, label: string, max: number) => (
    <div className="field">
      <label className="field-label" htmlFor={`bk-${k}`}>
        {label}
      </label>
      <input id={`bk-${k}`} className="input" maxLength={max} value={(kit[k] as string) ?? ''} onChange={(e) => set(k)(e.target.value)} disabled={!canEdit} dir="auto" />
    </div>
  );
  const color = (k: 'primary_color' | 'secondary_color', label: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`bk-${k}`}>
        {label}
      </label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id={`bk-${k}`} type="color" className="color-input" value={kit[k]} onChange={(e) => set(k)(e.target.value)} disabled={!canEdit} />
        <input className="input ltr" value={kit[k]} maxLength={7} onChange={(e) => set(k)(e.target.value)} aria-label={label} disabled={!canEdit} />
      </div>
    </div>
  );

  return (
    <form className="panel panel-pad stack-lg" onSubmit={save}>
      <p className="small muted">{b.lead}</p>
      <div className="form-grid cols-2">
        {text('brand_name', b.brandName, 120)}
        {text('tagline', b.tagline, 200)}
        {text('website', b.website, 200)}
        {text('default_cta', b.defaultCta, 120)}
        {color('primary_color', b.primaryColor)}
        {color('secondary_color', b.secondaryColor)}
      </div>
      {text('tone', b.tone, 200)}
      <div className="field">
        <span className="field-label">{b.logo}</span>
        <div className="row">
          {logoAsset ? <AssetThumb asset={logoAsset} size="sm" /> : <span className="small muted">{b.noLogo}</span>}
          {canEdit && (
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
              {b.chooseLogo}
            </button>
          )}
        </div>
      </div>
      <div className="brand-preview" style={{ background: kit.primary_color, color: '#fff' }} aria-hidden="true">
        <b>{kit.brand_name || b.brandName}</b>
        <span>{kit.tagline}</span>
        {kit.default_cta && <span className="brand-preview-cta" style={{ background: kit.secondary_color }}>{kit.default_cta}</span>}
      </div>
      {canEdit && (
        <div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t.common.saving : b.save}
          </button>
        </div>
      )}
      <AssetPicker
        open={picking}
        selected={kit.logo_asset_id ? [kit.logo_asset_id] : []}
        max={1}
        filter={(a) => a.media_type === 'image'}
        onClose={(ids, assets) => {
          setPicking(false);
          if (!ids) return;
          const id = ids[0] ?? null;
          setKit((x) => ({ ...x, logo_asset_id: id }));
          setLogoAsset(assets.find((a) => a.id === id) ?? null);
        }}
      />
    </form>
  );
}
