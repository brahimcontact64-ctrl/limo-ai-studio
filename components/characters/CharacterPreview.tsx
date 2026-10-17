'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { EXPRESSION_KEYS, REFERENCE_VIEWS, type CharacterSpec } from '@/lib/characters/canon';
import { REVIEW_CHECKLIST, referenceReadiness, viewSlots, type AssetKind, type ReferenceAsset } from '@/lib/characters/references';
import { parseCharacterId } from '@/lib/studio/limits';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { FamilyGlyph } from './FamilyGlyph';
import { uploadReference } from './referenceUpload';

interface Payload {
  kind: 'canonical' | 'custom';
  spec: { version: number; status: string; spec: Record<string, unknown>; note: string | null } | null;
  custom: { name: string; description: string; reference_status: string } | null;
  assets: ReferenceAsset[];
  can_upload: boolean;
  can_review: boolean;
  upload_prefix: string | null;
}

type T = ReturnType<typeof useI18n>['t'];

/**
 * Character details: written design spec, reference views (approved images, pending reviews or an explicit
 * "artwork pending" placeholder), 3D model files, and, for reviewers, the upload and approval workflow.
 * Nothing is shown as a reference unless a real file exists.
 */
export function CharacterPreview({ open, characterId, label, onClose, onChanged }: { open: boolean; characterId: string; label: string; onClose: () => void; onChanged?: () => void }) {
  const { t } = useI18n();
  const p = t.characters.preview;
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rendered in <body> so a disabled studio <fieldset> around the caller cannot disable the dialog.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/references`).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as Payload & { error?: string };
    if (!res?.ok) setError(body?.error === 'unavailable' ? p.unavailable : t.common.errorGeneric);
    else setData(body);
  }, [characterId, p.unavailable, t.common.errorGeneric]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setData(null);
      setError(null);
      d.showModal();
      void load();
    }
    if (!open && d.open) d.close();
  }, [open, load, mounted]);

  const changed = () => {
    void load();
    onChanged?.();
  };

  if (!mounted) return null;
  return createPortal(
    <dialog ref={ref} className="dialog wide char-preview" onClose={onClose} aria-labelledby="char-preview-h">
      <div className="dialog-body stack">
        <Header characterId={characterId} label={label} data={data} />
        {error && <p className="callout callout-warning">{error}</p>}
        {!data && !error && <p className="small muted">{p.loading}</p>}
        {data && <Body data={data} characterId={characterId} onChanged={changed} />}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

function readinessOf(data: Payload) {
  if (data.kind === 'custom') return (data.custom?.reference_status ?? 'pending') as 'approved' | 'in_review' | 'pending';
  return referenceReadiness(viewSlots(data.assets, data.spec?.version ?? null), data.spec?.status === 'approved');
}

function Header({ characterId, label, data }: { characterId: string; label: string; data: Payload | null }) {
  const { t } = useI18n();
  const p = t.characters.preview;
  const parsed = parseCharacterId(characterId);
  const readiness = data ? readinessOf(data) : null;
  return (
    <div className="char-preview-head">
      {parsed ? (
        <figure className="char-marker">
          <FamilyGlyph family={parsed.family} variant={parsed.variant} size={64} />
          <figcaption className="xsmall muted">{p.identityMarker}</figcaption>
        </figure>
      ) : (
        <span className="char-initials" aria-hidden="true">
          {label.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="stack-sm">
        <h2 id="char-preview-h">{label}</h2>
        <div className="row" style={{ gap: 6 }}>
          {data?.spec && data.kind === 'canonical' && (
            <span className={`badge ${data.spec.status === 'approved' ? 'badge-success' : 'badge-warning'}`}>
              {fmt(p.specVersion, { n: data.spec.version })} · {(p.specStatus as Record<string, string>)[data.spec.status] ?? data.spec.status}
            </span>
          )}
          {readiness && (
            <span className={`badge ${readiness === 'approved' ? 'badge-success' : 'badge-warning'}`} data-testid="char-readiness">
              {p.readiness[readiness]}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Body({ data, characterId, onChanged }: { data: Payload; characterId: string; onChanged: () => void }) {
  const { t } = useI18n();
  const p = t.characters.preview;
  const toast = useToast();
  const slots = useMemo(() => viewSlots(data.assets, data.spec?.version ?? null), [data]);
  const extras = data.assets.filter((a) => a.asset_kind === 'rendered_reference' && (a.expression_key || a.outfit_key || !a.view) && a.status !== 'rejected');
  const models = data.assets.filter((a) => a.asset_kind !== 'rendered_reference' && a.status !== 'rejected');
  const pending = data.assets.filter((a) => a.status === 'pending_review');
  const rejected = data.assets.filter((a) => a.status === 'rejected');
  const [busy, setBusy] = useState(false);

  async function approveSpec() {
    if (!data.spec) return;
    setBusy(true);
    const res = await fetch(`/api/admin/characters/${encodeURIComponent(characterId)}/spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', version: data.spec.version }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast(t.common.errorGeneric, 'error');
    toast(p.specApproved);
    onChanged();
  }

  return (
    <>
      <section className="stack-sm" aria-labelledby="spec-h">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 id="spec-h" className="section-title">
            {p.spec}
          </h3>
          {data.kind === 'canonical' && data.can_review && data.spec?.status === 'proposed' && (
            <button type="button" className="btn btn-sm" onClick={() => void approveSpec()} disabled={busy}>
              {fmt(p.approveSpec, { n: data.spec.version })}
            </button>
          )}
        </div>
        {data.kind === 'canonical' && data.can_review && data.spec?.status === 'proposed' && <p className="xsmall muted">{p.specHint}</p>}
        {data.spec && (data.kind === 'canonical' ? <CanonSpec spec={data.spec.spec as unknown as CharacterSpec} /> : <CustomSpec spec={data.spec.spec} description={data.custom?.description ?? ''} />)}
      </section>

      <section className="stack-sm" aria-labelledby="refs-h">
        <h3 id="refs-h" className="section-title">
          {p.references}
        </h3>
        <ul className="ref-slots">
          {slots.map((s) => (
            <li key={s.view} className={`ref-slot ${s.state}`} data-testid={`slot-${s.view}`}>
              {s.state === 'approved' && s.asset?.url ? (
                <img src={s.asset.url} alt={`${p.views[s.view]} · ${p.kinds.rendered_reference}`} />
              ) : (
                <div className="ref-placeholder" aria-hidden="true">
                  <Icon name="image" size={22} />
                </div>
              )}
              <div className="ref-slot-meta">
                <b>{p.views[s.view]}</b>
                <span className="xsmall muted">{s.required ? p.required : p.optional}</span>
                <span className={`badge plain ${s.state === 'approved' ? 'badge-success' : 'badge-warning'}`}>{p.slot[s.state]}</span>
                {s.state === 'missing' && <span className="xsmall muted">{p.missingBody}</span>}
              </div>
            </li>
          ))}
        </ul>
        {extras.length > 0 && (
          <ul className="ref-extras">
            {extras.map((a) => (
              <li key={a.id}>
                {a.url && a.status === 'approved' ? <img src={a.url} alt={a.expression_key ?? a.outfit_key ?? ''} /> : <div className="ref-placeholder small" aria-hidden="true" />}
                <span className="xsmall">
                  {a.expression_key ?? a.outfit_key} · {t.characters.preview.slot[a.status === 'approved' ? 'approved' : 'pending_review']}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="xsmall muted">{p.kindNote}</p>
        <h4 className="field-label">{p.models}</h4>
        {models.length === 0 ? (
          <p className="xsmall muted">{p.noModels}</p>
        ) : (
          <ul className="plain-list">
            {models.map((m) => (
              <li key={m.id} className="small">
                {p.kinds[m.asset_kind]} · <span className="ltr">{m.mime_type}</span> · {t.characters.preview.slot[m.status === 'approved' ? 'approved' : 'pending_review']}
                {m.url && (
                  <>
                    {' · '}
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {p.openFile}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.can_review && pending.length > 0 && (
        <section className="stack-sm" aria-labelledby="review-h">
          <h3 id="review-h" className="section-title">
            {t.characters.review.title} <span className="mono ltr">({pending.length})</span>
          </h3>
          {pending.map((a) => (
            <ReviewItem key={a.id} asset={a} onDone={onChanged} />
          ))}
        </section>
      )}
      {data.can_review && slots.some((s) => s.state === 'approved') && <ApprovedList assets={data.assets.filter((a) => a.status === 'approved')} onDone={onChanged} />}
      {data.can_review && rejected.length > 0 && (
        <details>
          <summary className="small">
            {t.characters.review.rejectedList} <span className="mono ltr">({rejected.length})</span>
          </summary>
          <ul className="plain-list">
            {rejected.map((r) => (
              <li key={r.id} className="xsmall">
                {r.view ? p.views[r.view] : (r.expression_key ?? r.outfit_key ?? p.kinds[r.asset_kind])} · {r.review_note ? fmt(t.characters.review.reason, { note: r.review_note }) : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.can_upload && data.upload_prefix && <UploadForm characterId={characterId} prefix={data.upload_prefix} outfits={outfitKeys(data)} onDone={onChanged} />}
    </>
  );
}

function outfitKeys(data: Payload): string[] {
  const outfits = (data.spec?.spec as { outfits?: Array<{ key: string }> } | undefined)?.outfits;
  return Array.isArray(outfits) ? outfits.map((o) => o.key) : [];
}

function Swatches({ colors }: { colors: Array<{ key: string; hex: string }> }) {
  return (
    <ul className="swatches">
      {colors.map((c) => (
        <li key={c.key}>
          <span className="swatch" style={{ background: c.hex }} aria-hidden="true" />
          <span className="xsmall">
            {c.key} <span className="mono ltr">{c.hex}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CanonSpec({ spec }: { spec: CharacterSpec }) {
  const { t } = useI18n();
  const p = t.characters.preview;
  const row = (k: string, v: string) => (
    <div className="spec-row">
      <dt>{k}</dt>
      <dd dir="ltr">{v}</dd>
    </div>
  );
  return (
    <div className="stack-sm">
      <dl className="spec-list">
        {row(p.personality, spec.personality)}
        {row(p.head, spec.head)}
        {row(p.crown, spec.crown)}
        {row(p.surface, spec.surface)}
        {row(p.face, spec.face)}
        {row(p.body, spec.body)}
        {row(p.proportions, `${fmt(p.heightHeads, { n: spec.proportions.height_in_heads })} · ${spec.proportions.posture}`)}
      </dl>
      <h4 className="field-label">{p.palette}</h4>
      <Swatches colors={spec.palette} />
      <h4 className="field-label">{p.signature}</h4>
      <ul className="plain-list small" dir="ltr">
        {spec.signature_details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <h4 className="field-label">{p.outfits}</h4>
      <ul className="plain-list small" dir="ltr">
        {spec.outfits.map((o) => (
          <li key={o.key}>
            <b>{o.name}</b>: {o.description}
          </li>
        ))}
      </ul>
      <details>
        <summary className="field-label">
          {p.expressions} <span className="mono ltr">({spec.expressions.length})</span>
        </summary>
        <ul className="plain-list small" dir="ltr">
          {spec.expressions.map((e) => (
            <li key={e.key}>
              <b>{e.key}</b>: {e.description}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="field-label">{p.consistency}</summary>
        <p className="small" dir="ltr">
          {spec.consistency.identity_prompt}
        </p>
        <p className="xsmall muted" dir="ltr">
          {p.never}: {spec.consistency.negative_prompt.join('; ')}
        </p>
      </details>
    </div>
  );
}

function CustomSpec({ spec, description }: { spec: Record<string, unknown>; description: string }) {
  const { t } = useI18n();
  const p = t.characters.preview;
  const c = t.characters.custom;
  const palette = Array.isArray(spec.palette) ? (spec.palette as Array<{ key: string; hex: string }>) : [];
  const details = Array.isArray(spec.signature_details) ? (spec.signature_details as string[]) : [];
  return (
    <div className="stack-sm">
      <dl className="spec-list">
        {description && (
          <div className="spec-row">
            <dt>{c.description}</dt>
            <dd dir="auto">{description}</dd>
          </div>
        )}
        {typeof spec.personality === 'string' && spec.personality && (
          <div className="spec-row">
            <dt>{p.personality}</dt>
            <dd dir="auto">{spec.personality}</dd>
          </div>
        )}
        {typeof spec.outfit === 'string' && spec.outfit && (
          <div className="spec-row">
            <dt>{c.outfit}</dt>
            <dd dir="auto">{spec.outfit}</dd>
          </div>
        )}
      </dl>
      {palette.length > 0 && <Swatches colors={palette} />}
      {details.length > 0 && (
        <ul className="plain-list small" dir="auto">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {typeof spec.identity_prompt === 'string' && (
        <details>
          <summary className="field-label">{p.consistency}</summary>
          <p className="small" dir="auto">
            {spec.identity_prompt}
          </p>
        </details>
      )}
    </div>
  );
}

async function act(assetId: string, body: object) {
  const res = await fetch(`/api/characters/references/${assetId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
  return { ok: Boolean(res?.ok), error: out?.error };
}

function reviewError(t: T, code?: string) {
  return (t.characters.review.errors as Record<string, string>)[code ?? ''] ?? t.common.errorGeneric;
}

/** Pending reference: the reviewer must open it (recorded) and confirm every checklist item. */
function ReviewItem({ asset, onDone }: { asset: ReferenceAsset; onDone: () => void }) {
  const { t } = useI18n();
  const r = t.characters.review;
  const p = t.characters.preview;
  const toast = useToast();
  const [viewed, setViewed] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const items = REVIEW_CHECKLIST[asset.asset_kind as AssetKind];
  const markViewed = async () => {
    if (viewed) return;
    const res = await act(asset.id, { action: 'view' });
    if (res.ok) setViewed(true);
  };
  const decide = async (approve: boolean) => {
    setBusy(true);
    const res = await act(asset.id, { action: approve ? 'approve' : 'reject', note, checklist: checks });
    setBusy(false);
    if (!res.ok) return toast(reviewError(t, res.error), 'error');
    toast(approve ? r.approved : r.rejected);
    onDone();
  };
  const what = asset.view ? p.views[asset.view] : (asset.expression_key ?? asset.outfit_key ?? '');
  return (
    <article className="review-item" data-testid="review-item">
      <div className="review-media">
        {asset.url && asset.mime_type.startsWith('image/') ? (
          <img src={asset.url} alt={`${what} · ${p.kinds[asset.asset_kind]}`} onLoad={() => void markViewed()} />
        ) : asset.url ? (
          <a className="btn btn-sm" href={asset.url} target="_blank" rel="noreferrer" onClick={() => void markViewed()}>
            {r.openModel}
          </a>
        ) : null}
      </div>
      <div className="stack-sm">
        <div className="row" style={{ gap: 6 }}>
          <b>{what}</b>
          <span className="badge plain">{p.kinds[asset.asset_kind]}</span>
          <span className="xsmall muted">{(t.characters.upload.provenances as Record<string, string>)[asset.provenance] ?? asset.provenance}</span>
          {viewed && <span className="badge badge-success plain">{r.opened}</span>}
        </div>
        {asset.provenance_note && (
          <p className="xsmall muted" dir="auto">
            {asset.provenance_note}
          </p>
        )}
        <fieldset className="plain-fieldset stack-sm">
          <legend className="field-label">{r.checklist}</legend>
          {items.map((k) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={Boolean(checks[k])} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
              <span className="small">{(r.checks as Record<string, string>)[k]}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">{r.note}</span>
          <input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} dir="auto" />
        </label>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !viewed || items.some((k) => !checks[k])} onClick={() => void decide(true)}>
            {r.approve}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void decide(false)}>
            {r.reject}
          </button>
        </div>
      </div>
    </article>
  );
}

function ApprovedList({ assets, onDone }: { assets: ReferenceAsset[]; onDone: () => void }) {
  const { t } = useI18n();
  const r = t.characters.review;
  const p = t.characters.preview;
  const toast = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const retire = async (id: string) => {
    const res = await act(id, { action: 'retire', note });
    if (!res.ok) return toast(reviewError(t, res.error), 'error');
    toast(r.retired);
    setTarget(null);
    setNote('');
    onDone();
  };
  return (
    <details>
      <summary className="small">
        {p.slot.approved} <span className="mono ltr">({assets.length})</span>
      </summary>
      <ul className="plain-list">
        {assets.map((a) => (
          <li key={a.id} className="small row" style={{ gap: 8 }}>
            {a.view ? p.views[a.view] : (a.expression_key ?? a.outfit_key ?? p.kinds[a.asset_kind])} · {p.kinds[a.asset_kind]}
            {target === a.id ? (
              <>
                <input className="input input-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder={r.note} aria-label={r.note} dir="auto" />
                <button type="button" className="btn btn-sm" onClick={() => void retire(a.id)}>
                  {r.retire}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTarget(a.id)}>
                {r.retire}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function UploadForm({ characterId, prefix, outfits, onDone }: { characterId: string; prefix: string; outfits: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const u = t.characters.upload;
  const p = t.characters.preview;
  const toast = useToast();
  const [kind, setKind] = useState<AssetKind>('rendered_reference');
  const [view, setView] = useState<string>('front');
  const [expression, setExpression] = useState('');
  const [outfit, setOutfit] = useState('');
  const [provenance, setProvenance] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return toast(u.errors.no_file, 'error');
    if (!provenance) return toast(u.errors.provenance_required, 'error');
    setBusy(true);
    const res = await uploadReference({
      characterId,
      uploadPrefix: prefix,
      file,
      kind,
      view: kind === 'rigged_model' ? null : view || null,
      expression: kind === 'rendered_reference' ? expression || null : null,
      outfit: outfit || null,
      provenance,
      note,
    });
    setBusy(false);
    if ('error' in res) return toast((u.errors as Record<string, string>)[res.error] ?? t.common.errorGeneric, 'error');
    toast(u.done);
    setFile(null);
    formRef.current?.reset();
    onDone();
  }

  const accept = kind === 'rendered_reference' ? 'image/png,image/jpeg,image/webp' : kind === 'rigged_model' ? '.glb,.gltf,.fbx' : 'video/mp4,video/webm';
  return (
    <form ref={formRef} className="panel panel-pad stack-sm upload-ref" onSubmit={submit} aria-labelledby="upload-ref-h">
      <h3 id="upload-ref-h" className="section-title">
        {u.title}
      </h3>
      <div className="form-grid cols-2">
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-1`}>
            {u.kind}
          </label>
          <select id={`${uid}-1`} className="select" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            {(['rendered_reference', 'rigged_model', 'turntable_video'] as const).map((k) => (
              <option key={k} value={k}>
                {p.kinds[k]}
              </option>
            ))}
          </select>
        </div>
        {kind !== 'rigged_model' && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}-2`}>
              {u.view}
            </label>
            <select id={`${uid}-2`} className="select" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="">{u.none}</option>
              {REFERENCE_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {p.views[v]}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'rendered_reference' && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}-3`}>
              {u.expression}
            </label>
            <select id={`${uid}-3`} className="select" value={expression} onChange={(e) => setExpression(e.target.value)}>
              <option value="">{u.none}</option>
              {EXPRESSION_KEYS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        )}
        {outfits.length > 0 && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}-4`}>
              {u.outfit}
            </label>
            <select id={`${uid}-4`} className="select" value={outfit} onChange={(e) => setOutfit(e.target.value)}>
              <option value="">{u.none}</option>
              {outfits.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-5`}>
            {u.provenance}
          </label>
          <select id={`${uid}-5`} className="select" value={provenance} onChange={(e) => setProvenance(e.target.value)} required>
            <option value="">{u.none}</option>
            {Object.entries(u.provenances).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-6`}>
            {u.note}
          </label>
          <input id={`${uid}-6`} className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} dir="auto" />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}-7`}>
          {u.file}
        </label>
        <input id={`${uid}-7`} type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? u.uploading : u.submit}
        </button>
      </div>
    </form>
  );
}
