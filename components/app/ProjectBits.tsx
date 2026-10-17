import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { parseCharacterId } from '@/lib/studio/limits';
import type { ProjectStatus } from '@/lib/studio/types';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

const STATUS_TONE: Record<ProjectStatus, string> = {
  draft: '',
  ready: 'badge-info',
  queued: 'badge-warning',
  generating: 'badge-warning',
  generated: 'badge-accent',
  approved: 'badge-success',
  archived: '',
};

export function StatusBadge({ status, t }: { status: ProjectStatus; t: Dictionary }) {
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{t.projects.status[status] ?? status}</span>;
}

export function CastStack({ ids, max = 5, size = 24 }: { ids: string[]; max?: number; size?: number }) {
  const shown = ids.slice(0, max);
  return (
    <span className="cast-stack" aria-hidden="true">
      {shown.map((id) => {
        const p = parseCharacterId(id);
        // Workspace characters ("custom:<uuid>") have no family illustration: a neutral dot keeps the count visible.
        return p ? <FamilyGlyph key={id} family={p.family} variant={p.variant} size={size} /> : <span key={id} className="cast-custom-dot" style={{ width: size, height: size }} />;
      })}
      {ids.length > max && (
        <span className="mono xsmall" style={{ display: 'grid', placeItems: 'center', width: size, height: size, color: 'var(--text-2)' }}>
          +{ids.length - max}
        </span>
      )}
    </span>
  );
}

export function Meter({ label, used, total, hint }: { label: string; used: number; total: number; hint: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono ltr">
          {used}/{total}
        </span>
      </div>
      <div className="meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-valuetext={hint}>
        <div className={`meter-fill${pct >= 85 ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
