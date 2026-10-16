'use client';
import { FamilyGlyph } from './FamilyGlyph';
import { characterLabel, referenceLabel } from './labels';
import { Icon } from '@/components/ui/Icon';
import { parseCharacterId } from '@/lib/studio/limits';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { CharacterRecord } from '@/lib/studio/types';

export function CharacterCard({
  character,
  selected,
  onToggle,
  disabled,
  footnote,
}: {
  character: CharacterRecord;
  selected?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  footnote?: string;
}) {
  const { t } = useI18n();
  const parsed = parseCharacterId(character.id);
  if (!parsed) return null;
  const label = characterLabel(t, character.id, character.name);
  const age = character.age_group ? (t.characters.age as Record<string, string>)[character.age_group] : null;
  const body = (
    <>
      <div className="char-art">
        <FamilyGlyph family={parsed.family} variant={parsed.variant} size={76} />
      </div>
      <div className="char-name">
        <b>{label}</b>
        <span>
          {t.characters.familyKind[parsed.family]}
          {age ? ` · ${age}` : ''}
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className={`badge ${character.reference_status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{referenceLabel(t, character.reference_status)}</span>
        {footnote && <span className="xsmall muted">{footnote}</span>}
      </div>
      {onToggle && (
        <span className="char-check" aria-hidden="true">
          <Icon name="check" size={13} />
        </span>
      )}
    </>
  );
  if (!onToggle) {
    return (
      <article className="char-card" data-family={parsed.family}>
        {body}
      </article>
    );
  }
  return (
    <button
      type="button"
      className="char-card"
      data-family={parsed.family}
      aria-pressed={Boolean(selected)}
      aria-label={fmt(selected ? t.studio.cast.remove : t.studio.cast.add, { name: label })}
      onClick={onToggle}
      disabled={disabled}
    >
      {body}
    </button>
  );
}
