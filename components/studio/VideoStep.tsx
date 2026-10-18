'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { ProjectDraft } from '@/lib/studio/types';
import { normalizeVideoSettings } from '@/lib/video/settings';
import { QUALITIES, RESOLUTIONS, SUBTITLE_MODES, TRANSITIONS, VIDEO_ASPECTS, DEFAULT_VIDEO_SETTINGS, renderSize, type RenderStatus, type Transition, type VideoSettings } from '@/lib/video/types';
import { AssetPicker } from '@/components/assets/AssetPicker';
import type { ClientAsset } from '@/components/assets/AssetThumb';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceAssets } from './SceneAssets';
import { LIMITS } from '@/lib/studio/limits';
import { VIDEO_POLICY } from '@/lib/video/policy';
import { GenerationPanel } from './GenerationPanel';

interface Job {
  id: string;
  status: RenderStatus;
  progress: number;
  stage: string | null;
  aspect: string;
  width: number;
  height: number;
  quality: string;
  script_revision_number: number;
  total_duration_ms: number;
  notes: string[];
  error_code: string | null;
  attempt_count: number;
  cancel_requested: boolean;
  output_size_bytes: number | null;
  output_duration_ms: number | null;
  created_at: string;
}
interface VideoState {
  settings: VideoSettings;
  jobs: Job[];
  approved: boolean;
  can_edit: boolean;
  slots: { total: number; used: number } | null;
}

const ACTIVE: RenderStatus[] = ['queued', 'processing'];
const secs = (ms: number) => Math.round(ms / 100) / 10;

/** First image or video of a scene (what the renderer uses unless the user picks another one). */
function sceneVisual(ids: string[], override: string | null | undefined, library: ClientAsset[] | null): ClientAsset | null {
  const pick = override ? [override] : ids;
  for (const id of pick) {
    const a = library?.find((x) => x.id === id);
    if (a && (a.media_type === 'image' || a.media_type === 'video')) return a;
  }
  return null;
}

/**
 * Video step: the approved script becomes a real MP4. Timeline (order and durations from the script;
 * editable here only while the script is a draft), per-scene media / transition / text, output format,
 * music, subtitles and logo, a storyboard preview, then queued exports with live progress, preview,
 * download, cancel and retry. Rendering runs in the background worker, never in this page.
 */
