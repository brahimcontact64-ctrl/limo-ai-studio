'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { emptyDoc } from '@/lib/images/doc';
import { ASPECTS, EMPTY_BRIEF, IMAGE_PURPOSES, IMAGE_STYLES, type Aspect, type ImageBrief, type ImageDoc, type ImagePurpose, type ImageStyle } from '@/lib/images/types';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { uploadAsset } from '@/components/assets/upload';
import { Icon } from '@/components/ui/Icon';
import { DocPreview } from './DocPreview';
import { useLoadedImages } from './canvas';
import { imageMessage, postJson } from './api';

export interface PickedPhoto {
  id: string;
  url: string | null;
  name: string;
}

export interface StoryCharacter {
  ref: string;
  name: string;
  identity: string | null;
  reference_status: string;
}

export interface NewImagePrefill {
  title: string;
  purpose: ImagePurpose;
  prompt: string;
  brief: ImageBrief;
  photos: PickedPhoto[];
  series_id: string | null;
  source_project_id: string | null;
  characters: StoryCharacter[];
  context: { kind: 'project' | 'series'; title: string } | null;
  post_id: string | null;
}

const BRIEF_KEYS: Array<keyof ImageBrief> = ['headline', 'product_name', 'price', 'offer', 'cta', 'body'];
const UPLOAD_TYPES = 'image/png,image/jpeg,image/webp';

type Generated = { label: string; variations: ImageDoc[]; urls: Record<string, string> };

