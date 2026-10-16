'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { emptyProject, toSaveRequest } from '@/lib/studio/draft';
import { buildStarterScenes } from '@/lib/create/templates';
import { MODE_CONTENT_TYPE, MODE_PRESET, type Brief, type CreationMode } from '@/lib/create/modes';
import type { CatalogOption, ExportPresetOption } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { AssetThumb, type ClientAsset } from '@/components/assets/AssetThumb';
import { BriefFields } from './BriefFields';

const MEDIA_MODES: ReadonlySet<CreationMode> = new Set(['product_ad', 'business_promo', 'social_video', 'social_post', 'ugc_ad', 'custom']);

export function CreateForm({
  mode,
  languages,
  exportPresets,
  contentTypes,
  defaultLanguage,
}: {
  mode: CreationMode;
  languages: Array<CatalogOption & { native_name: string }>;
  exportPresets: ExportPresetOption[];
  contentTypes: CatalogOption[];
  defaultLanguage: string;
}) {
  const { t } = useI18n();
  const c = t.create;
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [brief, setBrief] = useState<Brief>({});
  const [language, setLanguage] = useState(defaultLanguage);
  const [preset, setPreset] = useState(exportPresets.some((p) => p.code === MODE_PRESET[mode]) ? MODE_PRESET[mode] : (exportPresets[0]?.code ?? ''));
  const [media, setMedia] = useState<ClientAsset[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles = c.templates[mode];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError(t.studio.issues.title_required);
    const contentType = contentTypes.some((x) => x.code === MODE_CONTENT_TYPE[mode]) ? MODE_CONTENT_TYPE[mode] : (contentTypes[0]?.code ?? 'custom');
    const draft = emptyProject({
      content_type: contentType,
      language_code: language,
      creation_mode: mode,
      creation_brief: brief,
      export_presets: preset ? [preset] : [],
    });
    draft.title = title.trim();
    draft.brief = idea;
    draft.scenes = buildStarterScenes(
      mode,
      brief,
      titles,
      media.map((m) => m.id),
    );
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSaveRequest(draft)),
      });
      const body = (await res.json().catch(() => ({}))) as {
        project_id?: string;
        error?: string;
      };
      if (!res.ok || !body.project_id) {
        const key = (body.error ?? 'unknown') as keyof typeof t.studio.saveErrors;
        setError(body.error === 'rate_limited' ? t.rateLimited : (t.studio.saveErrors[key] ?? t.studio.saveErrors.unknown));
        return;
      }
      toast(t.studio.createdToast);
      router.push(`/app/projects/${body.project_id}`);
    } catch {
      setError(t.studio.saveErrors.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <section className="panel panel-pad stack-lg">
        <div className="form-grid cols-2">
          <div className="field span-2">
            <label className="field-label" htmlFor={`${id}-title`}>
              {c.projectName}
            </label>
            <input id={`${id}-title`} className="input input-lg" maxLength={200} required value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />
          </div>
          <div className="field span-2">
            <label className="field-label" htmlFor={`${id}-idea`}>
              {c.idea} <small>({t.common.optional})</small>
            </label>
            <textarea id={`${id}-idea`} className="textarea" rows={3} maxLength={8000} placeholder={c.ideaPlaceholder} value={idea} onChange={(e) => setIdea(e.target.value)} dir="auto" />
          </div>
          <fieldset className="field plain-fieldset">
            <legend className="field-label">{c.language}</legend>
            <div className="segmented" role="radiogroup" aria-label={c.language}>
              {languages.map((l) => (
                <button key={l.code} type="button" role="radio" aria-checked={language === l.code} lang={l.code} onClick={() => setLanguage(l.code)}>
                  {l.native_name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field plain-fieldset">
            <legend className="field-label">{c.format}</legend>
            <div className="segmented" role="radiogroup" aria-label={c.format}>
              {exportPresets.map((p) => (
                <button key={p.code} type="button" role="radio" aria-checked={preset === p.code} onClick={() => setPreset(p.code)}>
                  <span className="ltr">{p.aspect_ratio}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-brief`}>
        <h2 id={`${id}-brief`} className="section-title">
          {t.studio.setup.briefDetails}
        </h2>
        <BriefFields mode={mode} brief={brief} onChange={setBrief} />
      </section>

      {MEDIA_MODES.has(mode) && (
        <section className="panel panel-pad stack" aria-labelledby={`${id}-media`}>
          <h2 id={`${id}-media`} className="section-title">
            {c.media}
          </h2>
          <p className="small muted">{c.mediaHint}</p>
          <div className="scene-assets">
            {media.map((m) => (
              <AssetThumb key={m.id} asset={m} size="sm" />
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
              <Icon name="plus" />
              {t.studio.scenes.fields.addAssets}
            </button>
          </div>
        </section>
      )}

      <section className="panel panel-pad stack" aria-labelledby={`${id}-scenes`}>
        <h2 id={`${id}-scenes`} className="section-title">
          {c.starterScenes}
        </h2>
        <p className="small muted">{c.starterScenesHint}</p>
        <ol className="starter-list">
          {titles.map((s, i) => (
            <li key={s}>
              <span className="step-num ltr">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>

      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link className="btn btn-ghost" href="/app/create">
          <Icon name="chevronLeft" className="flip-rtl" />
          {c.back}
        </Link>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? t.common.saving : c.start}
        </button>
      </div>

      <AssetPicker
        open={picking}
        selected={media.map((m) => m.id)}
        filter={(a) => a.media_type === 'image' || a.media_type === 'video'}
        onClose={(ids, assets) => {
          setPicking(false);
          if (ids) setMedia(ids.map((x) => assets.find((a) => a.id === x)).filter((a): a is ClientAsset => Boolean(a)));
        }}
      />
    </form>
  );
}
