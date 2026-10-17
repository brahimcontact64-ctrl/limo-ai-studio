'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { SlotState } from '@/lib/characters/references';
import type { CharacterRecord } from '@/lib/studio/types';
import { characterLabel, referenceLabel } from '@/components/characters/labels';
import { CharacterPreview } from '@/components/characters/CharacterPreview';

export interface AdminCharacterRow {
  character: CharacterRecord;
  slots: Array<{ view: 'front' | 'side' | 'three_quarter' | 'back'; state: SlotState; required: boolean }>;
  pending: number;
}

export function AdminCharacters({ rows }: { rows: AdminCharacterRow[] }) {
  const { t } = useI18n();
  const a = t.adminChars;
  const p = t.characters.preview;
  const router = useRouter();
  const [open, setOpen] = useState<CharacterRecord | null>(null);
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{a.character}</th>
              <th scope="col">{a.spec}</th>
              <th scope="col">{a.views}</th>
              <th scope="col">{a.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = characterLabel(t, r.character.id, r.character.name);
              return (
                <tr key={r.character.id} data-testid={`admin-char-${r.character.id}`}>
                  <td>
                    <b>{label}</b>
                    <div className="xsmall muted mono ltr">{r.character.id}</div>
                    <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(r.character)} aria-label={`${a.open}: ${label}`}>
                      {a.open}
                      {r.pending > 0 && <span className="badge badge-warning ltr">{r.pending}</span>}
                    </button>
                  </td>
                  <td className="small">
                    {r.character.spec_version ? fmt(p.specVersion, { n: r.character.spec_version }) : '—'}
                    <div className="xsmall muted">{r.character.spec_status ? ((p.specStatus as Record<string, string>)[r.character.spec_status] ?? r.character.spec_status) : ''}</div>
                  </td>
                  <td>
                    <ul className="slot-dots">
                      {r.slots.map((s) => (
                        <li key={s.view} className={s.state} title={`${p.views[s.view]}: ${p.slot[s.state]}`}>
                          <span className="xsmall">{p.views[s.view]}</span>
                          <span className="sr-only">{p.slot[s.state]}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <span className={`badge ${r.character.reference_status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{referenceLabel(t, r.character.reference_status)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <CharacterPreview open characterId={open.id} label={characterLabel(t, open.id, open.name)} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </section>
  );
}
