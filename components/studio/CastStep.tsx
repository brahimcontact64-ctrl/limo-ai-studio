'use client';
import Link from 'next/link';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { CHARACTER_FAMILIES, LIMITS, parseCharacterId } from '@/lib/studio/limits';
import { removeFromCast } from '@/lib/studio/draft';
import type { Issue } from '@/lib/studio/validation';
import type { CharacterRecord, ProjectDraft } from '@/lib/studio/types';
import { CharacterCard } from '@/components/characters/CharacterCard';
import { CharacterPreview } from '@/components/characters/CharacterPreview';
import { characterLabel } from '@/components/characters/labels';
import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { Icon } from '@/components/ui/Icon';
import { requiresCharacters } from '@/lib/create/modes';
import { StepHeader, issueMessage } from './fields';

export function CastStep({
  draft,
  setDraft,
  characters,
  issues,
}: {
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  characters: CharacterRecord[];
  issues: Issue[];
}) {
  const { t } = useI18n();
  const byFamily = useMemo(() => {
    const map = new Map<string, CharacterRecord[]>();
    for (const c of characters) {
      const fam = parseCharacterId(c.id)?.family;
      if (!fam) continue;
      map.set(fam, [...(map.get(fam) ?? []), c]);
    }
    return map;
  }, [characters]);
  const custom = useMemo(() => characters.filter((c) => c.custom), [characters]);
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name;
  const [preview, setPreview] = useState<CharacterRecord | null>(null);
  const sceneCount = (id: string) => draft.scenes.filter((s) => s.participants.includes(id)).length;
  const full = draft.cast.length >= LIMITS.castMax;
  const castIssue = issues.find((i) => i.field === 'cast' && i.severity === 'error');

  const toggle = (id: string) => {
    if (draft.cast.includes(id)) {
      const n = sceneCount(id);
      if (n > 0 && !window.confirm(fmt(t.studio.cast.removeWarning, { name: characterLabel(t, id, nameOf(id)), n }))) return;
      setDraft((d) => removeFromCast(d, id));
    } else if (!full) {
      setDraft((d) => ({ ...d, cast: [...d.cast, id] }));
    }
  };

  return (
    <div className="studio-step">
      <StepHeader
        title={t.studio.cast.title}
        lead={t.studio.cast.lead}
        aside={
          <div className="row">
            <span className="badge badge-accent plain mono ltr" aria-live="polite">
              {fmt(t.studio.cast.selected, { n: draft.cast.length, max: LIMITS.castMax })}
            </span>
            {draft.cast.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const used = draft.cast.some((id) => sceneCount(id) > 0);
                  if (used && !window.confirm(t.studio.cast.clearConfirm)) return;
                  setDraft((d) => ({ ...d, cast: [], scenes: d.scenes.map((s) => ({ ...s, participants: [] })) }));
                }}
              >
                {t.studio.cast.clear}
              </button>
            )}
          </div>
        }
      />
      {!requiresCharacters(draft.creation_mode) && (
        <p className="callout" style={{ marginBottom: 16 }}>
          {t.studio.cast.optional}
        </p>
      )}
      {castIssue && (
        <p className="field-error" role="alert" style={{ marginBottom: 16 }}>
          {issueMessage(t, castIssue)}
        </p>
      )}
      {full && <p className="callout" style={{ marginBottom: 16 }}>{t.studio.cast.limitReached}</p>}

      {draft.cast.length > 0 && (
        <div className="cast-tray" aria-label={t.studio.cast.title}>
          {draft.cast.map((id) => {
            const p = parseCharacterId(id);
            return (
              <button key={id} type="button" className="cast-chip" onClick={() => toggle(id)} aria-label={fmt(t.studio.cast.remove, { name: characterLabel(t, id, nameOf(id)) })}>
                {p && <FamilyGlyph family={p.family} variant={p.variant} size={22} />}
                <span dir="auto">{characterLabel(t, id, nameOf(id))}</span>
                {sceneCount(id) > 0 && <span className="mono xsmall muted ltr">×{sceneCount(id)}</span>}
                <Icon name="x" size={12} />
              </button>
            );
          })}
        </div>
      )}

      {CHARACTER_FAMILIES.map((family) => {
        const list = byFamily.get(family) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={family} aria-labelledby={`cast-${family}`}>
            <div className="family-head">
              <span className={`family-dot ${family}`} aria-hidden="true" />
              <h3 id={`cast-${family}`}>{t.characters.family[family]}</h3>
              <span className="xsmall muted">{t.characters.familyKind[family]}</span>
            </div>
            <div className="char-grid">
              {list.map((c) => {
                const selected = draft.cast.includes(c.id);
                const n = sceneCount(c.id);
                return (
                  <CharacterCard
                    key={c.id}
                    character={c}
                    selected={selected}
                    disabled={!selected && full}
                    onToggle={() => toggle(c.id)}
                    onPreview={() => setPreview(c)}
                    footnote={selected && n > 0 ? fmt(t.studio.cast.inScenes, { n }) : undefined}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <section aria-labelledby="cast-custom">
        <div className="family-head">
          <span className="family-dot custom" aria-hidden="true" />
          <h3 id="cast-custom">{t.studio.cast.yourCharacters}</h3>
          <Link className="xsmall" href="/app/characters?tab=custom">
            {t.characters.custom.create}
          </Link>
        </div>
        {custom.length === 0 ? (
          <p className="small muted">{t.characters.custom.empty}</p>
        ) : (
          <div className="char-grid">
            {custom.map((c) => {
              const selected = draft.cast.includes(c.id);
              const n = sceneCount(c.id);
              return (
                <CharacterCard
                  key={c.id}
                  character={c}
                  selected={selected}
                  disabled={!selected && full}
                  onToggle={() => toggle(c.id)}
                  onPreview={() => setPreview(c)}
                  footnote={selected && n > 0 ? fmt(t.studio.cast.inScenes, { n }) : undefined}
                />
              );
            })}
          </div>
        )}
      </section>
      {preview && <CharacterPreview open characterId={preview.id} label={characterLabel(t, preview.id, preview.name)} onClose={() => setPreview(null)} />}
      <p className="xsmall muted" style={{ marginTop: 24 }}>
        {t.characters.illustrationNote}
      </p>
    </div>
  );
}
