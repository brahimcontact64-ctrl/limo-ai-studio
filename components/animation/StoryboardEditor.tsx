'use client';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { EXPRESSION_KEYS, type ExpressionKey } from '@/lib/characters/canon';
import { nextAction, type ProjectRow, type ShotRow, type TimelineItem } from '@/lib/animation/storyboard';

interface Issue { level?: 'error' | 'warning'; code: string; scene?: number; shot?: number; detail: string }
interface Data {
  project: ProjectRow;
  shots: ShotRow[];
  jobs: Array<{ id: string; kind: string; shot_id: string | null; status: string; error_code: string | null; output: Record<string, unknown> }>;
  events: Array<{ shot_id: string; event: string; stage: string | null; note: string | null; created_at: string }>;
  readiness: { flags: Record<string, boolean>; characters: Record<string, { gaps: string[]; voice: { provider: string; voice_ref: string } | null }> };
  assets: Record<string, { url: string | null; mime: string; label: string; mock: boolean; ai: boolean }>;
  references: Array<{ id: string; character: string; view: string | null; url: string | null }>;
  can_edit: boolean;
  characters: { canonical: string[]; custom: Array<{ id: string; name: string }> };
  planning: { issues: Issue[]; continuity: Issue[]; blockers: string[]; timeline: TimelineItem[]; cost: { per_take_usd: number; expected_usd: number; seconds: number } | null };
}
type Draft = Partial<ShotRow> & { key: string; duration_seconds: 4 | 6 | 8 };

const MAX_SECONDS = 30;
const usd = (n: number) => `$${n.toFixed(2)}`;
const newKey = () => Math.random().toString(36).slice(2);
const emptyShot = (): Draft => ({ key: newKey(), duration_seconds: 8, description: '', environment: '', camera: '', characters: [], actions: {}, expressions: {}, dialogue: [], narration: '', sound: '', continuity: {}, reference_asset_ids: [], clip_audio: 'keep' });

/**
 * Animation Studio storyboard (owner's scenario → shots → approved references → AI keyframe → AI clip → voices →
 * export). Everything is editable while no generation runs; AI requests are refused by the server while the
 * `animation_generation` flag is off, and every result needs the owner's approval. Nothing here writes a scenario.
 */
