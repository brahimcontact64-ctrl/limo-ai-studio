'use client';
import { useId, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { MODE_FIELDS, type Brief, type BriefField, type CreationMode } from '@/lib/create/modes';
import { Icon } from '@/components/ui/Icon';

function ListField({ field, value, onChange, label }: { field: BriefField; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const { t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim().slice(0, field.max);
    if (!v || value.length >= 8 || value.includes(v)) return;
    onChange([...value, v]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        <small className="ltr">{value.length}/8</small>
      </label>
      {value.length > 0 && (
        <ul className="tag-list">
          {value.map((item) => (
            <li key={item} className="tag">
              <span dir="auto">{item}</span>
              <button type="button" aria-label={fmt(t.create.remove, { item })} onClick={() => onChange(value.filter((x) => x !== item))}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          id={id}
          className="input"
          value={draft}
          maxLength={field.max}
          placeholder={t.create.listPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={value.length >= 8}
          dir="auto"
        />
        <button type="button" className="btn" onClick={add} disabled={!draft.trim() || value.length >= 8}>
          {t.create.listAdd}
        </button>
      </div>
    </div>
  );
}

/** Mode-specific brief inputs (lib/create/modes.ts). */
export function BriefFields({ mode, brief, onChange }: { mode: CreationMode; brief: Brief; onChange: (b: Brief) => void }) {
  const { t } = useI18n();
  const base = useId();
  const labels = t.create.fields as Record<string, string>;
  const options = t.create.options as Record<string, string>;
  const set = (key: string, v: string | string[]) => {
    const next: Brief = { ...brief };
    if ((Array.isArray(v) && v.length === 0) || v === '') delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const hasClaims = MODE_FIELDS[mode].some((f) => f.claim);

  return (
    <div className="stack">
      <div className="form-grid cols-2">
        {MODE_FIELDS[mode].map((f) => {
          const id = `${base}-${f.key}`;
          const label = labels[f.key] ?? f.key;
          const value = brief[f.key];
          if (f.kind === 'list') {
            return (
              <div key={f.key} className="span-2">
                <ListField field={f} label={label} value={Array.isArray(value) ? value : []} onChange={(v) => set(f.key, v)} />
              </div>
            );
          }
          if (f.kind === 'select') {
            return (
              <div key={f.key} className="field">
                <label className="field-label" htmlFor={id}>
                  {label} <small>({t.common.optional})</small>
                </label>
                <select id={id} className="select" value={typeof value === 'string' ? value : ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {f.options!.map((o) => (
                    <option key={o} value={o}>
                      {options[o] ?? o}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={f.key} className={`field${f.kind === 'textarea' ? ' span-2' : ''}`}>
              <label className="field-label" htmlFor={id}>
                {label}
                {f.claim && <span className="badge badge-warning plain">!</span>}
              </label>
              {f.kind === 'textarea' ? (
                <textarea id={id} className="textarea" rows={3} maxLength={f.max} value={typeof value === 'string' ? value : ''} onChange={(e) => set(f.key, e.target.value)} dir="auto" />
              ) : (
                <input id={id} className="input" maxLength={f.max} value={typeof value === 'string' ? value : ''} onChange={(e) => set(f.key, e.target.value)} dir="auto" />
              )}
            </div>
          );
        })}
      </div>
      {hasClaims && <p className="callout callout-warning small">{t.studio.setup.claimNotice}</p>}
    </div>
  );
}
