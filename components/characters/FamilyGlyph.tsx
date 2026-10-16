import type { CharacterFamily, CharacterVariant } from '@/lib/studio/limits';

/**
 * Family marker illustration. Intentionally simple: it identifies the family and
 * age group in the UI and is NOT a canonical character reference for generation.
 */
const FAMILY_FILL: Record<CharacterFamily, { body: string; shade: string }> = {
  limo: { body: 'var(--tomato)', shade: '#c9432a' },
  nova: { body: 'var(--strawberry)', shade: '#c83a62' },
  adam: { body: 'var(--potato)', shade: '#b48a43' },
};

function Body({ family }: { family: CharacterFamily }) {
  const { body, shade } = FAMILY_FILL[family];
  if (family === 'limo') {
    return (
      <g>
        <ellipse cx="50" cy="58" rx="30" ry="27" fill={body} />
        <path d="M27 66c6 12 20 18 34 15" stroke={shade} strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.5" />
        <path d="M50 33l5-8 2 9 9-3-6 7 9 3-10 2-9-1-9 1-10-2 9-3-6-7 9 3 2-9z" fill="var(--leaf)" />
      </g>
    );
  }
  if (family === 'nova') {
    return (
      <g>
        <path d="M50 88C34 80 20 64 21 49c1-11 12-17 29-17s28 6 29 17c1 15-13 31-29 39z" fill={body} />
        {[
          [36, 48],
          [50, 45],
          [64, 48],
          [42, 60],
          [58, 60],
          [50, 72],
        ].map(([x, y]) => (
          <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="1.6" ry="2.4" fill="#ffd9a8" opacity="0.85" />
        ))}
        <path d="M50 34l-12-6 6 9-11 1 11 4h12l11-4-11-1 6-9z" fill="var(--leaf)" />
      </g>
    );
  }
  return (
    <g>
      <path d="M24 56c-2-16 10-26 27-26 17 0 28 9 27 25-1 18-13 31-28 31S26 72 24 56z" fill={body} />
      {[
        [36, 46],
        [64, 54],
        [44, 74],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill={shade} />
      ))}
      <path d="M50 31c-1-6 2-10 7-11-1 5-3 8-7 11zM50 31c-2-4-6-6-10-5 2 4 5 5 10 5z" fill="var(--leaf)" />
    </g>
  );
}

export function FamilyGlyph({
  family,
  variant,
  size = 64,
  title,
}: {
  family: CharacterFamily;
  variant?: CharacterVariant;
  size?: number;
  title?: string;
}) {
  const child = variant === 'boy' || variant === 'girl';
  const elder = variant === 'elder_man' || variant === 'elder_woman';
  const scale = child ? 0.8 : 1;
  const offset = child ? 14 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g transform={`translate(${50 - 50 * scale} ${offset + 50 - 50 * scale}) scale(${scale})`}>
        <Body family={family} />
        {/* Face */}
        <circle cx="42" cy="58" r="3.2" fill="#1a1410" />
        <circle cx="58" cy="58" r="3.2" fill="#1a1410" />
        <circle cx="43" cy="57" r="1" fill="#fff" />
        <circle cx="59" cy="57" r="1" fill="#fff" />
        <path d="M44 67q6 5 12 0" stroke="#1a1410" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        {elder && (
          <g stroke="#1a1410" strokeWidth="1.8" fill="none" opacity="0.85">
            <circle cx="42" cy="58" r="6" />
            <circle cx="58" cy="58" r="6" />
            <path d="M48 58h4" />
          </g>
        )}
      </g>
    </svg>
  );
}