export function StoryboardEditor({ projectId, names }: { projectId: string; names: Record<string, string> }) {
  const { t } = useI18n();
  const a = t.animation;
  const id = useId();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [shots, setShots] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState<{ shot: string; stage: 'keyframe' | 'clip'; note: string } | null>(null);
  const [renders, setRenders] = useState<Array<{ id: string; status: string; total_duration_ms: number; created_at: string }>>([]);
  const err = (code?: string) => (a.errors as Record<string, string>)[code ?? ''] ?? a.errors.unavailable;

  const load = useCallback(async (keepDraft = false) => {
    const res = await fetch(`/api/animation/${projectId}`).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as Data;
    setData(d);
    if (!keepDraft) {
      setProject(d.project);
      setShots(d.shots.map((s) => ({ ...s, key: s.id })));
      setDirty(false);
    }
    const r = await fetch(`/api/animation/${projectId}/export`).catch(() => null);
    if (r?.ok) setRenders(((await r.json()) as { renders: typeof renders }).renders);
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const busyShots = data?.shots.some((s) => s.status === 'keyframe_queued' || s.status === 'clip_queued') ?? false;
  const busyRender = renders.some((r) => r.status === 'queued' || r.status === 'processing');
  useEffect(() => {
    if (!busyShots && !busyRender) return;
    const timer = window.setInterval(() => void load(dirty), 3000);
    return () => window.clearInterval(timer);
  }, [busyShots, busyRender, load, dirty]);

  const total = useMemo(() => shots.reduce((s, x) => s + x.duration_seconds, 0), [shots]);
  const allNames = useMemo(() => ({ ...names, ...Object.fromEntries((data?.characters.custom ?? []).map((c) => [c.id, c.name])) }), [names, data]);
  const nameOf = (c: string) => allNames[c] ?? c;
  if (!data || !project) return <p className="muted">{t.common.loading}</p>;
  const editable = data.can_edit;
  const flagOn = data.readiness.flags.animation_generation === true;

  const edit = (key: string, patch: Partial<Draft>) => {
    setShots((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const setP = (patch: Partial<ProjectRow>) => {
    setProject((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    setShots((list) => {
      const n = [...list];
      const j = i + d;
      if (j < 0 || j >= n.length) return list;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
    setDirty(true);
  };

  async function save() {
    if (!project) return;
    setSaving(true);
    const res = await fetch(`/api/animation/${projectId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, revision: data!.project.revision, shots: shots.map(({ key: _k, ...s }) => s) }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!res?.ok) return toast(err(body.error), 'error');
    toast(a.saved, 'success');
    await load();
  }

  async function shotAction(shotId: string, payload: Record<string, unknown>, ok?: string) {
    const res = await fetch(`/api/animation/${projectId}/shots/${shotId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string };
    if (!res?.ok) return toast(err(body.error), 'error');
    if (ok) toast(ok, 'success');
    await load();
  }
  const requestJob = (shotId: string, kind: string) => shotAction(shotId, { action: 'job', kind, idempotency_key: crypto.randomUUID().replace(/-/g, ''), confirm_cents: 0 }, a.requested);

  async function exportVideo() {
    const res = await fetch(`/api/animation/${projectId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: crypto.randomUUID().replace(/-/g, ''), resolution: 720, quality: 'standard' }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string };
    if (!res?.ok) return toast(err(body.error), 'error');
    toast(a.exportQueued, 'success');
    await load();
  }

  const issues = [...data.planning.issues.map((i) => ({ ...i, shot: i.scene })), ...data.planning.continuity];
  const saved = (s: Draft) => data.shots.find((x) => x.id === s.id);
  const asset = (assetId: string | null | undefined) => (assetId ? data.assets[assetId] : undefined);

  return (
    <div className="stack-lg" data-testid="storyboard">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <Link href="/app/animation" className="small">← {a.back}</Link>
          <input className="input" aria-label={a.titleLabel} value={project.title} maxLength={150} onChange={(e) => setP({ title: e.target.value })} disabled={!editable} dir="auto" data-testid="anim-title" />
        </div>
        <div className="page-actions">
          <span className={`badge plain${total > MAX_SECONDS ? ' badge-danger' : ''}`} data-testid="anim-total">{fmt(a.total, { s: total })}</span>
          {dirty && <span className="badge badge-warning plain">{a.unsaved}</span>}
          {editable && (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty || total > MAX_SECONDS} data-testid="anim-save">
              <Icon name="save" /> {saving ? a.saving : a.save}
            </button>
          )}
        </div>
      </div>
      {!editable && <p className="callout small">{a.readOnly}</p>}
      {total > MAX_SECONDS && <p className="callout callout-danger small" role="alert">{a.overLimit}</p>}
      {!flagOn && <p className="callout callout-warning small" data-testid="anim-flag-off"><Icon name="info" /> {a.flagOff}</p>}

      <section className="panel panel-pad stack-sm" aria-labelledby={`${id}-set`}>
        <h2 id={`${id}-set`} className="section-title">{a.settings}</h2>
        <div className="form-grid cols-3">
          <label className="field"><span className="field-label xsmall">{a.language}</span>
            <select className="select select-sm" value={project.language_code} onChange={(e) => setP({ language_code: e.target.value as ProjectRow['language_code'] })} disabled={!editable}>
              {['fr', 'ar', 'en', 'de'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select></label>
          <label className="field"><span className="field-label xsmall">{a.aspect}</span>
            <select className="select select-sm" value={project.aspect} onChange={(e) => setP({ aspect: e.target.value as ProjectRow['aspect'] })} disabled={!editable}>
              <option value="9:16">{a.aspects['9:16']}</option><option value="16:9">{a.aspects['16:9']}</option>
            </select></label>
          <label className="field"><span className="field-label xsmall">{a.tier}</span>
            <select className="select select-sm" value={project.settings.tier ?? 'fast'} onChange={(e) => setP({ settings: { ...project.settings, tier: e.target.value as 'fast' | 'standard' } })} disabled={!editable}>
              <option value="fast">{a.tiers.fast}</option><option value="standard">{a.tiers.standard}</option>
            </select></label>
          <label className="field"><span className="field-label xsmall">{a.resolution}</span>
            <select className="select select-sm" value={project.settings.resolution ?? '720p'} onChange={(e) => setP({ settings: { ...project.settings, resolution: e.target.value as '720p' | '1080p' } })} disabled={!editable}>
              <option value="720p">720p</option><option value="1080p">1080p</option>
            </select></label>
          <label className="field"><span className="field-label xsmall">{a.voiceMode}</span>
            <select className="select select-sm" value={project.settings.voice_mode ?? 'separate'} onChange={(e) => setP({ settings: { ...project.settings, voice_mode: e.target.value as 'native' | 'separate' } })} disabled={!editable}>
              <option value="separate">{a.voiceModes.separate}</option><option value="native">{a.voiceModes.native}</option>
            </select></label>
          <label className="field"><span className="field-label xsmall">{a.takes}</span>
            <input className="input input-sm" type="number" min={1} max={5} value={project.settings.takes ?? 2} onChange={(e) => setP({ settings: { ...project.settings, takes: Number(e.target.value) } })} disabled={!editable} /></label>
        </div>
        <label className="checkbox"><input type="checkbox" checked={project.settings.lip_sync === true} onChange={(e) => setP({ settings: { ...project.settings, lip_sync: e.target.checked } })} disabled={!editable} /><span>{a.lipSync}</span></label>
        <label className="field"><span className="field-label xsmall">{a.music}</span>
          <input className="input input-sm" value={project.music_note} maxLength={500} onChange={(e) => setP({ music_note: e.target.value })} disabled={!editable} dir="auto" /></label>
      </section>

      <section className="panel panel-pad stack-sm" aria-labelledby={`${id}-plan`} data-testid="anim-planning">
        <h2 id={`${id}-plan`} className="section-title">{a.planning}</h2>
        {data.planning.cost && <p className="small">{fmt(a.estimate, { take: usd(data.planning.cost.per_take_usd), total: usd(data.planning.cost.expected_usd), n: project.settings.takes ?? 2 })}</p>}
        <b className="small">{a.issues}</b>
        {issues.length === 0 ? <p className="xsmall muted">{a.noIssues}</p> : (
          <ul className="xsmall" data-testid="anim-issues">
            {issues.map((i, n) => <li key={n} className={i.level === 'error' ? 'text-danger' : ''}>{i.shot ? `${fmt(a.shot, { n: i.shot })} · ` : ''}{i.detail}</li>)}
          </ul>
        )}
        {data.planning.blockers.length > 0 && (
          <>
            <b className="small">{a.blockers}</b>
            <ul className="xsmall" data-testid="anim-blockers">{data.planning.blockers.map((b) => <li key={b}>{b.replace(/^([^:]+):/, (_m, c: string) => `${nameOf(c)}:`)}</li>)}</ul>
          </>
        )}
        {data.planning.timeline.length > 0 && (
          <details>
            <summary className="small">{a.timeline}</summary>
            <ol className="xsmall" data-testid="anim-timeline">
              {data.planning.timeline.map((x, n) => (
                <li key={n} dir="auto">{(x.start_ms / 1000).toFixed(1)}–{(x.end_ms / 1000).toFixed(1)} s · {x.speaker ? nameOf(x.speaker) : a.narrator}: {x.text} <span className="muted">({x.measured ? a.measured : a.planned})</span></li>
              ))}
            </ol>
          </details>
        )}
      </section>

      <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {shots.map((s, i) => {
          const live = saved(s);
          const chars = s.characters ?? [];
          const refs = data.references.filter((r) => chars.includes(r.character));
          const action = live && !dirty ? nextAction(live) : null;
          const kf = asset(live?.keyframe_asset_id);
          const clip = asset(live?.clip_asset_id);
          const clipJob = data.jobs.find((j) => j.shot_id === live?.id && j.kind === 'animation_clip' && j.status === 'completed');
          const history = data.events.filter((e) => e.shot_id === live?.id).slice(0, 6);
          const next = shots[i + 1] ? saved(shots[i + 1]!) : undefined;
          return (
            <li key={s.key} className="panel panel-pad stack-sm" data-testid={`shot-${i + 1}`}>
              <div className="row">
                <h3 className="section-title" style={{ margin: 0 }}>{fmt(a.shot, { n: i + 1 })}</h3>
                <select className="select select-sm" aria-label={a.duration} value={s.duration_seconds} onChange={(e) => edit(s.key, { duration_seconds: Number(e.target.value) as 4 | 6 | 8 })} disabled={!editable}>
                  {[4, 6, 8].map((d) => <option key={d} value={d}>{fmt(a.seconds, { n: d })}</option>)}
                </select>
                {live && <span className="badge plain" data-testid="shot-status">{a.status[live.status]}</span>}
                {editable && (
                  <span className="row" style={{ marginInlineStart: 'auto' }}>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={a.moveUp} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={a.moveDown} onClick={() => move(i, 1)} disabled={i === shots.length - 1}>↓</button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={a.removeShot} onClick={() => (setShots((l) => l.filter((x) => x.key !== s.key)), setDirty(true))}><Icon name="trash" size={14} /></button>
                  </span>
                )}
              </div>
              <div className="form-grid cols-2">
                <label className="field"><span className="field-label xsmall">{a.description}</span>
                  <textarea className="textarea" rows={2} maxLength={2000} value={s.description ?? ''} onChange={(e) => edit(s.key, { description: e.target.value })} disabled={!editable} dir="auto" data-testid="shot-description" /></label>
                <label className="field"><span className="field-label xsmall">{a.environment}</span>
                  <textarea className="textarea" rows={2} maxLength={1000} value={s.environment ?? ''} onChange={(e) => edit(s.key, { environment: e.target.value })} disabled={!editable} dir="auto" data-testid="shot-environment" /></label>
              </div>
              <label className="field"><span className="field-label xsmall">{a.camera}</span>
                <input className="input input-sm" maxLength={500} value={s.camera ?? ''} onChange={(e) => edit(s.key, { camera: e.target.value })} disabled={!editable} dir="auto" /></label>

              <div className="stack-sm">
                <b className="small">{a.characters}</b>
                {chars.length === 0 && <span className="xsmall muted">{a.noCharacters}</span>}
                {chars.map((c) => (
                  <div key={c} className="form-grid cols-3" data-testid={`shot-char-${c}`}>
                    <span className="row small"><b>{nameOf(c)}</b>
                      {editable && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${a.removeShot}: ${nameOf(c)}`} onClick={() => edit(s.key, { characters: chars.filter((x) => x !== c), dialogue: (s.dialogue ?? []).filter((d) => d.speaker !== c), reference_asset_ids: (s.reference_asset_ids ?? []).filter((r) => data.references.find((x) => x.id === r)?.character !== c) })}><Icon name="x" size={12} /></button>}
                    </span>
                    <label className="field"><span className="field-label xsmall">{fmt(a.action, { name: nameOf(c) })}</span>
                      <input className="input input-sm" maxLength={300} value={s.actions?.[c] ?? ''} onChange={(e) => edit(s.key, { actions: { ...(s.actions ?? {}), [c]: e.target.value } })} disabled={!editable} dir="auto" /></label>
                    <label className="field"><span className="field-label xsmall">{fmt(a.expression, { name: nameOf(c) })}</span>
                      <select className="select select-sm" value={s.expressions?.[c] ?? ''} onChange={(e) => { const x = { ...(s.expressions ?? {}) }; if (e.target.value) x[c] = e.target.value as ExpressionKey; else delete x[c]; edit(s.key, { expressions: x }); }} disabled={!editable}>
                        <option value="">{a.none}</option>
                        {EXPRESSION_KEYS.map((k) => <option key={k} value={k}>{a.expressions[k]}</option>)}
                      </select></label>
                  </div>
                ))}
                {editable && chars.length < 5 && (
                  <select className="select select-sm" aria-label={a.addCharacter} value="" onChange={(e) => e.target.value && edit(s.key, { characters: [...chars, e.target.value] })} data-testid="shot-add-character">
                    <option value="">{a.addCharacter}</option>
                    {[...data.characters.canonical, ...data.characters.custom.map((c) => c.id)].filter((c) => !chars.includes(c)).map((c) => <option key={c} value={c}>{nameOf(c)}</option>)}
                  </select>
                )}
              </div>

              <div className="stack-sm">
                <b className="small">{a.dialogue}</b>
                {(s.dialogue ?? []).map((d, n) => (
                  <div key={n} className="row" data-testid="shot-line">
                    <select className="select select-sm" aria-label={a.speaker} value={d.speaker} onChange={(e) => edit(s.key, { dialogue: (s.dialogue ?? []).map((x, k) => (k === n ? { ...x, speaker: e.target.value } : x)) })} disabled={!editable}>
                      {chars.map((c) => <option key={c} value={c}>{nameOf(c)}</option>)}
                    </select>
                    <input className="input input-sm" style={{ flex: 1, minWidth: 0 }} aria-label={a.line} maxLength={400} value={d.text} onChange={(e) => edit(s.key, { dialogue: (s.dialogue ?? []).map((x, k) => (k === n ? { ...x, text: e.target.value } : x)) })} disabled={!editable} dir="auto" />
                    <select className="select select-sm" aria-label={a.emotion} value={d.emotion ?? ''} onChange={(e) => edit(s.key, { dialogue: (s.dialogue ?? []).map((x, k) => (k === n ? { ...x, emotion: (e.target.value || undefined) as ExpressionKey | undefined } : x)) })} disabled={!editable}>
                      <option value="">{a.none}</option>
                      {EXPRESSION_KEYS.map((k) => <option key={k} value={k}>{a.expressions[k]}</option>)}
                    </select>
                    {editable && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={a.removeLine} onClick={() => edit(s.key, { dialogue: (s.dialogue ?? []).filter((_x, k) => k !== n) })}><Icon name="x" size={12} /></button>}
                  </div>
                ))}
                {editable && chars.length > 0 && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(s.key, { dialogue: [...(s.dialogue ?? []), { speaker: chars[0]!, text: '' }] })}><Icon name="plus" /> {a.addLine}</button></div>}
                <div className="form-grid cols-2">
                  <label className="field"><span className="field-label xsmall">{a.narration}</span>
                    <input className="input input-sm" maxLength={1000} value={s.narration ?? ''} onChange={(e) => edit(s.key, { narration: e.target.value })} disabled={!editable} dir="auto" /></label>
                  <label className="field"><span className="field-label xsmall">{a.sound}</span>
                    <input className="input input-sm" maxLength={500} value={s.sound ?? ''} onChange={(e) => edit(s.key, { sound: e.target.value })} disabled={!editable} dir="auto" /></label>
                </div>
              </div>

              <details>
                <summary className="small">{a.continuity}</summary>
                <div className="stack-sm">
                  {i > 0 && <label className="checkbox"><input type="checkbox" checked={s.continuity?.continues_from_previous === true} onChange={(e) => edit(s.key, { continuity: { ...(s.continuity ?? {}), continues_from_previous: e.target.checked } })} disabled={!editable} /><span>{a.continuesPrevious}</span></label>}
                  {i > 0 && <label className="checkbox"><input type="checkbox" checked={s.continuity?.use_previous_last_frame === true} onChange={(e) => edit(s.key, { continuity: { ...(s.continuity ?? {}), use_previous_last_frame: e.target.checked } })} disabled={!editable} /><span>{a.usePreviousLastFrame}</span></label>}
                  <div className="form-grid cols-2">
                    <label className="field"><span className="field-label xsmall">{a.environmentKey}</span>
                      <input className="input input-sm" maxLength={80} value={s.continuity?.environment_key ?? ''} onChange={(e) => edit(s.key, { continuity: { ...(s.continuity ?? {}), environment_key: e.target.value } })} disabled={!editable} dir="auto" /></label>
                    <label className="field"><span className="field-label xsmall">{a.lighting}</span>
                      <input className="input input-sm" maxLength={120} value={s.continuity?.lighting ?? ''} onChange={(e) => edit(s.key, { continuity: { ...(s.continuity ?? {}), lighting: e.target.value } })} disabled={!editable} dir="auto" /></label>
                  </div>
                  <label className="checkbox"><input type="checkbox" checked={(s.clip_audio ?? 'keep') === 'keep'} onChange={(e) => edit(s.key, { clip_audio: e.target.checked ? 'keep' : 'mute' })} disabled={!editable} /><span>{a.clipAudio}</span></label>
                </div>
              </details>

              {chars.length > 0 && (
                <div className="stack-sm" data-testid="shot-references">
                  <b className="small">{a.references}</b>
                  <span className="xsmall muted">{refs.length ? a.referencesHint : a.noReferences}</span>
                  {refs.length > 0 && (
                    <div className="row">
                      {refs.map((r) => {
                        const on = (s.reference_asset_ids ?? []).includes(r.id);
                        return (
                          <label key={r.id} className="checkbox" title={`${nameOf(r.character)} · ${r.view ?? ''}`}>
                            <input type="checkbox" checked={on} disabled={!editable || (!on && (s.reference_asset_ids ?? []).length >= 5)} onChange={(e) => edit(s.key, { reference_asset_ids: e.target.checked ? [...(s.reference_asset_ids ?? []), r.id] : (s.reference_asset_ids ?? []).filter((x) => x !== r.id) })} />
                            {r.url ? <img src={r.url} alt={`${nameOf(r.character)} ${r.view ?? ''}`} width={56} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} /> : <span className="xsmall">{nameOf(r.character)} · {r.view}</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {live && (
                <div className="stack-sm" data-testid="shot-production">
                  {live.last_error && <p className="callout callout-danger xsmall">{fmt(a.lastError, { code: live.last_error })}</p>}
                  <div className="row">
                    {kf && (
                      <figure className="stack-sm" style={{ margin: 0 }}>
                        <figcaption className="xsmall"><b>{a.keyframe}</b> <span className="badge plain">{kf.mock ? a.mock : a.ai}</span></figcaption>
                        {kf.url && <img src={kf.url} alt={a.keyframe} width={120} style={{ borderRadius: 6 }} />}
                      </figure>
                    )}
                    {live.status === 'clip_review' || live.status === 'approved' ? (
                      <figure className="stack-sm" style={{ margin: 0 }}>
                        <figcaption className="xsmall"><b>{a.clip}</b> {clip && <span className="badge plain">{clip.mock ? a.mock : a.ai}</span>}</figcaption>
                        {clip?.url ? <video src={clip.url} controls width={160} /> : <span className="xsmall muted" data-testid="clip-not-animated">{clipJob?.output.animated === false ? a.notAnimated : ''}</span>}
                      </figure>
                    ) : null}
                    {live.voice_tracks.length > 0 && (
                      <div className="stack-sm">
                        <b className="xsmall">{a.voices}</b>
                        {live.voice_tracks.map((v) => <span key={v.line} className="xsmall">{nameOf(v.speaker)} · {(v.offset_ms / 1000).toFixed(1)} s {asset(v.asset_id)?.url && <audio src={asset(v.asset_id)!.url!} controls style={{ height: 28 }} />}</span>)}
                      </div>
                    )}
                  </div>
                  {editable && (
                    <div className="row">
                      {action === 'request_keyframe' && <button type="button" className="btn btn-sm" disabled={!flagOn} onClick={() => void requestJob(live.id, 'animation_keyframe')} data-testid="req-keyframe">{a.requestKeyframe}</button>}
                      {action === 'request_clip' && <button type="button" className="btn btn-sm" disabled={!flagOn} onClick={() => void requestJob(live.id, 'animation_clip')} data-testid="req-clip">{a.requestClip}</button>}
                      {(action === 'review_keyframe' || action === 'review_clip') && (
                        <>
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => void shotAction(live.id, { action: 'decide', stage: action === 'review_keyframe' ? 'keyframe' : 'clip', decision: 'approve' })} data-testid="approve">{a.approve}</button>
                          <button type="button" className="btn btn-sm" onClick={() => setRejecting({ shot: live.id, stage: action === 'review_keyframe' ? 'keyframe' : 'clip', note: '' })} data-testid="reject">{a.reject}</button>
                        </>
                      )}
                      {((live.dialogue.length > 0 || live.narration) && action !== 'wait') && <button type="button" className="btn btn-sm btn-ghost" disabled={!flagOn} onClick={() => void requestJob(live.id, 'animation_voice')} data-testid="req-voice">{a.requestVoice}</button>}
                      {action === 'request_clip' && next?.keyframe_asset_id && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void shotAction(live.id, { action: 'frames', first_frame_asset_id: live.first_frame_asset_id, last_frame_asset_id: live.last_frame_asset_id ? null : next.keyframe_asset_id })} title={a.lastFrameHint}>
                          {live.last_frame_asset_id ? a.clearLastFrame : a.useNextKeyframe}
                        </button>
                      )}
                    </div>
                  )}
                  {rejecting?.shot === live.id && (
                    <div className="row">
                      <input className="input input-sm" style={{ flex: 1 }} aria-label={a.rejectNote} placeholder={a.rejectNote} value={rejecting.note} onChange={(e) => setRejecting({ ...rejecting, note: e.target.value })} maxLength={1000} dir="auto" />
                      <button type="button" className="btn btn-sm" disabled={!rejecting.note.trim()} onClick={() => { void shotAction(live.id, { action: 'decide', stage: rejecting.stage, decision: 'reject', note: rejecting.note }); setRejecting(null); }}>{a.confirmReject}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(null)}>{a.cancel}</button>
                    </div>
                  )}
                  {history.length > 0 && (
                    <details>
                      <summary className="xsmall">{a.history}</summary>
                      <ul className="xsmall">{history.map((h, n) => <li key={n}>{new Date(h.created_at).toLocaleString()} · {(a.events as Record<string, string>)[h.event] ?? h.event}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {editable && <div><button type="button" className="btn" onClick={() => (setShots((l) => [...l, emptyShot()]), setDirty(true))} disabled={shots.length >= 15} data-testid="add-shot"><Icon name="plus" /> {a.addShot}</button></div>}

      <section className="panel panel-pad stack-sm" aria-labelledby={`${id}-exp`}>
        <h2 id={`${id}-exp`} className="section-title">{a.export}</h2>
        <p className="xsmall muted">{a.exportHint}</p>
        {editable && <div><button type="button" className="btn btn-primary btn-sm" onClick={() => void exportVideo()} disabled={dirty || data.shots.length === 0 || data.shots.some((s) => s.status !== 'approved' || !s.clip_asset_id)} data-testid="anim-export"><Icon name="download" /> {a.export}</button></div>}
        {renders.length > 0 && <ul className="xsmall" data-testid="anim-renders">{renders.map((r) => <li key={r.id}>{new Date(r.created_at).toLocaleString()} · {(a.renderStatus as Record<string, string>)[r.status] ?? r.status} · {(r.total_duration_ms / 1000).toFixed(0)} s</li>)}</ul>}
      </section>
    </div>
  );
}
