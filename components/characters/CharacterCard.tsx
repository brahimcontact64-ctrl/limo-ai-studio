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
  onPreview,
  disabled,
  footnote,
}: {
  character: CharacterRecord;
  selected?: boolean;
  onToggle?: () => void;
  /** Shows a "Details" button next to the card (spec, references, review). */
  onPreview?: () => void;
  disabled?: boolean;
  footnote?: string;
}) {
  const { t } = useI18n();
  const parsed = parseCharacterId(character.id);
  const label = characterLabel(t, character.id, character.name);
  const age = character.age_group ? (t.characters.age as Record<string, string>)[character.age_group] : null;
  const kind = parsed
    ? t.characters.familyKind[parsed.family]
    : character.base_family && character.base_family in t.characters.familyKind
      ? t.characters.familyKind[character.base_family as keyof typeof t.characters.familyKind]
      : t.characters.custom.title;
  const family = parsed?.family ?? 'custom';
  const body = (
    <>
      <div className="char-art">
        {parsed ? (
          <FamilyGlyph family={parsed.family} variant={parsed.variant} size={76} />
        ) : (
          <span className="char-initials" aria-hidden="true">
            {character.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="char-name">
        <b dir="auto">{label}</b>
        <span>
          {kind}
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
  const card = !onToggle ? (
    <article className="char-card" data-family={family}>
      {body}
    </article>
  ) : (
    <button
      type="button"
      className="char-card"
      data-family={family}
      aria-pressed={Boolean(selected)}
      aria-label={fmt(selected ? t.studio.cast.remove : t.studio.cast.add, { name: label })}
      onClick={onToggle}
      disabled={disabled}
    >
      {body}
    </button>
  );
  if (!onPreview) return card;
  return (
    <div className="char-card-wrap">
      {card}
      <button type="button" className="btn btn-ghost btn-sm char-details" onClick={onPreview} aria-label={`${t.characters.preview.details}: ${label}`}>
        <Icon name="info" />
        {t.characters.preview.details}
      </button>
    </div>
  );
}
