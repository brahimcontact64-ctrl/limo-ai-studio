'use client';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { diffBible, type BibleChange } from '@/lib/story/bible';
import type { StoryBible } from '@/lib/story/types';
import type { CharacterRecord } from '@/lib/studio/types';
import { characterLabel } from '@/components/characters/labels';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { postJson, storyMessage } from './api';

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const slug = (s: string, used: Set<string>, fallback: string) => {
  const base =
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || fallback;
  let k = base;
  for (let i = 2; used.has(k); i++) k = `${base}-${i}`;
  return k;
};

/**
 * Story Bible (canon) editor. Every save shows the exact changes and creates a new version; identities
 * (character refs, location and thread keys) cannot be edited once saved, because endings refer to them.
 */
export function BibleEditor({ seriesId, version, bible, characters, canEdit }: { seriesId: string; version: number; bible: StoryBible; characters: CharacterRecord[]; canEdit: boolean }) {
  const { t } = useI18n();
  const b = t.stories.bible;
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState<StoryBible>(bible);
  const [confirming, setConfirming] = useState<BibleChange[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const savedLocations = useMemo(() => new Set(bible.locations.map((l) => l.key)), [bible]);
  const savedArcs = useMemo(() => new Set(bible.arcs.map((a) => a.id)), [bible]);
  const available = characters.filter((c) => !draft.characters.some((x) => x.ref === c.id));
  const [adding, setAdding] = useState('');
  const nameOf = (ref: string) => draft.characters.find((c) => c.ref === ref)?.name ?? ref;
  const set = (patch: Partial<StoryBible>) => setDraft((d) => ({ ...d, ...patch }));
  const editList = <K extends 'characters' | 'relationships' | 'locations' | 'world_rules' | 'arcs'>(key: K, i: number, patch: Partial<StoryBible[K][number]>) =>
    setDraft((d) => ({ ...d, [key]: (d[key] as Array<StoryBible[K][number]>).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const removeAt = (key: 'characters' | 'relationships' | 'locations' | 'world_rules' | 'arcs', i: number) =>
    setDraft((d) => ({ ...d, [key]: (d[key] as unknown[]).filter((_, j) => j !== i) }));

  async function save() {
    setBusy(true);
    const res = await postJson<{ version?: number }>(`/api/stories/${seriesId}/bible`, { base_version: version, bible: draft, note });
    setBusy(false);
    if (!res.ok) return toast(storyMessage(t, res.body), 'error');
    toast(fmt(b.saved, { n: res.body.version ?? version + 1 }));
    setConfirming(null);
    setNote('');
    router.refresh();
  }

  const field = (label: string, value: string, onChange: (v: string) => void, opts: { multiline?: boolean; max?: number; idSuffix: string; readOnly?: boolean }) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${opts.idSuffix}`}>
        {label}
      </label>
      {opts.multiline ? (
        <textarea id={`${id}-${opts.idSuffix}`} className="textarea" rows={2} maxLength={opts.max ?? 1000} value={value} onChange={(e) => onChange(e.target.value)} dir="auto" disabled={!canEdit} />
      ) : (
        <input id={`${id}-${opts.idSuffix}`} className="input" maxLength={opts.max ?? 200} value={value} onChange={(e) => onChange(e.target.value)} dir="auto" disabled={!canEdit || opts.readOnly} />
      )}
    </div>
  );

  return (
    <section className="stack-lg bible-editor" aria-label={t.stories.tabs.bible}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge badge-accent plain">{fmt(b.version, { n: version })}</span>
        {canEdit && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const changes = diffBible(bible, draft);
              if (changes.length === 0) toast(b.noChanges);
              else setConfirming(changes);
            }}
          >
            <Icon name="save" />
            {b.save}
          </button>
        )}
      </div>

      {confirming && (
        <div className="callout callout-warning stack-sm" role="alert" data-testid="bible-confirm">
          <strong>{b.reviewTitle}</strong>
          <span>{fmt(b.reviewBody, { n: version + 1 })}</span>
          <ul className="plain-list small">
            {confirming.map((c, i) => (
              <li key={i}>
                {b.changes[c.kind]} · {b.sections[c.section]} · <span dir="auto">{c.section === 'characters' ? nameOf(c.key) : c.key}</span>
              </li>
            ))}
          </ul>
          <input className="input" placeholder={b.note} aria-label={b.note} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} dir="auto" />
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
              {t.common.cancel}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
              {busy ? t.common.saving : b.save}
            </button>
          </div>
        </div>
      )}

      <div className="panel panel-pad form-grid cols-2">
        <div className="span-2">{field(b.premise, draft.premise, (v) => set({ premise: v }), { multiline: true, max: 4000, idSuffix: 'premise' })}</div>
        {field(b.genre, draft.genre, (v) => set({ genre: v }), { max: 120, idSuffix: 'genre' })}
        {field(b.tone, draft.tone, (v) => set({ tone: v }), { max: 200, idSuffix: 'tone' })}
      </div>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-chars`}>
        <h3 id={`${id}-chars`} className="section-title">
          {b.characters}
        </h3>
        <p className="xsmall muted">{b.identityNote}</p>
        {draft.characters.map((c, i) => (
          <div key={c.ref} className="bible-row" data-testid={`bible-character-${c.ref}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="badge plain mono ltr">{c.ref.startsWith('custom:') ? 'custom' : c.ref}</span>
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeAt('characters', i)} aria-label={`${b.remove}: ${c.name}`}>
                  {b.remove}
                </button>
              )}
            </div>
            <div className="form-grid cols-2">
              {field(b.name, c.name, (v) => editList('characters', i, { name: v }), { max: 80, idSuffix: `c${i}-name` })}
              {field(b.role, c.role, (v) => editList('characters', i, { role: v }), { idSuffix: `c${i}-role` })}
              {field(b.traits, c.traits.join('\n'), (v) => editList('characters', i, { traits: lines(v) }), { multiline: true, idSuffix: `c${i}-traits` })}
              {field(b.goals, c.goals.join('\n'), (v) => editList('characters', i, { goals: lines(v) }), { multiline: true, idSuffix: `c${i}-goals` })}
              {field(b.motivations, c.motivations.join('\n'), (v) => editList('characters', i, { motivations: lines(v) }), { multiline: true, idSuffix: `c${i}-motivations` })}
            </div>
          </div>
        ))}
        {canEdit && available.length > 0 && (
          <div className="row">
            <select className="select select-sm" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={b.addCharacter}>
              <option value="">—</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {characterLabel(t, c.id, c.name)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!adding}
              onClick={() => {
                const c = characters.find((x) => x.id === adding);
                if (!c) return;
                set({ characters: [...draft.characters, { ref: c.id, name: characterLabel(t, c.id, c.name), role: '', traits: [], goals: [], motivations: [] }] });
                setAdding('');
              }}
            >
              <Icon name="plus" />
              {b.addCharacter}
            </button>
          </div>
        )}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-rels`}>
        <h3 id={`${id}-rels`} className="section-title">
          {b.relationships}
        </h3>
        {draft.relationships.map((r, i) => (
          <div key={i} className="form-grid cols-4 bible-inline">
            {(['a', 'b'] as const).map((side) => (
              <div key={side} className="field">
                <label className="field-label" htmlFor={`${id}-r${i}-${side}`}>
                  {b.character}
                </label>
                <select id={`${id}-r${i}-${side}`} className="select" value={r[side]} onChange={(e) => editList('relationships', i, { [side]: e.target.value })} disabled={!canEdit}>
                  {draft.characters.map((c) => (
                    <option key={c.ref} value={c.ref}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {field(b.kind, r.kind, (v) => editList('relationships', i, { kind: v }), { max: 60, idSuffix: `r${i}-kind` })}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              {field(b.note, r.note, (v) => editList('relationships', i, { note: v }), { max: 300, idSuffix: `r${i}-note` })}
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAt('relationships', i)} aria-label={b.remove}>
                  <Icon name="x" />
                </button>
              )}
            </div>
          </div>
        ))}
        {canEdit && draft.characters.length >= 2 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => set({ relationships: [...draft.relationships, { a: draft.characters[0]!.ref, b: draft.characters[1]!.ref, kind: '', note: '' }] })}
          >
            <Icon name="plus" />
            {b.addRelationship}
          </button>
        )}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-locs`}>
        <h3 id={`${id}-locs`} className="section-title">
          {b.locations}
        </h3>
        {draft.locations.map((l, i) => (
          <div key={i} className="form-grid cols-3 bible-inline">
            {field(b.name, l.name, (v) => editList('locations', i, { name: v }), { max: 120, idSuffix: `l${i}-name` })}
            {field(b.key, l.key, (v) => editList('locations', i, { key: v.toLowerCase() }), { max: 40, idSuffix: `l${i}-key`, readOnly: savedLocations.has(l.key) })}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              {field(b.description, l.description, (v) => editList('locations', i, { description: v }), { max: 1000, idSuffix: `l${i}-desc` })}
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAt('locations', i)} aria-label={`${b.remove}: ${l.name}`}>
                  <Icon name="x" />
                </button>
              )}
            </div>
          </div>
        ))}
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => set({ locations: [...draft.locations, { key: slug('', new Set(draft.locations.map((l) => l.key)), `place-${draft.locations.length + 1}`), name: '', description: '' }] })}>
            <Icon name="plus" />
            {b.addLocation}
          </button>
        )}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-rules`}>
        <h3 id={`${id}-rules`} className="section-title">
          {b.rules}
        </h3>
        {draft.world_rules.map((r, i) => (
          <div key={r.id} className="form-grid cols-3 bible-inline">
            <div className="span-2">{field(b.ruleText, r.text, (v) => editList('world_rules', i, { text: v }), { max: 500, idSuffix: `w${i}-text` })}</div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="check-row">
                <input type="checkbox" checked={r.kind === 'forbidden'} disabled={!canEdit} onChange={(e) => editList('world_rules', i, { kind: e.target.checked ? 'forbidden' : 'rule' })} />
                <span className="small">{b.forbidden}</span>
              </label>
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAt('world_rules', i)} aria-label={b.remove}>
                  <Icon name="x" />
                </button>
              )}
            </div>
          </div>
        ))}
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => set({ world_rules: [...draft.world_rules, { id: slug('', new Set(draft.world_rules.map((r) => r.id)), `rule-${draft.world_rules.length + 1}`), text: '', kind: 'rule' }] })}>
            <Icon name="plus" />
            {b.addRule}
          </button>
        )}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-arcs`}>
        <h3 id={`${id}-arcs`} className="section-title">
          {b.arcs}
        </h3>
        {draft.arcs.map((a, i) => (
          <div key={i} className="bible-row">
            <div className="row" style={{ gap: 6 }}>
              <span className={`badge ${a.status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>{b.arcStatus[a.status]}</span>
              {a.opened_in && <span className="xsmall muted">{fmt(b.openedIn, { n: a.opened_in })}</span>}
              {a.resolved_in && <span className="xsmall muted">{fmt(b.resolvedIn, { n: a.resolved_in })}</span>}
            </div>
            <div className="form-grid cols-3">
              {field(b.name, a.title, (v) => editList('arcs', i, { title: v }), { max: 160, idSuffix: `a${i}-title` })}
              {field(b.key, a.id, (v) => editList('arcs', i, { id: v.toLowerCase() }), { max: 40, idSuffix: `a${i}-key`, readOnly: savedArcs.has(a.id) })}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                {field(b.description, a.description, (v) => editList('arcs', i, { description: v }), { max: 1000, idSuffix: `a${i}-desc` })}
                {canEdit && (
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAt('arcs', i)} aria-label={`${b.remove}: ${a.title}`}>
                    <Icon name="x" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => set({ arcs: [...draft.arcs, { id: slug('', new Set(draft.arcs.map((a) => a.id)), `thread-${draft.arcs.length + 1}`), title: '', description: '', status: 'open', opened_in: null, resolved_in: null }] })}
          >
            <Icon name="plus" />
            {b.addArc}
          </button>
        )}
      </section>
    </section>
  );
}