/** New image: describe it, add your own photos and text, then pick one of the mock layouts (or start blank). */
export function NewImage({ organizationId, prefill, hasBrandLogo }: { organizationId: string; prefill: NewImagePrefill; hasBrandLogo: boolean }) {
  const { t } = useI18n();
  const c = t.images.create;
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  // Disabled until the page is interactive: a file chosen before hydration would be lost silently.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [title, setTitle] = useState(prefill.title);
  const [purpose, setPurpose] = useState<ImagePurpose>(prefill.purpose);
  const [aspect, setAspect] = useState<Aspect>('1:1');
  const [style, setStyle] = useState<ImageStyle>('modern');
  const [prompt, setPrompt] = useState(prefill.prompt);
  const [brief, setBrief] = useState<ImageBrief>({ ...EMPTY_BRIEF, ...prefill.brief });
  const [photos, setPhotos] = useState<PickedPhoto[]>(prefill.photos);
  const [useBrand, setUseBrand] = useState(true);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'save' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const images = useLoadedImages(generated?.urls ?? {});

  const common = () => ({
    title: title.trim() || t.images.purposes[purpose],
    purpose,
    aspect,
    style,
    prompt,
    brief,
    series_id: prefill.series_id,
    source_project_id: prefill.source_project_id,
  });

  async function generate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('generate');
    const res = await postJson<Partial<Generated>>('/api/images/generate', {
      purpose,
      aspect,
      style,
      prompt,
      brief,
      photos: photos.map((p) => p.id),
      use_brand: useBrand,
      characters: purpose === 'story_illustration' ? prefill.characters : undefined,
    });
    setBusy(null);
    if (!res.ok || !res.body.variations) return setError(imageMessage(t, res.body));
    setGenerated({ label: res.body.label ?? t.images.mockBadge, variations: res.body.variations, urls: res.body.urls ?? {} });
  }

  async function create(document: ImageDoc, source: 'mock_generation' | 'manual', label: string | null) {
    setError(null);
    setBusy('save');
    const res = await postJson<{ id?: string }>('/api/images', { ...common(), document, source, label });
    if (!res.ok || !res.body.id) {
      setBusy(null);
      return setError(imageMessage(t, res.body));
    }
    router.push(`/app/images/${res.body.id}${prefill.post_id ? `?post=${prefill.post_id}` : ''}`);
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setBusy('upload');
    const res = await uploadAsset(organizationId, file, purpose === 'product_ad' ? 'product' : 'reference');
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    if ('error' in res) return setError(res.error === 'too_large' ? fmt(t.assets.tooLarge, { name: file.name }) : res.error === 'type_not_allowed' ? fmt(t.assets.typeNotAllowed, { name: file.name }) : t.images.errors.upload);
    setPhotos((p) => [...p, { id: res.id, url: URL.createObjectURL(file), name: file.name }].slice(0, 6));
  }

  return (
    <div className="stack-lg">
      {prefill.context && (
        <p className="callout small" dir="auto">
          {fmt(prefill.context.kind === 'project' ? c.fromProject : c.fromSeries, { title: prefill.context.title })}
        </p>
      )}
      <form className="panel panel-pad stack" onSubmit={generate}>
        <div className="form-grid cols-2">
          <div className="field span-2">
            <label className="field-label" htmlFor={`${id}-title`}>
              {c.name}
            </label>
            <input id={`${id}-title`} className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" placeholder={t.images.purposes[purpose]} />
          </div>
          <div className="field span-2">
            <label className="field-label" htmlFor={`${id}-prompt`}>
              {c.describe}
            </label>
            <textarea id={`${id}-prompt`} className="textarea" rows={3} maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)} dir="auto" placeholder={c.describeHint} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-purpose`}>
              {c.purpose}
            </label>
            <select id={`${id}-purpose`} className="select" value={purpose} onChange={(e) => setPurpose(e.target.value as ImagePurpose)}>
              {IMAGE_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t.images.purposes[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-style`}>
              {c.style}
            </label>
            <select id={`${id}-style`} className="select" value={style} onChange={(e) => setStyle(e.target.value as ImageStyle)}>
              {IMAGE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t.images.styles[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <span className="field-label" id={`${id}-aspect`}>
              {c.aspect}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby={`${id}-aspect`}>
              {ASPECTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={aspect === a} onClick={() => setAspect(a)}>
                  <span className="aspect-swatch" data-aspect={a} aria-hidden="true" />
                  {t.images.aspects[a]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="stack-sm">
          <h3 className="section-title">{c.photos}</h3>
          <p className="small muted">{c.photosHint}</p>
          {photos.length > 0 && (
            <ul className="photo-chips" data-testid="picked-photos">
              {photos.map((p) => (
                <li key={p.id} className="photo-chip">
                  {p.url ? <img src={p.url} alt="" /> : <Icon name="image" />}
                  <span className="small" title={p.name}>
                    {p.name}
                  </span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${c.removePhoto}: ${p.name}`} onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setPicker(true)} disabled={photos.length >= 6}>
              <Icon name="image" />
              {c.addPhotos}
            </button>
            <label className={`btn btn-sm${busy === 'upload' ? ' is-busy' : ''}`}>
              <Icon name="plus" />
              {busy === 'upload' ? t.common.loading : c.upload}
              <input ref={fileRef} type="file" accept={UPLOAD_TYPES} className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={!interactive || busy !== null || photos.length >= 6} data-testid="photo-upload" />
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={useBrand} onChange={(e) => setUseBrand(e.target.checked)} />
            <span>{hasBrandLogo ? c.useBrand : c.useBrandColors}</span>
          </label>
        </section>

        {purpose === 'story_illustration' && prefill.characters.length > 0 && (
          <section className="stack-sm">
            <h3 className="section-title">{c.characters}</h3>
            <p className="small muted">{c.charactersHint}</p>
            <ul className="plain-list small">
              {prefill.characters.map((ch) => (
                <li key={ch.ref} dir="auto">
                  <b>{ch.name}</b> · <span className="muted">{t.images.referenceStatus[ch.reference_status as keyof typeof t.images.referenceStatus] ?? ch.reference_status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="stack-sm">
          <h3 className="section-title">{c.brief}</h3>
          <p className="small muted">{c.briefHint}</p>
          <div className="form-grid cols-2">
            {BRIEF_KEYS.map((k) => (
              <div key={k} className={`field${k === 'body' ? ' span-2' : ''}`}>
                <label className="field-label" htmlFor={`${id}-${k}`}>
                  {c.fields[k]}
                </label>
                <input id={`${id}-${k}`} className="input" maxLength={k === 'body' ? 300 : 120} value={brief[k]} onChange={(e) => setBrief((b) => ({ ...b, [k]: e.target.value }))} dir="auto" />
              </div>
            ))}
          </div>
        </section>

        {error && (
          <p className="callout callout-danger small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>
            <Icon name="sparkle" />
            {busy === 'generate' ? c.generating : c.generate}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void create(emptyDoc(aspect), 'manual', null)}>
            {c.blank}
          </button>
        </div>
        <p className="xsmall muted">{t.images.mockNote}</p>
      </form>

      {generated && (
        <section className="stack" aria-labelledby={`${id}-var`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id={`${id}-var`} className="section-title">
              {c.variations}
            </h2>
            <span className="badge badge-warning" data-testid="mock-label">
              {t.images.mockBadge}
            </span>
          </div>
          <ul className="variation-grid">
            {generated.variations.map((doc, i) => {
              const name = t.images.variations[(doc.meta.variation ?? 'hero') as keyof typeof t.images.variations] ?? doc.meta.variation;
              return (
                <li key={i} className="variation-card panel">
                  <DocPreview doc={doc} images={images} label={`${name} — ${t.images.mockBadge}`} />
                  <div className="variation-foot">
                    <span className="small">
                      <b>{name}</b>
                    </span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void create(doc, 'mock_generation', `${generated.label}: ${doc.meta.variation}`)}>
                      {busy === 'save' ? c.saving : c.useThis}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AssetPicker
        open={picker}
        selected={photos.map((p) => p.id)}
        max={6}
        filter={(a) => a.media_type === 'image'}
        onClose={(ids, assets) => {
          setPicker(false);
          if (!ids) return;
          setPhotos(ids.map((x) => photos.find((p) => p.id === x) ?? { id: x, url: assets.find((a) => a.id === x)?.url ?? null, name: assets.find((a) => a.id === x)?.label ?? assets.find((a) => a.id === x)?.file_name ?? x }));
        }}
      />
    </div>
  );
}
