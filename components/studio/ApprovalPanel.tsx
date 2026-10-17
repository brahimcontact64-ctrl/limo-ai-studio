'use client';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { ScriptApproval } from '@/lib/data/projects';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/ui/RelativeTime';

export function ApprovalPanel({
  script,
  editable,
  blocker,
  busy,
  onApprove,
  onRemove,
}: {
  script: ScriptApproval;
  editable: boolean;
  /** Why approving is not possible right now (unsaved changes, validation errors). */
  blocker: string | null;
  busy: boolean;
  onApprove: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const a = t.studio.approval;
  const tone = script.status === 'approved' ? 'badge-success' : script.status === 'changed' ? 'badge-warning' : '';
  return (
    <section className="panel panel-pad stack approval-panel" aria-labelledby="approval-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 id="approval-h" className="section-title">
          <Icon name="check" /> {a.title}
        </h3>
        <span className={`badge ${tone}`} data-testid="script-status">
          {a.status[script.status]}
        </span>
      </div>
      <p className="small muted">{a.lead}</p>
      {!script.available ? (
        <p className="callout small">{a.unavailable}</p>
      ) : script.status === 'approved' ? (
        <div className="row">
          <span className="small">
            {script.approved_revision_number !== null && fmt(a.approvedAs, { n: script.approved_revision_number })}
            {script.approved_at && (
              <>
                {' · '}
                <RelativeTime iso={script.approved_at} />
              </>
            )}
          </span>
          {editable && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove} disabled={busy}>
              {a.remove}
            </button>
          )}
        </div>
      ) : (
        <div className="stack-sm">
          {script.status === 'changed' && <p className="callout callout-warning small">{t.studio.script.changed}</p>}
          {blocker && <p className="small muted">{blocker}</p>}
          {editable && (
            <div>
              <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy || Boolean(blocker)}>
                <Icon name="check" />
                {a.approve}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
