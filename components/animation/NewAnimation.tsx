'use client';
import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/client';
import { Icon } from '@/components/ui/Icon';

/** Creates an empty animation project; the owner then writes the scenario shot by shot. */
export function NewAnimation({ defaultLanguage }: { defaultLanguage: string }) {
  const { t } = useI18n();
  const a = t.animation;
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState(['en', 'fr', 'ar', 'de'].includes(defaultLanguage) ? defaultLanguage : 'fr');
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/animation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, language, aspect }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (!res?.ok || !body.id) return setError((a.errors as Record<string, string>)[body.error ?? ''] ?? a.errors.unavailable);
    router.push(`/app/animation/${body.id}`);
  }

  if (!open)
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="new-animation">
        <Icon name="plus" /> {a.newProject}
      </button>
    );
  return (
    <form className="panel panel-pad stack-sm" onSubmit={submit} aria-labelledby={`${id}-h`} data-testid="new-animation-form">
      <b id={`${id}-h`}>{a.newProject}</b>
      <label className="field">
        <span className="field-label">{a.titleLabel}</span>
        <input className="input" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} required dir="auto" />
      </label>
      <div className="row">
        <label className="field">
          <span className="field-label xsmall">{a.language}</span>
          <select className="select select-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {['fr', 'ar', 'en', 'de'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label xsmall">{a.aspect}</span>
          <select className="select select-sm" value={aspect} onChange={(e) => setAspect(e.target.value as '9:16' | '16:9')}>
            <option value="9:16">{a.aspects['9:16']}</option>
            <option value="16:9">{a.aspects['16:9']}</option>
          </select>
        </label>
      </div>
      {error && <p className="callout callout-danger small" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>{a.create}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{a.cancel}</button>
      </div>
    </form>
  );
}