export function VideoStep({
  projectId,
  draft,
  setDraft,
  canChange,
  approved,
  approvedRevision,
  dirty,
  onUnlock,
}: {
  projectId: string;
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  canChange: boolean;
  approved: boolean;
  approvedRevision: number | null;
  dirty: boolean;
  onUnlock: () => void;
}) {
  const { t } = useI18n();
  const v = t.video;
  const id = useId();
  const toast = useToast();
  const [state, setState] = useState<VideoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useWorkspaceAssets(true);
  const [picker, setPicker] = useState<null | { kind: 'scene'; scene: number } | { kind: 'music' }>(null);
  const [busy, setBusy] = useState(false);
  const [player, setPlayer] = useState<{ job: string; url: string } | null>(null);
  const pendingKey = useRef<string | null>(null);
  /** Once the user changed a setting, polling must not overwrite it with the stored copy. */
  const touched = useRef(false);
  const settings = state?.settings ?? DEFAULT_VIDEO_SETTINGS;
  const canEdit = state?.can_edit ?? false;

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/video`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as (VideoState & { error?: string }) | null;
    if (!res?.ok || !body || body.error) {
      setError(body?.error === 'unavailable' ? v.unavailable : t.common.errorGeneric);
      return;
    }
    setState((s) => ({ ...body, settings: s && touched.current ? s.settings : normalizeVideoSettings(body.settings) }));
  }, [projectId, t.common.errorGeneric, v.unavailable]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live progress while something renders.
  const active = state?.jobs.some((j) => ACTIVE.includes(j.status)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  // Settings are saved shortly after each change (they are presentation only, not part of the script).
  const saveTimer = useRef<number | null>(null);
  const update = (patch: Partial<VideoSettings>) => {
    if (!state || !canEdit) return;
    const next = normalizeVideoSettings({ ...state.settings, ...patch });
    touched.current = true;
    setState({ ...state, settings: next });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void fetch(`/api/projects/${projectId}/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: next }) });
    }, 600);
  };
  const sceneSetting = (n: number) => settings.scenes[String(n)] ?? {};
  const updateScene = (n: number, patch: VideoSettings['scenes'][string]) => update({ scenes: { ...settings.scenes, [String(n)]: { ...sceneSetting(n), ...patch } } });

  const scenes = draft.scenes;
  const total = scenes.reduce((a, s) => a + s.duration_seconds, 0);
  const size = renderSize(settings.aspect, settings.resolution);
  const music = settings.music_asset_id ? library?.find((a) => a.id === settings.music_asset_id) : null;
  const hasPeople = scenes.some((s) => s.participants.length > 0);
  const max = VIDEO_POLICY.maxDurationSeconds;
  const overLimit = total > max;
  // V1 policy: over 30 s nothing can be exported (the database refuses it too); the project itself stays saved.
  const exportBlocker = overLimit ? fmt(v.tooLong, { total, max }) : !approved ? v.needsApproval : dirty ? v.needsSave : !canEdit ? v.readOnly : null;

  async function startExport() {
    if (exportBlocker || busy) return;
    setBusy(true);
    setError(null);
    // One key per click: a repeated or retried request returns the same job instead of rendering twice.
    pendingKey.current ??= `ui-${crypto.randomUUID()}`;
    const res = await fetch('/api/renders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId, idempotency_key: pendingKey.current, settings }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { id?: string; error?: string; duplicate?: boolean };
    setBusy(false);
    if (!res?.ok || !body.id) {
      if (res) pendingKey.current = null;
      const msg = (v.errors as Record<string, string>)[body.error ?? ''] ?? (body.error === 'rate_limited' ? t.rateLimited : t.common.errorGeneric);
      setError(msg);
      return;
    }
    pendingKey.current = null;
    toast(body.duplicate ? v.alreadyExported : v.queued, 'success');
    await load();
  }

  async function act(job: Job, action: 'cancel' | 'retry') {
    const res = await fetch(`/api/renders/${job.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string };
    if (!res?.ok) toast((v.errors as Record<string, string>)[body.error ?? ''] ?? t.common.errorGeneric, 'error');
    await load();
  }

  async function link(job: Job, inline: boolean) {
    const res = await fetch(`/api/renders/${job.id}/download${inline ? '?inline=1' : ''}`).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { url?: string };
    if (!res?.ok || !body.url) {
      toast(t.common.errorGeneric, 'error');
      return;
    }
    if (inline) setPlayer({ job: job.id, url: body.url });
    else window.location.href = body.url;
  }

  const move = (i: number, d: number) =>
    setDraft((dr) => {
      const j = i + d;
      if (j < 0 || j >= dr.scenes.length) return dr;
      const next = [...dr.scenes];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...dr, scenes: next };
    });

  if (error && !state) return <p className="callout callout-warning">{error}</p>;
  if (!state) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <div className="video-step stack-lg" data-testid="video-step">
      <div className="callout" role="note" data-testid="video-honesty">
        <Icon name="info" />
        <div className="stack-sm">
          <span>{v.honesty}</span>
          {hasPeople && <span className="small">{v.notes.characters_not_animated}</span>}
        </div>
      </div>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-tl`}>
        <div className="row">
          <h3 id={`${id}-tl`} className="section-title">
            {v.timeline}
          </h3>
          <span className="spacer" />
          <span className={`small ltr ${overLimit ? 'text-danger' : 'muted'}`} data-testid="video-total" data-over-limit={overLimit || undefined}>
            {fmt(v.totalSeconds, { n: total, max })}
          </span>
        </div>
        {approved ? (
          <div className="callout callout-success small" data-testid="timeline-locked">
            <Icon name="lock" />
            <div className="row">
              <span>{fmt(v.lockedTimeline, { n: approvedRevision ?? '—' })}</span>
              {canEdit && (
                <button type="button" className="btn btn-sm" onClick={onUnlock}>
                  {v.editTimeline}
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="small muted">{v.draftTimeline}</p>
        )}
        <ol className="video-timeline" data-testid="video-timeline">
          {scenes.map((s, i) => {
            const n = i + 1;
            const ss = sceneSetting(n);
            const visual = sceneVisual(s.asset_ids, ss.media_asset_id, library);
            const audio = s.asset_ids.map((x) => library?.find((a) => a.id === x)).find((a) => a?.media_type === 'audio');
            return (
              <li key={s.key} className="video-scene" style={{ flexGrow: s.duration_seconds }} data-testid={`video-scene-${n}`}>
                <div className="video-thumb" data-aspect={settings.aspect}>
                  {visual?.media_type === 'image' && visual.url ? <img src={visual.url} alt="" /> : visual?.media_type === 'video' && visual.url ? <video src={`${visual.url}#t=0.1`} muted playsInline preload="metadata" /> : <span className="video-card-label">{v.textCard}</span>}
                  {(s.on_screen_text || !visual) && ss.show_text !== false && <span className="video-thumb-text" dir="auto">{s.on_screen_text || s.title}</span>}
                </div>
                <div className="stack-xs">
                  <b className="small" dir="auto">
                    {n}. {s.title || fmt(v.sceneN, { n })}
                  </b>
                  <div className="row xsmall muted">
                    {canChange ? (
                      <label className="row">
                        <span className="sr-only">{fmt(v.durationOf, { n })}</span>
                        <input
                          className="input input-sm ltr dur-input"
                          type="number"
                          min={1}
                          max={LIMITS.sceneDurationMax}
                          value={s.duration_seconds}
                          aria-label={fmt(v.durationOf, { n })}
                          onChange={(e) => {
                            const val = Math.max(LIMITS.sceneDurationMin, Math.min(LIMITS.sceneDurationMax, Math.round(Number(e.target.value) || 1)));
                            setDraft((dr) => ({ ...dr, scenes: dr.scenes.map((x, k) => (k === i ? { ...x, duration_seconds: val } : x)) }));
                          }}
                        />
                        s
                      </label>
                    ) : (
                      <span className="ltr">{s.duration_seconds} s</span>
                    )}
                    {audio && (
                      <span>
                        <Icon name="mic" size={12} /> {v.narrationAudio}
                      </span>
                    )}
                  </div>
                  {canChange && (
                    <div className="row">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={fmt(v.moveEarlier, { n })} title={fmt(v.moveEarlier, { n })}>
                        <Icon name="chevronUp" />
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === scenes.length - 1} onClick={() => move(i, 1)} aria-label={fmt(v.moveLater, { n })} title={fmt(v.moveLater, { n })}>
                        <Icon name="chevronDown" />
                      </button>
                    </div>
                  )}
                  {canEdit && (
                    <>
                      <button type="button" className="btn btn-sm" onClick={() => setPicker({ kind: 'scene', scene: n })} aria-label={fmt(v.chooseMediaFor, { n })}>
                        <Icon name="image" />
                        {v.chooseMedia}
                      </button>
                      {ss.media_asset_id && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateScene(n, { media_asset_id: null })}>
                          {v.useSceneMedia}
                        </button>
                      )}
                      <label className="field">
                        <span className="field-label xsmall">{v.transitionAfter}</span>
                        <select className="select select-sm" value={ss.transition ?? ''} onChange={(e) => updateScene(n, { transition: e.target.value as Transition | '' })} disabled={i === scenes.length - 1}>
                          <option value="">{fmt(v.defaultTransition, { name: v.transitions[settings.transition] })}</option>
                          {TRANSITIONS.map((tr) => (
                            <option key={tr} value={tr}>
                              {v.transitions[tr]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox xsmall">
                        <input type="checkbox" checked={ss.fit === 'contain'} onChange={(e) => updateScene(n, { fit: e.target.checked ? 'contain' : 'cover' })} />
                        <span>{v.showWhole}</span>
                      </label>
                      <label className="checkbox xsmall">
                        <input type="checkbox" checked={ss.show_text !== false} onChange={(e) => updateScene(n, { show_text: e.target.checked })} />
                        <span>{v.showText}</span>
                      </label>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <Storyboard scenes={scenes} settings={settings} library={library} />
      </section>

      <GenerationPanel
        projectId={projectId}
        onUse={(scene, assetId) => {
          updateScene(scene, { media_asset_id: assetId });
          setLibrary(null);
        }}
      />

      <section className="panel panel-pad stack" aria-labelledby={`${id}-out`}>
        <h3 id={`${id}-out`} className="section-title">
          {v.output}
        </h3>
        <fieldset className="stack" disabled={!canEdit}>
          <div className="field">
            <span className="field-label" id={`${id}-asp`}>
              {v.format}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby={`${id}-asp`}>
              {VIDEO_ASPECTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={settings.aspect === a} onClick={() => update({ aspect: a })}>
                  <span className="aspect-swatch" data-aspect={a} aria-hidden="true" />
                  {v.aspects[a]}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid cols-2">
            <label className="field">
              <span className="field-label">{v.resolution}</span>
              <select className="select" value={settings.resolution} onChange={(e) => update({ resolution: Number(e.target.value) as VideoSettings['resolution'] })}>
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {`${r}p · ${renderSize(settings.aspect, r).width}×${renderSize(settings.aspect, r).height}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{v.quality}</span>
              <select className="select" value={settings.quality} onChange={(e) => update({ quality: e.target.value as VideoSettings['quality'] })}>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {v.qualities[q]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{v.transition}</span>
              <select className="select" value={settings.transition} onChange={(e) => update({ transition: e.target.value as Transition })}>
                {TRANSITIONS.map((tr) => (
                  <option key={tr} value={tr}>
                    {v.transitions[tr]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                {v.transitionLength} <small className="ltr">{settings.transition_seconds.toFixed(1)} s</small>
              </span>
              <input className="range" type="range" min={0.2} max={1.5} step={0.1} value={settings.transition_seconds} onChange={(e) => update({ transition_seconds: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field-label">{v.subtitles}</span>
              <select className="select" value={settings.subtitles} onChange={(e) => update({ subtitles: e.target.value as VideoSettings['subtitles'] })}>
                {SUBTITLE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {v.subtitleModes[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{v.textPosition}</span>
              <select className="select" value={settings.text_position} onChange={(e) => update({ text_position: e.target.value as VideoSettings['text_position'] })}>
                {(['top', 'center', 'bottom'] as const).map((p) => (
                  <option key={p} value={p}>
                    {v.positions[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{v.textSize}</span>
              <select className="select" value={settings.text_size} onChange={(e) => update({ text_size: e.target.value as VideoSettings['text_size'] })}>
                {(['small', 'medium', 'large'] as const).map((p) => (
                  <option key={p} value={p}>
                    {v.sizes[p]}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">{v.music}</span>
              <div className="row">
                <span className="small" data-testid="music-name">
                  {music ? (music.label ?? music.file_name) : v.noMusic}
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setPicker({ kind: 'music' })}>
                  {v.chooseMusic}
                </button>
                {settings.music_asset_id && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ music_asset_id: null })}>
                    {t.common.delete}
                  </button>
                )}
              </div>
              {settings.music_asset_id && (
                <label className="field">
                  <span className="field-label xsmall">
                    {v.musicVolume} <small className="ltr">{Math.round(settings.music_volume * 100)}%</small>
                  </span>
                  <input className="range" type="range" min={0} max={1} step={0.05} value={settings.music_volume} onChange={(e) => update({ music_volume: Number(e.target.value) })} />
                </label>
              )}
            </div>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={settings.logo} onChange={(e) => update({ logo: e.target.checked })} />
            <span>{v.logo}</span>
          </label>
        </fieldset>
        <div className="row">
          <span className="small muted ltr" data-testid="video-size">
            {size.width}×{size.height} · {fmt(v.totalSeconds, { n: total, max })}
          </span>
          {state.slots && <span className="small muted">· {fmt(v.slots, { used: state.slots.used, total: state.slots.total })}</span>}
        </div>
        {exportBlocker && <p className="small muted" data-testid="export-blocker">{exportBlocker}</p>}
        {error && (
          <p className="callout callout-danger small" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="button" className="btn btn-primary" onClick={() => void startExport()} disabled={!!exportBlocker || busy} data-testid="start-export">
            <Icon name="film" />
            {busy ? v.starting : v.export}
          </button>
        </div>
      </section>

      <section className="stack" aria-labelledby={`${id}-jobs`}>
        <h3 id={`${id}-jobs`} className="section-title">
          {v.exports}
        </h3>
        {state.jobs.length === 0 ? (
          <p className="small muted">{v.noExports}</p>
        ) : (
          <ul className="render-list" data-testid="render-list">
            {state.jobs.map((j) => (
              <li key={j.id} className="render-row panel panel-pad" data-status={j.status}>
                <div className="row">
                  <span className={`badge ${j.status === 'completed' ? 'badge-success' : j.status === 'failed' ? 'badge-danger' : j.status === 'cancelled' ? 'badge-warning' : 'badge-info'}`} data-testid="render-status">
                    {v.status[j.status]}
                  </span>
                  <b className="small ltr">
                    {j.aspect} · {j.width}×{j.height}
                  </b>
                  <span className="xsmall muted">
                    {v.qualities[j.quality as keyof typeof v.qualities] ?? j.quality} · {fmt(v.revisionN, { n: j.script_revision_number })} · <RelativeTime iso={j.created_at} />
                  </span>
                </div>
                {ACTIVE.includes(j.status) && (
                  <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress)} aria-label={v.progress}>
                    <div className="meter-head xsmall">
                      <span>{j.cancel_requested ? v.cancelling : j.status === 'queued' ? v.waiting : (v.stages as Record<string, string>)[j.stage ?? ''] ?? v.stages.rendering}</span>
                      <span className="ltr" data-testid="render-progress">
                        {Math.round(j.progress)}%
                      </span>
                    </div>
                    <div className="meter-track">
                      <div className="meter-fill" style={{ width: `${Math.max(2, j.progress)}%` }} />
                    </div>
                  </div>
                )}
                {j.status === 'completed' && (
                  <p className="xsmall muted ltr" data-testid="render-output">
                    {secs(j.output_duration_ms ?? 0)} s · {((j.output_size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB · H.264 + AAC
                  </p>
                )}
                {j.status === 'failed' && <p className="small">{(v.failures as Record<string, string>)[j.error_code ?? ''] ?? v.failures.other}</p>}
                {j.notes.length > 0 && (
                  <ul className="plain-list xsmall muted">
                    {j.notes.map((n) => (
                      <li key={n}>{(v.notes as Record<string, string>)[n] ?? n}</li>
                    ))}
                  </ul>
                )}
                <div className="row">
                  {j.status === 'completed' && (
                    <>
                      <button type="button" className="btn btn-sm" onClick={() => void link(j, true)}>
                        <Icon name="play" />
                        {v.preview}
                      </button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void link(j, false)} data-testid="render-download">
                        <Icon name="download" />
                        {v.download}
                      </button>
                    </>
                  )}
                  {canEdit && ACTIVE.includes(j.status) && !j.cancel_requested && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(j, 'cancel')}>
                      {v.cancel}
                    </button>
                  )}
                  {canEdit && (j.status === 'failed' || j.status === 'cancelled') && (
                    <button type="button" className="btn btn-sm" onClick={() => void act(j, 'retry')}>
                      <Icon name="restore" />
                      {v.retry}
                    </button>
                  )}
                </div>
                {player?.job === j.id && (
                  <video className="render-player" src={player.url} controls playsInline data-testid="render-player" style={{ aspectRatio: `${j.width} / ${j.height}` }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AssetPicker
        open={picker !== null}
        selected={[]}
        max={1}
        filter={(a) => (picker?.kind === 'music' ? a.media_type === 'audio' : a.media_type === 'image' || a.media_type === 'video')}
        onClose={(ids, assets) => {
          const p = picker;
          setPicker(null);
          const chosen = ids?.[0];
          if (!chosen || !p) return;
          // The picker returns only the files it listed: merge them (fresh links) into the library.
          if (assets.length) setLibrary((lib) => [...assets, ...(lib ?? []).filter((x) => !assets.some((a) => a.id === x.id))]);
          if (p.kind === 'music') update({ music_asset_id: chosen });
          else updateScene(p.scene, { media_asset_id: chosen });
        }}
      />
    </div>
  );
}

/** Plays the scene order with their durations (stills + on-screen text) before anything is rendered. */
function Storyboard({ scenes, settings, library }: { scenes: ProjectDraft['scenes']; settings: VideoSettings; library: ClientAsset[] | null }) {
  const { t } = useI18n();
  const v = t.video;
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const s = scenes[index];
    if (!s) {
      setPlaying(false);
      setIndex(0);
      return;
    }
    const timer = window.setTimeout(() => setIndex((i) => i + 1), s.duration_seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, index, scenes]);
  const s = scenes[Math.min(index, scenes.length - 1)];
  const ss = s ? settings.scenes[String(Math.min(index, scenes.length - 1) + 1)] ?? {} : {};
  const visual = s ? sceneVisual(s.asset_ids, ss.media_asset_id, library) : null;
  const size = useMemo(() => renderSize(settings.aspect, 480), [settings.aspect]);
  return (
    <div className="storyboard">
      <div className="storyboard-frame" style={{ aspectRatio: `${size.width} / ${size.height}` }} data-testid="storyboard">
        {visual?.media_type === 'image' && visual.url ? <img src={visual.url} alt="" style={{ objectFit: ss.fit === 'contain' ? 'contain' : 'cover' }} /> : visual?.media_type === 'video' && visual.url ? <video key={visual.url} src={playing ? visual.url : `${visual.url}#t=0.1`} muted playsInline preload="metadata" autoPlay={playing} loop style={{ objectFit: ss.fit === 'contain' ? 'contain' : 'cover' }} /> : <span className="video-card-label">{v.textCard}</span>}
        {s && (s.on_screen_text || !visual) && ss.show_text !== false && (
          <span className={`storyboard-text pos-${visual ? settings.text_position : 'center'}`} dir="auto">
            {s.on_screen_text || s.title}
          </span>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => setPlaying((p) => !p)} data-testid="storyboard-play">
          <Icon name="play" />
          {playing ? v.pausePreview : v.playPreview}
        </button>
        <span className="xsmall muted">{s ? fmt(v.previewScene, { n: Math.min(index, scenes.length - 1) + 1, total: scenes.length }) : ''}</span>
      </div>
      <p className="xsmall muted">{v.previewNote}</p>
    </div>
  );
}
