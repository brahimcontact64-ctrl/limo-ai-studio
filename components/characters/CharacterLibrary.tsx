'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { CHARACTER_FAMILIES, LIMITS, parseCharacterId, type CharacterFamily } from '@/lib/studio/limits';
import type { CharacterRecord } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { CharacterCard } from './CharacterCard';
import { CharacterPreview } from './CharacterPreview';
import { characterLabel } from './labels';

type AgeFilter = 'all' | 'child' | 'adult' | 'elder';

export function CharacterLibrary({ characters, canCreate }: { characters: CharacterRecord[]; canCreate: boolean }) {
  const { t } = useI18n();
  const [family, setFamily] = useState<'all' | CharacterFamily>('all');
  const [age, setAge] = useState<AgeFilter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<CharacterRecord | null>(null);

  const filtered = useMemo(
    () =>
      characters.filter((c) => {
        const p = parseCharacterId(c.id);
        if (!p) return false;
        if (family !== 'all' && p.family !== family) return false;
        if (age !== 'all' && c.age_group !== age) return false;
        return true;
      }),
    [characters, family, age],
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < LIMITS.castMax ? [...s, id] : s));

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label={t.characters.filterFamily}>
          {(['all', ...CHARACTER_FAMILIES] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={family === f} onClick={() => setFamily(f)}>
              {f === 'all' ? t.common.all : t.characters.family[f]}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label={t.characters.filterAge}>
          {(['all', 'child', 'adult', 'elder'] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={age === a} onClick={() => setAge(a)}>
              {a === 'all' ? t.common.all : t.characters.age[a]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {canCreate && (
          <Link
            className={`btn ${selected.length ? 'btn-primary' : ''}`}
            href={selected.length ? `/app/projects/new?cast=${selected.join(',')}` : '/app/projects/new'}
            aria-disabled={selected.length === 0}
          >
            <Icon name="plus" />
            {t.characters.useInProject}
            {selected.length > 0 && <span className="mono ltr">({selected.length})</span>}
          </Link>
        )}
      </div>

      <div className="char-grid">
        {filtered.map((c) => (
          <CharacterCard key={c.id} character={c} selected={selected.includes(c.id)} onToggle={canCreate ? () => toggle(c.id) : undefined} onPreview={() => setPreview(c)} />
        ))}
      </div>

      <section className="panel" aria-labelledby="specs-h">
        <div className="panel-head">
          <h2 id="specs-h">{t.characters.appearance}</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.characters.id}</th>
                <th scope="col">{t.characters.title}</th>
                <th scope="col">{t.characters.personality}</th>
                <th scope="col">{t.characters.appearance}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="mono xsmall ltr">{c.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{characterLabel(t, c.id, c.name)}</td>
                  <td className="small muted" lang="en">
                    {c.tone}
                  </td>
                  <td className="small muted" lang="en" style={{ minWidth: 280 }}>
                    {c.visual_description ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected.length >= LIMITS.castMax && <p className="small muted">{fmt(t.studio.cast.limitReached, {})}</p>}
      {preview && <CharacterPreview open characterId={preview.id} label={characterLabel(t, preview.id, preview.name)} onClose={() => setPreview(null)} />}
    </div>
  );
}
