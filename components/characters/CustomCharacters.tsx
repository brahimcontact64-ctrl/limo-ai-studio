'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { CHARACTER_FAMILIES } from '@/lib/studio/limits';
import type { CharacterRecord } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CharacterCard } from './CharacterCard';
import { CharacterPreview } from './CharacterPreview';

export interface CustomCharacterRow {
  id: string;
  name: string;
  description: string;
  base_family: string | null;
  age_group: string | null;
  gender_code: string | null;
  spec: Record<string, unknown>;
  reference_status: string;
}

interface FormState {
  name: string;
  description: string;
  base_family: string;
  age_group: string;
  gender_code: string;
  personality: string;
  details: string;
  primary: string;
  secondary: string;
  accent: string;
  outfit: string;
}

const EMPTY: FormState = { name: '', description: '', base_family: '', age_group: '', gender_code: '', personality: '', details: '', primary: '#7157EF', secondary: '#F4F1EA', accent: '#211E2B', outfit: '' };

function fromRow(r: CustomCharacterRow): FormState {
  const palette = Array.isArray(r.spec.palette) ? (r.spec.palette as Array<{ key: string; hex: string }>) : [];
  const color = (k: string, d: string) => palette.find((p) => p.key === k)?.hex ?? d;
  return {
    name: r.name,
    description: r.description ?? '',
    base_family: r.base_family ?? '',
    age_group: r.age_group ?? '',
    gender_code: r.gender_code ?? '',
    personality: typeof r.spec.personality === 'string' ? r.spec.personality : '',
    details: Array.isArray(r.spec.signature_details) ? (r.spec.signature_details as string[]).join('\n') : '',
    primary: color('primary', EMPTY.primary),
    secondary: color('secondary', EMPTY.secondary),
    accent: color('accent', EMPTY.accent),
    outfit: typeof r.spec.outfit === 'string' ? r.spec.outfit : '',
  };
}

/** Workspace characters: create, edit, archive, open details (references + review for owners/admins). */
export function CustomCharacters({ rows, records, canEdit }: { rows: CustomCharacterRow[]; records: CharacterRecord[]; canEdit: boolean }) {
  const { t } = useI18n();
  const c = t.characters.custom;
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<CustomCharacterRow | 'new' | null>(null);
  const [preview, setPreview] = useState<CharacterRecord | null>(null);
  const [archiving, setArchiving] = useState<CustomCharacterRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    const res = await fetch(`/api/characters/custom/${archiving.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setArchiving(null);
    if (!res?.ok) return toast(t.common.errorGeneric, 'error');
    toast(c.archived);
    router.refresh();
  }

  return (
    <section className="stack" aria-labelledby="custom-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 id="custom-h" className="section-title">
            {c.title}
          </h2>
          <p className="small muted">{c.lead}</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            {c.create}
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <p className="empty small">{c.empty}</p>
      ) : (
        <div className="char-grid">
          {records.map((r) => {
            const row = rows.find((x) => `custom:${x.id}` === r.id)!;
            return (
              <div key={r.id} className="stack-sm">
                <CharacterCard character={r} onPreview={() => setPreview(r)} />
                {canEdit && (
                  <div className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(row)}>
                      {c.edit}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiving(row)}>
                      {c.archive}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && <CharacterForm initial={editing === 'new' ? null : editing} onClose={(saved) => (setEditing(null), saved && router.refresh())} />}
      {preview && <CharacterPreview open characterId={preview.id} label={preview.name} onClose={() => setPreview(null)} onChanged={() => router.refresh()} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        title={c.archiveTitle}
        body={c.archiveBody}
        confirmLabel={c.archive}
        busy={busy}
        onClose={() => setArchiving(null)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}

function CharacterForm({ initial, onClose }: { initial: CustomCharacterRow | null; onClose: (saved: boolean) => void }) {
  const { t } = useI18n();
  const c = t.characters.custom;
  const toast = useToast();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<FormState>(initial ? fromRow(initial) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const set = (k: keyof FormState) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/characters/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: initial?.id,
        name: f.name,
        description: f.description,
        base_family: f.base_family || null,
        age_group: f.age_group || null,
        gender_code: f.gender_code || null,
        personality: f.personality,
        details: f.details.split('\n').map((d) => d.trim()).filter(Boolean),
        colors: { primary: f.primary, secondary: f.secondary, accent: f.accent },
        outfit: f.outfit,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setError((c.errors as Record<string, string>)[body?.error ?? ''] ?? t.common.errorGeneric);
    toast(c.saved);
    saved.current = true;
    ref.current?.close();
  }

  const text = (k: keyof FormState, label: string, max: number, multiline = false) => (
    <div className={`field${multiline ? ' span-2' : ''}`}>
      <label className="field-label" htmlFor={`${id}-${k}`}>
        {label}
      </label>
      {multiline ? (
        <textarea id={`${id}-${k}`} className="textarea" rows={3} maxLength={max} value={f[k]} onChange={(e) => set(k)(e.target.value)} dir="auto" />
      ) : (
        <input id={`${id}-${k}`} className="input" maxLength={max} value={f[k]} onChange={(e) => set(k)(e.target.value)} dir="auto" required={k === 'name'} />
      )}
    </div>
  );
  const select = (k: keyof FormState, label: string, options: Array<[string, string]>) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${k}`}>
        {label}
      </label>
      <select id={`${id}-${k}`} className="select" value={f[k]} onChange={(e) => set(k)(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  const color = (k: 'primary' | 'secondary' | 'accent', label: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${k}`}>
        {label}
      </label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id={`${id}-${k}`} type="color" className="color-input" value={f[k]} onChange={(e) => set(k)(e.target.value)} />
        <input className="input ltr" value={f[k]} maxLength={7} onChange={(e) => set(k)(e.target.value)} aria-label={label} />
      </div>
    </div>
  );

  return (
    <dialog ref={ref} className="dialog wide" onClose={() => onClose(saved.current)} aria-labelledby={`${id}-h`}>
      <form onSubmit={submit}>
        <div className="dialog-body stack">
          <h2 id={`${id}-h`}>{initial ? `${c.edit}: ${initial.name}` : c.create}</h2>
          <div className="form-grid cols-2">
            {text('name', c.name, 80)}
            {text('personality', c.personality, 120)}
            {text('description', c.description, 2000, true)}
            <p className="xsmall muted span-2">{c.descriptionHint}</p>
            {select('base_family', c.baseFamily, [['', c.noFamily], ...CHARACTER_FAMILIES.map((x) => [x, t.characters.familyKind[x]] as [string, string])])}
            {select('age_group', c.ageGroup, [['', '—'], ['child', t.characters.age.child], ['adult', t.characters.age.adult], ['elder', t.characters.age.elder]])}
            {select('gender_code', c.gender, [['', '—'], ['female', c.genders.female], ['male', c.genders.male], ['unspecified', c.genders.unspecified]])}
            {text('outfit', c.outfit, 300)}
            {text('details', c.details, 1000, true)}
          </div>
          <fieldset className="plain-fieldset">
            <legend className="field-label">{c.colors}</legend>
            <div className="form-grid cols-3">
              {color('primary', c.primary)}
              {color('secondary', c.secondary)}
              {color('accent', c.accent)}
            </div>
          </fieldset>
          {initial && <p className="callout small">{c.specChanged}</p>}
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
            {busy ? t.common.saving : t.common.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
