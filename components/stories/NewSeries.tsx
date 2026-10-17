'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import type { CharacterRecord } from '@/lib/studio/types';
import { characterLabel } from '@/components/characters/labels';
import { Icon } from '@/components/ui/Icon';
import { postJson, storyMessage } from './api';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'place-1';

/** New series: title, language, canon cast, first location and optional first thread → Story Bible v1. */
export function NewSeries({ characters, languages, defaultLanguage }: { characters: CharacterRecord[]; languages: Array<{ code: string; native_name: string }>; defaultLanguage: string }) {
  const { t } = useI18n();
  const c = t.stories.create;
  const router = useRouter();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState(defaultLanguage);
  const [mode, setMode] = useState<'strict' | 'flexible'>('strict');
  const [premise, setPremise] = useState('');
  const [genre, setGenre] = useState('');
  const [tone, setTone] = useState('');
  const [cast, setCast] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [thread, setThread] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (cast.length === 0) return setError(c.needCharacter);
    setBusy(true);
    const bible = {
      premise,
      genre,
      tone,
      characters: cast.map((r) => ({ ref: r, name: characterLabel(t, r, characters.find((x) => x.id === r)?.name), role: '', traits: [], goals: [], motivations: [] })),
      relationships: [],
      locations: location.trim() ? [{ key: slug(location), name: location.trim(), description: '' }] : [],
      world_rules: [],
      arcs: thread.trim() ? [{ id: slug(thread), title: thread.trim(), description: '', status: 'open', opened_in: 1 }] : [],
    };
    const res = await postJson<{ series_id?: string }>('/api/stories', { title, language_code: language, continuity_mode: mode, bible });
    setBusy(false);
    if (!res.ok || !res.body.series_id) return setError(storyMessage(t, res.body));
    router.push(`/app/stories/${res.body.series_id}?tab=bible`);
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        {t.stories.newSeries}
      </button>
      {open && (
        <dialog ref={ref} className="dialog wide" onClose={() => setOpen(false)} aria-labelledby={`${id}-h`}>
          <form onSubmit={submit}>
            <div className="dialog-body stack">
              <h2 id={`${id}-h`}>{c.title}</h2>
              <div className="form-grid cols-2">
                <div className="field span-2">
                  <label className="field-label" htmlFor={`${id}-title`}>
                    {c.name}
                  </label>
                  <input id={`${id}-title`} className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-lang`}>
                    {c.language}
                  </label>
                  <select id={`${id}-lang`} className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {languages.map((l) => (
                      <option key={l.code} value={l.code} lang={l.code}>
                        {l.native_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-mode`}>
                    {c.continuity}
                  </label>
                  <select id={`${id}-mode`} className="select" value={mode} onChange={(e) => setMode(e.target.value as 'strict' | 'flexible')}>
                    <option value="strict">{c.strict}</option>
                    <option value="flexible">{c.flexible}</option>
                  </select>
                </div>
                <div className="field span-2">
                  <label className="field-label" htmlFor={`${id}-premise`}>
                    {c.premise}
                  </label>
                  <textarea id={`${id}-premise`} className="textarea" rows={3} maxLength={4000} value={premise} onChange={(e) => setPremise(e.target.value)} dir="auto" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-genre`}>
                    {c.genre}
                  </label>
                  <input id={`${id}-genre`} className="input" maxLength={120} value={genre} onChange={(e) => setGenre(e.target.value)} dir="auto" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-tone`}>
                    {c.tone}
                  </label>
                  <input id={`${id}-tone`} className="input" maxLength={200} value={tone} onChange={(e) => setTone(e.target.value)} dir="auto" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-loc`}>
                    {c.firstLocation}
                  </label>
                  <input id={`${id}-loc`} className="input" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} dir="auto" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-thread`}>
                    {c.firstThread}
                  </label>
                  <input id={`${id}-thread`} className="input" maxLength={160} value={thread} onChange={(e) => setThread(e.target.value)} dir="auto" />
                </div>
              </div>
              <fieldset className="plain-fieldset stack-sm">
                <legend className="field-label">{c.characters}</legend>
                <p className="xsmall muted">{c.charactersHint}</p>
                <div className="pick-grid">
                  {characters.map((ch) => (
                    <label key={ch.id} className="check-row">
                      <input type="checkbox" checked={cast.includes(ch.id)} onChange={(e) => setCast((x) => (e.target.checked ? [...x, ch.id].slice(0, 18) : x.filter((r) => r !== ch.id)))} />
                      <span className="small" dir="auto">
                        {characterLabel(t, ch.id, ch.name)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && (
                <p className="form-message error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
                {t.common.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t.common.saving : c.submit}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
