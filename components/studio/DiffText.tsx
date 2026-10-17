'use client';
import { useMemo } from 'react';
import { diffWords } from '@/lib/studio/diff';

/** Word diff: removed text struck through, added text highlighted. */
export function DiffText({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);
  if (!before && !after) return <span className="muted">—</span>;
  return (
    <span className="diff" dir="auto">
      {segments.map((s, i) =>
        s.type === 'same' ? (
          <span key={i}>{s.text}</span>
        ) : s.type === 'del' ? (
          <del key={i}>{s.text}</del>
        ) : (
          <ins key={i}>{s.text}</ins>
        ),
      )}
    </span>
  );
}
