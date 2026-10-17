'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { AssistResult, ScriptField } from '@/lib/ai/script';
import { DiffText } from './DiffText';

export interface AppliedChange {
  index: number;
  field: ScriptField;
  after: string;
}

const key = (index: number, field: string) => `${index}:${field}`;

/**
 * Mock AI suggestions are never applied silently: each changed field is listed with a diff and a
 * checkbox. Text the user already wrote is pre-selected only when they asked to transform it; a
 * whole-script draft pre-selects empty fields only.
 */
export function ProposalDialog({
  result,
  sceneTitles,
  onApply,
  onClose,
}: {
  result: AssistResult | null;
  sceneTitles: string[];
  onApply: (changes: AppliedChange[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const s = t.studio.script;
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (result && !d.open) {
      const initial = new Set<string>();
      for (const sc of result.scenes) for (const f of sc.fields) if (result.action !== 'draft' || !f.before.trim()) initial.add(key(sc.index, f.field));
      setSelected(initial);
      d.showModal();
    }
    if (!result && d.open) d.close();
  }, [result]);

  const toggle = (k: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose} aria-labelledby="proposal-h">
      <div className="dialog-body stack">
        <div>
          <span className="badge badge-warning plain">{s.mockAi}</span>
          <h2 id="proposal-h">{s.proposalTitle}</h2>
          <p className="small muted">{s.proposalLead}</p>
        </div>
        {result?.scenes.map((sc) => (
          <section key={sc.index} className="proposal-scene" aria-label={fmt(s.sceneN, { n: sc.index + 1 })}>
            <h3 className="section-title">
              {fmt(s.sceneN, { n: sc.index + 1 })}
              {sceneTitles[sc.index] ? ` · ${sceneTitles[sc.index]}` : ''}
            </h3>
            {sc.fields.map((f) => {
              const k = key(sc.index, f.field);
              return (
                <label key={k} className="proposal-field">
                  <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />
                  <span className="stack-sm">
                    <span className="field-label">
                      {s.fields[f.field]}
                      {f.before.trim() && <span className="badge badge-warning plain">{s.replaces}</span>}
                    </span>
                    <DiffText before={f.before} after={f.after} />
                  </span>
                </label>
              );
            })}
          </section>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selected.size === 0}
          onClick={() => {
            const changes: AppliedChange[] = [];
            for (const sc of result?.scenes ?? []) for (const f of sc.fields) if (selected.has(key(sc.index, f.field))) changes.push({ index: sc.index, field: f.field, after: f.after });
            onApply(changes);
            ref.current?.close();
          }}
        >
          {s.apply} <span className="ltr">({selected.size})</span>
        </button>
      </div>
    </dialog>
  );
}
