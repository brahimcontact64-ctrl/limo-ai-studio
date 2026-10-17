'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { normalizeCheckpoint } from '@/lib/story/bible';
import type { CharacterState, EpisodeCheckpoint, ReviewReason, StoryBible } from '@/lib/story/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { issueText, postJson, storyMessage } from './api';

export interface EpisodeEditorProps {
  seriesId: string;
  episode: {
    id: string;
    episode_number: number;
    project_id: string | null;
    checkpoint: EpisodeCheckpoint;
    checkpoint_status: 'none' | 'draft' | 'approved';
    checkpoint_updated_at: string;
    approved_checkpoint: EpisodeCheckpoint | null;
    review_status: 'ok' | 'needs_review';
    review_reasons: ReviewReason[];
    script_status: string | null;
    scene_count: number;
  };
  previous: { episode_number: number; checkpoint: EpisodeCheckpoint } | null;
  bible: StoryBible;
  bibleVersion: number;
  versions: Array<{ version: number; checkpoint: EpisodeCheckpoint; created_at: string }>;
  canEdit: boolean;
}

const parseScenes = (v: string) => [...new Set(v.split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n > 0))];

export function EpisodeEditor({ seriesId, episode, previous, bible, bibleVersion, versions, canEdit }: EpisodeEditorProps) {
  const { t } = useI18n();
  const s = t.stories.episode;
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const approved = episode.checkpoint_status === 'approved';
  const editable = canEdit && !approved;
  const [cp, setCp] = useState<EpisodeCheckpoint>(approved && episode.approved_checkpoint ? episode.approved_checkpoint : episode.checkpoint);
  const [base, setBase] = useState(episode.checkpoint_updated_at);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [confirmReopen, setConfirmReopen] = useState(false);
  const nameOf = (ref: string) => bible.characters.find((c) => c.ref === ref)?.name ?? ref;
  const update = (patch: Partial<EpisodeCheckpoint>) => {
    setCp((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const setChar = (i: number, patch: Partial<CharacterState>) => update({ characters: cp.characters.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const openArcs = bible.arcs.filter((a) => a.status === 'open');
  const missingChars = bible.characters.filter((c) => !cp.characters.some((x) => x.ref === c.ref));

  async function act(body: object) {
    setBusy(true);
    const res = await postJson<{ checkpoint?: EpisodeCheckpoint; checkpoint_updated_at?: string; issues?: Array<Record<string, unknown>> }>(`/api/stories/episodes/${episode.id}`, body);
    setBusy(false);
    return res;
  }

  async function suggest() {
    const res = await act({ action: 'suggest' });
    if (!res.ok || !res.body.checkpoint) return toast(storyMessage(t, res.body), 'error');
    setCp(normalizeCheckpoint(res.body.checkpoint));
    setDirty(true);
    toast(s.suggested);
  }

  async function save() {
    const res = await act({ action: 'checkpoint', checkpoint: cp, base_updated_at: base });
    if (!res.ok || !res.body.checkpoint_updated_at) return toast(storyMessage(t, res.body), 'error');
    setBase(res.body.checkpoint_updated_at);
    setDirty(false);
    setIssues(res.body.issues ?? []);
    toast(s.saved);
    router.refresh();
  }

  async function approve() {
    const res = await act({ action: 'approve', bible_version: bibleVersion });
    if (!res.ok) {
      setIssues(res.body.issues ?? []);
      return toast(storyMessage(t, res.body), 'error');
    }
    toast(s.approved);
    router.refresh();
  }

  async function reopen() {
    setConfirmReopen(false);
    const res = await act({ action: 'reopen' });
    if (!res.ok) return toast(storyMessage(t, res.body), 'error');
    toast(s.reopened);
    router.refresh();
  }

  async function resolve() {
    const res = await act({ action: 'resolve', note: reviewNote });
    if (!res.ok) return toast(storyMessage(t, res.body), 'error');
    toast(s.review.done);
    router.refresh();
  }

  const label = (key: string, text: string) => (
    <label className="field-label" htmlFor={`${id}-${key}`}>
      {text}
    </label>
  );

  return (
    <div className="stack-lg">
      {episode.review_status === 'needs_review' && (
        <section className="callout callout-warning stack-sm" role="alert" data-testid="needs-review">
          <strong>{s.review.title}</strong>
          <span>{s.review.body}</span>
          <ul className="plain-list small">
            {episode.review_reasons.map((r, i) => (
              <li key={i} data-testid="review-reason">
                {fmt(s.review.reason, { n: r.episode_number, kind: s.review.kinds[r.kind], impact: s.review.impact[r.impact] })}
                {r.characters?.length > 0 && <span className="xsmall muted"> · {fmt(s.review.characters, { list: r.characters.map(nameOf).join(', ') })}</span>}
                {r.arcs?.length > 0 && <span className="xsmall muted"> · {fmt(s.review.arcs, { list: r.arcs.join(', ') })}</span>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="row">
              <input className="input" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder={s.review.note} aria-label={s.review.note} maxLength={500} dir="auto" />
              <button type="button" className="btn btn-sm" onClick={() => void resolve()} disabled={busy}>
                {s.review.confirm}
              </button>
            </div>
          )}
        </section>
      )}

      <div className="form-grid cols-2">
        <section className="panel panel-pad stack-sm" aria-labelledby={`${id}-start`}>
          <h2 id={`${id}-start`} className="section-title">
            {s.startingPoint}
          </h2>
          {previous ? (
            <div className="stack-sm" data-testid="starting-point">
              <span className="small">{fmt(s.startsFrom, { n: previous.episode_number })}</span>
              <p className="small" dir="auto">
                {previous.checkpoint.summary}
              </p>
              {previous.checkpoint.ending_hook && (
                <p className="small" dir="auto">
                  <b>{s.hook}:</b> {previous.checkpoint.ending_hook}
                </p>
              )}
            </div>
          ) : (
            <p className="small muted">{s.firstEpisode}</p>
          )}
        </section>
        <section className="panel panel-pad stack-sm" aria-labelledby={`${id}-script`}>
          <h2 id={`${id}-script`} className="section-title">
            {s.script}
          </h2>
          <span className={`badge ${episode.script_status === 'approved' ? 'badge-success' : 'badge-warning'}`} data-testid="episode-script-status">
            {s.scriptStatus[(episode.script_status ?? 'none') as keyof typeof s.scriptStatus] ?? s.scriptStatus.none}
          </span>
          <p className="xsmall muted">{s.scriptHint}</p>
          {episode.project_id && (
            <Link className="btn btn-sm" prefetch={false} href={`/app/projects/${episode.project_id}`}>
              {t.stories.episodes.openScript}
            </Link>
          )}
        </section>
      </div>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-end`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id={`${id}-end`} className="section-title">
              {s.ending}
            </h2>
            <p className="xsmall muted">{s.endingHint}</p>
          </div>
          {editable && (
            <button type="button" className="btn btn-sm" onClick={() => void suggest()} disabled={busy}>
              <span className="badge badge-warning plain">{t.studio.script.mockAi}</span>
              {s.suggest}
            </button>
          )}
        </div>
        {approved && <p className="callout small">{s.approvedLocked}</p>}
        <fieldset className="plain-fieldset stack" disabled={!editable}>
          <div className="form-grid cols-2">
            <div className="field span-2">
              {label('summary', s.summary)}
              <textarea id={`${id}-summary`} className="textarea" rows={3} maxLength={4000} value={cp.summary} onChange={(e) => update({ summary: e.target.value })} dir="auto" />
            </div>
            <div className="field span-2">
              {label('hook', s.hook)}
              <input id={`${id}-hook`} className="input" maxLength={1000} value={cp.ending_hook} onChange={(e) => update({ ending_hook: e.target.value })} dir="auto" />
            </div>
            <div className="field">
              {label('loc', s.location)}
              <select id={`${id}-loc`} className="select" value={cp.location_key} onChange={(e) => update({ location_key: e.target.value })}>
                <option value="">—</option>
                {bible.locations.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name || l.key}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              {label('time', s.time)}
              <input id={`${id}-time`} className="input" maxLength={120} value={cp.time_label} onChange={(e) => update({ time_label: e.target.value })} dir="auto" />
            </div>
          </div>

          <h3 className="field-label">{s.characters}</h3>
          <div className="table-wrap">
            <table className="table checkpoint-table">
              <thead>
                <tr>
                  <th scope="col">{t.stories.bible.character}</th>
                  <th scope="col">{s.present}</th>
                  <th scope="col">{s.location}</th>
                  <th scope="col">{s.emotional}</th>
                  <th scope="col">{s.physical}</th>
                  <th scope="col">{s.goal}</th>
                </tr>
              </thead>
              <tbody>
                {cp.characters.map((c, i) => (
                  <tr key={c.ref} data-testid={`state-${c.ref}`}>
                    <td dir="auto">{nameOf(c.ref)}</td>
                    <td>
                      <input type="checkbox" checked={c.present} onChange={(e) => setChar(i, { present: e.target.checked })} aria-label={`${s.present}: ${nameOf(c.ref)}`} />
                    </td>
                    <td>
                      <select className="select select-sm" value={c.location_key} onChange={(e) => setChar(i, { location_key: e.target.value })} aria-label={`${s.location}: ${nameOf(c.ref)}`}>
                        <option value="">—</option>
                        {bible.locations.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.name || l.key}
                          </option>
                        ))}
                      </select>
                    </td>
                    {(['emotional_state', 'physical_state', 'current_goal'] as const).map((k) => (
                      <td key={k}>
                        <input
                          className="input input-sm"
                          value={c[k]}
                          onChange={(e) => setChar(i, { [k]: e.target.value })}
                          aria-label={`${k === 'emotional_state' ? s.emotional : k === 'physical_state' ? s.physical : s.goal}: ${nameOf(c.ref)}`}
                          dir="auto"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && missingChars.length > 0 && (
            <div className="row">
              {missingChars.map((c) => (
                <button
                  key={c.ref}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => update({ characters: [...cp.characters, { ref: c.ref, present: false, location_key: '', emotional_state: '', physical_state: '', current_goal: '' }] })}
                >
                  <Icon name="plus" />
                  <span dir="auto">{c.name}</span>
                </button>
              ))}
            </div>
          )}

          <h3 className="field-label">{s.events}</h3>
          <p className="xsmall muted">{s.eventsHint}</p>
          <ol className="stack-sm event-list">
            {cp.events.map((ev, i) => (
              <li key={i} className="form-grid cols-3 bible-inline" data-testid="checkpoint-event">
                <div className="field span-2">
                  <label className="field-label" htmlFor={`${id}-ev${i}`}>
                    {s.eventText} {i + 1}
                  </label>
                  <input id={`${id}-ev${i}`} className="input" value={ev.text} maxLength={500} onChange={(e) => update({ events: cp.events.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} dir="auto" />
                </div>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <div className="field">
                    <label className="field-label" htmlFor={`${id}-evs${i}`}>
                      {s.scenes}
                    </label>
                    <input
                      id={`${id}-evs${i}`}
                      className="input ltr"
                      value={ev.scenes.join(', ')}
                      onChange={(e) => update({ events: cp.events.map((x, j) => (j === i ? { ...x, scenes: parseScenes(e.target.value) } : x)) })}
                    />
                  </div>
                  {editable && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update({ events: cp.events.filter((_, j) => j !== i) })} aria-label={`${s.removeEvent} ${i + 1}`}>
                      <Icon name="x" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {editable && (
            <div>
              <button type="button" className="btn btn-sm" onClick={() => update({ events: [...cp.events, { text: '', characters: [], scenes: [] }] })}>
                <Icon name="plus" />
                {s.addEvent}
              </button>
            </div>
          )}

          <h3 className="field-label">{s.threads}</h3>
          <div className="form-grid cols-2">
            {(['arcs_progressed', 'arcs_resolved'] as const).map((key) => (
              <fieldset key={key} className="plain-fieldset stack-sm">
                <legend className="small">{key === 'arcs_progressed' ? s.progressed : s.resolved}</legend>
                {openArcs.map((a) => (
                  <label key={a.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={cp[key].includes(a.id)}
                      onChange={(e) => update({ [key]: e.target.checked ? [...cp[key], a.id] : cp[key].filter((x) => x !== a.id) } as Partial<EpisodeCheckpoint>)}
                    />
                    <span className="small" dir="auto">
                      {a.title}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <fieldset className="plain-fieldset stack-sm">
            <legend className="small">{s.newThreads}</legend>
            {cp.arcs_opened.map((a, i) => (
              <div key={i} className="form-grid cols-2">
                <input className="input" value={a.title} placeholder={s.threadTitle} aria-label={`${s.threadTitle} ${i + 1}`} onChange={(e) => update({ arcs_opened: cp.arcs_opened.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} dir="auto" />
                <input
                  className="input ltr"
                  value={a.id}
                  placeholder={s.threadKey}
                  aria-label={`${s.threadKey} ${i + 1}`}
                  onChange={(e) => update({ arcs_opened: cp.arcs_opened.map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase() } : x)) })}
                />
              </div>
            ))}
            {editable && (
              <div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ arcs_opened: [...cp.arcs_opened, { id: `thread-${bible.arcs.length + cp.arcs_opened.length + 1}`, title: '', description: '' }] })}>
                  <Icon name="plus" />
                  {s.addThread}
                </button>
              </div>
            )}
          </fieldset>
        </fieldset>

        {issues.length > 0 && (
          <div className="callout callout-danger stack-sm" role="alert">
            <strong>{s.issuesTitle}</strong>
            <ul className="plain-list small">
              {issues.map((iss, i) => (
                <li key={i}>{issueText(t, iss)}</li>
              ))}
            </ul>
          </div>
        )}

        {canEdit && (
          <div className="row">
            {!approved && (
              <>
                <button type="button" className="btn" onClick={() => void save()} disabled={busy || !dirty}>
                  <Icon name="save" />
                  {s.save}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void approve()} disabled={busy || dirty || episode.checkpoint_status === 'none'}>
                  <Icon name="check" />
                  {s.approve}
                </button>
              </>
            )}
            {approved && (
              <button type="button" className="btn" onClick={() => setConfirmReopen(true)} disabled={busy}>
                {s.reopen}
              </button>
            )}
          </div>
        )}
      </section>

      {versions.length > 0 && (
        <details className="panel panel-pad">
          <summary className="section-title">
            {s.versions} <span className="mono ltr">({versions.length})</span>
          </summary>
          <ol className="plain-list small">
            {versions.map((v) => (
              <li key={v.version} className="row" style={{ gap: 8 }}>
                <span className="mono ltr">v{v.version}</span>
                <RelativeTime iso={v.created_at} />
                <span dir="auto" className="clamp-1">
                  {v.checkpoint.summary}
                </span>
                {editable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setCp(v.checkpoint);
                      setDirty(true);
                    }}
                  >
                    {s.loadVersion}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      <ConfirmDialog open={confirmReopen} title={s.reopenTitle} body={s.reopenBody} confirmLabel={s.reopen} busy={busy} onClose={() => setConfirmReopen(false)} onConfirm={() => void reopen()} />
    </div>
  );
}
