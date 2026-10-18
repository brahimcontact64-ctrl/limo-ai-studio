'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { CAPTION_MAX, HASHTAGS_MAX, normalizeHashtags } from '@/lib/images/posts';
import type { ImageDoc } from '@/lib/images/types';
import { EDITABLE_POST_STATUSES, POST_LANGUAGES, POST_TONES, type BusinessType, type ComposeResult, type PostDraftProposal, type PostFacts, type PostLanguage, type PostStatus, type PostTone } from '@/lib/social/types';
import type { PageRow, VideoCandidate } from '@/lib/data/social';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { useToast } from '@/components/ui/Toast';
import { DocPreview } from '@/components/images/DocPreview';
import { renderToBlob, saveExport, useLoadedImages } from '@/components/images/canvas';
import { AiPanel, type ProposalField } from './AiPanel';
import { ParagraphTools } from './ParagraphTools';
import { ScheduleDialog } from './ScheduleDialog';
import { PostRevisions } from './PostRevisions';

export interface ComposerDesign {
  id: string;
  title: string;
  status: 'draft' | 'approved';
  document: ImageDoc;
}

export interface ComposerPostState {
  id: string | null;
  title: string;
  caption: string;
  headline: string;
  cta: string;
  hashtags: string[];
  language_code: PostLanguage;
  tone: PostTone;
  media_kind: 'image' | 'video';
  image_project_id: string | null;
  media_asset_id: string | null;
  render_job_id: string | null;
  source_project_id: string | null;
  origin: 'manual' | 'ai' | 'automation';
  status: PostStatus;
  updated_at: string | null;
  page_id: string | null;
  scheduled_at: string | null;
  timezone: string | null;
  published_at: string | null;
  external_post_id: string | null;
  simulated: boolean;
  last_error: string | null;
  review_note: string | null;
  automation_policy_version: number | null;
}

export interface ComposerPrefill {
  prompt: string;
  facts: Partial<PostFacts>;
  business: BusinessType;
}

type Result = { id?: string; updated_at?: string; status?: PostStatus; revision_number?: number; run_at?: string; simulated?: boolean; error?: string };
const STEPS: PostStatus[] = ['draft', 'awaiting_review', 'approved', 'scheduled', 'published'];
const PLACEHOLDER = /\[[^\]\n]{1,80}\]/;
const AUTOSAVE_MS = 4000;

async function call(url: string, body: unknown): Promise<{ ok: boolean; body: Result }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: !!res?.ok, body: ((await res?.json().catch(() => ({}))) ?? {}) as Result };
}

/**
 * Facebook post composer: describe → Mock AI proposals (accept/reject per field) → edit everything →
 * choose an approved design, library image or MP4 export → preview → review/approve → schedule on a
 * (simulated) Page → published. Every rule is enforced again in the database.
 */
export function Composer({
  organizationId,
  post: initial,
  designs,
  urls,
  videos,
  mediaUrl: initialMediaUrl,
  pages,
  paused,
  pageName,
  canEdit,
  prefill,
}: {
  organizationId: string;
  post: ComposerPostState;
  designs: ComposerDesign[];
  urls: Record<string, string>;
  videos: Array<VideoCandidate & { url: string | null }>;
  mediaUrl: string | null;
  pages: PageRow[];
  paused: boolean;
  pageName: string;
  canEdit: boolean;
  prefill: ComposerPrefill | null;
}) {
  const { t } = useI18n();
  const s = t.social;
  const p = t.posts;
  const id = useId();
  const toast = useToast();
  const router = useRouter();
  const loaded = useLoadedImages(urls);
  const [f, setF] = useState(initial);
  const [tagsText, setTagsText] = useState(initial.hashtags.map((h) => `#${h}`).join(' '));
  const [mediaUrl, setMediaUrl] = useState(initialMediaUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [suggestedTime, setSuggestedTime] = useState<{ local: string; timezone: string } | null>(null);
  const [dialog, setDialog] = useState<null | 'schedule' | 'revisions' | 'reject' | 'unapprove' | 'cancel'>(null);
  const [picker, setPicker] = useState(false);
  const [mediaTab, setMediaTab] = useState<'designs' | 'videos'>(initial.media_kind === 'video' ? 'videos' : 'designs');
  const [rejectNote, setRejectNote] = useState('');
  const hashtags = useMemo(() => normalizeHashtags(tagsText), [tagsText]);
  const keyOf = (x: ComposerPostState, tags: string[]) => JSON.stringify([x.title, x.caption, x.headline, x.cta, tags, x.language_code, x.tone, x.media_kind, x.image_project_id, x.media_asset_id, x.render_job_id]);
  const [savedKey, setSavedKey] = useState(() => keyOf(initial, initial.hashtags));
  const dirty = keyOf(f, hashtags) !== savedKey;
  const editable = canEdit && EDITABLE_POST_STATUSES.includes(f.status);
  const design = designs.find((d) => d.id === f.image_project_id) ?? null;
  const video = videos.find((v) => v.id === f.render_job_id) ?? null;
  const set = <K extends keyof ComposerPostState>(k: K, v: ComposerPostState[K]) => setF((x) => ({ ...x, [k]: v }));

  const issues = [
    !f.caption.trim() && 'caption_required',
    PLACEHOLDER.test(`${f.caption} ${f.headline} ${f.cta}`) && 'placeholder',
    f.media_kind === 'image' && !f.media_asset_id && 'image_required',
    f.media_kind === 'video' && !f.render_job_id && 'video_required',
    f.media_kind === 'image' && design && design.status !== 'approved' && 'image_not_approved',
    f.media_kind === 'video' && video && !video.approved && 'video_not_approved',
  ].filter(Boolean) as Array<keyof typeof s.issues>;

  const save = useCallback(
    async (source: 'manual' | 'autosave' = 'manual'): Promise<string | null> => {
      setError(null);
      setBusy(source === 'manual' ? 'save' : 'autosave');
      const res = await call('/api/posts', {
        id: f.id,
        base_updated_at: f.updated_at,
        title: f.title.trim() || p.untitled,
        caption: f.caption,
        headline: f.headline,
        cta: f.cta,
        hashtags,
        language_code: f.language_code,
        tone: f.tone,
        media_kind: f.media_kind,
        image_project_id: f.image_project_id,
        media_asset_id: f.media_asset_id,
        render_job_id: f.render_job_id,
        source_project_id: f.source_project_id,
        origin: f.origin === 'ai' || aiApplied ? 'ai' : 'manual',
        revision_source: aiApplied ? 'ai_suggestion' : source,
      });
      setBusy(null);
      if (!res.ok || !res.body.id || !res.body.updated_at) {
        setError((s.errors as Record<string, string>)[res.body.error ?? ''] ?? t.common.errorGeneric);
        return null;
      }
      setSavedKey(keyOf(f, hashtags));
      setAiApplied(false);
      setF((x) => ({ ...x, id: res.body.id!, updated_at: res.body.updated_at!, status: res.body.status ?? x.status }));
      if (!f.id) {
        router.replace(`/app/posts/${res.body.id}`);
        return res.body.updated_at;
      }
      if (source === 'manual') toast(p.saved, 'success');
      return res.body.updated_at;
    },
    // keyOf is stable in behaviour; the latest field values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, hashtags, aiApplied, p.saved, p.untitled, router, s.errors, t.common.errorGeneric, toast],
  );

  // Autosave drafts a few seconds after the last change (existing posts only).
  useEffect(() => {
    if (!dirty || !editable || !f.id || busy) return;
    const timer = window.setTimeout(() => void save('autosave'), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, editable, f.id, busy, save, savedKey, tagsText, f]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    let base = f.updated_at;
    if (dirty && editable) {
      base = await save('manual');
      if (!base) return;
    }
    if (!f.id) return;
    setBusy(action);
    setError(null);
    const res = await call(`/api/posts/${f.id}`, { action, base_updated_at: base, ...extra });
    setBusy(null);
    if (!res.ok) {
      setError((s.errors as Record<string, string>)[res.body.error ?? ''] ?? t.common.errorGeneric);
      return false;
    }
    setDialog(null);
    toast((s.toasts as Record<string, string>)[action] ?? p.saved, 'success');
    // A restored revision brings new content from the server; every other action is applied in place
    // (a refresh would remount the composer and close whatever the customer opens next).
    if (action === 'restore') {
      router.refresh();
      return true;
    }
    setF((x) => ({
      ...x,
      status: res.body.status ?? x.status,
      updated_at: res.body.updated_at ?? x.updated_at,
      review_note: action === 'reject' ? String(extra.note ?? '') : action === 'approve' ? null : x.review_note,
      last_error: action === 'approve' || action === 'schedule' ? null : x.last_error,
      page_id: action === 'schedule' ? String(extra.page_id) : x.page_id,
      timezone: action === 'schedule' ? String(extra.timezone) : x.timezone,
      scheduled_at: action === 'schedule' ? (res.body.run_at ?? x.scheduled_at) : action === 'unschedule' || action === 'cancel' ? null : x.scheduled_at,
      simulated: action === 'schedule' ? res.body.simulated === true : x.simulated,
    }));
    return true;
  }

  function applyProposal(pr: PostDraftProposal, fields: ProposalField[]) {
    setF((x) => ({
      ...x,
      headline: fields.includes('headline') ? pr.headline : x.headline,
      caption: fields.includes('caption') ? pr.caption : x.caption,
      cta: fields.includes('cta') ? pr.cta : x.cta,
      origin: x.origin === 'automation' ? x.origin : 'ai',
    }));
    if (fields.includes('hashtags')) setTagsText(pr.hashtags.map((h) => `#${h}`).join(' '));
    setAiApplied(true);
  }

  function onAiResult(r: ComposeResult) {
    setSuggestedTime({ local: r.suggested_time.local, timezone: r.suggested_time.timezone });
    if (!f.title.trim() && r.proposals[0]) set('title', r.proposals[0].headline.slice(0, 200));
  }

  async function attachDesign(d: ComposerDesign) {
    setError(null);
    setBusy('attach');
    try {
      const blob = await renderToBlob(d.document, loaded, 'png', 1);
      const saved = await saveExport(organizationId, d.id, blob, 'png', d.document.width, d.document.height, null);
      if (!saved.ok) return setError(t.images.errors.upload);
      setF((x) => ({ ...x, media_kind: 'image', image_project_id: d.id, media_asset_id: saved.data.media_asset_id, render_job_id: null }));
      setMediaUrl(URL.createObjectURL(blob));
    } catch {
      setError(t.images.errors.render);
    } finally {
      setBusy(null);
    }
  }

  const statusIndex = STEPS.indexOf(f.status === 'publishing' ? 'scheduled' : f.status);
  const page = pages.find((x) => x.id === f.page_id) ?? null;
  const message = [f.headline.trim(), f.caption.trim(), f.cta.trim(), hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');

  return (
    <div className="post-layout">
      <div className="stack">
        {f.origin === 'automation' && (
          <p className="callout small" data-testid="automation-origin">
            <Icon name="sparkle" />
            <span>{fmt(s.fromAutomation, { v: f.automation_policy_version ?? '—' })}</span>
          </p>
        )}
        {paused && (
          <p className="callout callout-warning small" role="note">
            <Icon name="alert" />
            <span>{s.pausedNote}</span>
          </p>
        )}

        <section className="panel panel-pad stack-sm" aria-label={s.workflow}>
          <ol className="status-track" data-testid="status-track">
            {STEPS.map((st, i) => (
              <li key={st} className={i < statusIndex ? 'done' : i === statusIndex ? 'current' : ''}>
                {s.status[st]}
              </li>
            ))}
          </ol>
          <div className="row">
            <span className={`badge ${f.status === 'published' ? 'badge-success' : f.status === 'failed' ? 'badge-danger' : f.status === 'scheduled' || f.status === 'publishing' ? 'badge-accent' : f.status === 'approved' ? 'badge-success' : 'badge-info'}`} data-testid="post-status">
              {s.status[f.status]}
            </span>
            {f.simulated && (f.status === 'published' || f.status === 'scheduled' || f.status === 'publishing') && <span className="badge badge-warning plain">{s.simulatedBadge}</span>}
            {dirty && editable && <span className="xsmall muted">{busy === 'autosave' ? t.common.saving : t.images.editor.unsaved}</span>}
          </div>
          {f.status === 'scheduled' && f.scheduled_at && (
            <p className="small" data-testid="scheduled-info">
              {fmt(s.scheduledFor, { time: new Date(f.scheduled_at).toLocaleString(undefined, { timeZone: f.timezone ?? undefined, dateStyle: 'medium', timeStyle: 'short' }), zone: f.timezone ?? 'UTC', page: page?.page_name ?? '—' })}
            </p>
          )}
          {f.status === 'published' && (
            <p className="callout callout-success small" data-testid="post-ready">
              <Icon name="check" />
              <span>{f.simulated ? fmt(s.publishedSimulated, { page: page?.page_name ?? '—', id: f.external_post_id ?? '' }) : s.publishedLive}</span>
            </p>
          )}
          {f.status === 'approved' && (
            <p className="callout callout-success small" data-testid="post-ready">
              <Icon name="check" />
              <span>{p.readyNotConnected}</span>
            </p>
          )}
          {f.last_error && (f.status === 'failed' || f.status === 'draft' || f.status === 'approved' || f.status === 'scheduled') && (
            <p className={`callout small ${f.status === 'failed' ? 'callout-danger' : 'callout-warning'}`} data-testid="post-error">
              <Icon name="alert" />
              <span>{(s.failures as Record<string, string>)[f.last_error] ?? s.failures.unknown}</span>
            </p>
          )}
          {f.review_note && f.status === 'draft' && (
            <p className="callout callout-warning small" data-testid="review-note">
              <Icon name="info" />
              <span dir="auto">
                {s.reviewNote}: {f.review_note}
              </span>
            </p>
          )}
        </section>

        {editable && (
          <AiPanel
            language={f.language_code}
            tone={f.tone}
            current={{ headline: f.headline, caption: f.caption, cta: f.cta, hashtags: tagsText }}
            initialPrompt={prefill?.prompt ?? ''}
            initialFacts={prefill?.facts ?? {}}
            initialBusiness={prefill?.business ?? 'other'}
            disabled={!editable}
            onAccept={applyProposal}
            onResult={onAiResult}
          />
        )}

        <section className="panel panel-pad stack" aria-labelledby={`${id}-text`}>
          <h2 id={`${id}-text`} className="section-title">
            {s.text}
          </h2>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-title`}>
              {p.fields.title}
            </label>
            <input id={`${id}-title`} className="input" maxLength={200} value={f.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} dir="auto" />
          </div>
          <div className="form-grid cols-2">
            <label className="field">
              <span className="field-label">{s.language}</span>
              <select className="select" value={f.language_code} disabled={!editable} onChange={(e) => set('language_code', e.target.value as PostLanguage)}>
                {POST_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {s.languages[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{s.tone}</span>
              <select className="select" value={f.tone} disabled={!editable} onChange={(e) => set('tone', e.target.value as PostTone)}>
                {POST_TONES.map((x) => (
                  <option key={x} value={x}>
                    {s.tones[x]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-headline`}>
              {s.headline}
            </label>
            <input id={`${id}-headline`} className="input" maxLength={200} value={f.headline} disabled={!editable} onChange={(e) => set('headline', e.target.value)} dir="auto" data-testid="post-headline" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-caption`}>
              {p.fields.caption}
            </label>
            <textarea id={`${id}-caption`} className="textarea" rows={7} maxLength={CAPTION_MAX} value={f.caption} disabled={!editable} onChange={(e) => set('caption', e.target.value)} dir="auto" data-testid="post-caption" />
            <span className="field-hint ltr">{fmt(p.fields.captionCount, { n: f.caption.length, max: CAPTION_MAX })}</span>
          </div>
          {editable && (
            <ParagraphTools
              caption={f.caption}
              language={f.language_code}
              tone={f.tone}
              disabled={!editable}
              onReplace={(i, text) => {
                const parts = f.caption.split(/\n{2,}/);
                parts[i] = text;
                set('caption', parts.join('\n\n'));
                setAiApplied(true);
              }}
            />
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${id}-tags`}>
              {p.fields.hashtags}
            </label>
            <input id={`${id}-tags`} className="input" value={tagsText} disabled={!editable} onChange={(e) => setTagsText(e.target.value)} dir="auto" placeholder="#offer #new" />
            <span className="field-hint">{fmt(p.fields.hashtagsHint, { max: HASHTAGS_MAX })}</span>
            {hashtags.length > 0 && (
              <div className="row" data-testid="hashtag-chips">
                {hashtags.map((h) => (
                  <span key={h} className="chip chip-sm">
                    #{h}
                    {editable && (
                      <button type="button" className="chip-x" aria-label={fmt(s.removeTag, { tag: h })} onClick={() => setTagsText(hashtags.filter((x) => x !== h).map((x) => `#${x}`).join(' '))}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-cta`}>
              {s.cta}
            </label>
            <input id={`${id}-cta`} className="input" maxLength={120} value={f.cta} disabled={!editable} onChange={(e) => set('cta', e.target.value)} dir="auto" data-testid="post-cta" />
            {editable && (
              <div className="row">
                {s.ctaPresets.map((c) => (
                  <button key={c} type="button" className="chip chip-sm" onClick={() => set('cta', c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel panel-pad stack" aria-labelledby={`${id}-img`}>
          <h2 id={`${id}-img`} className="section-title">
            {s.media}
          </h2>
          {f.media_kind === 'image' && f.media_asset_id ? (
            <div className="row">
              <span className="small">{design ? <b dir="auto">{design.title}</b> : p.image.libraryImage}</span>
              {design && (
                <Link className="btn btn-sm" href={`/app/images/${design.id}${f.id ? `?post=${f.id}` : ''}`} prefetch={false}>
                  <Icon name="edit" />
                  {p.image.edit}
                </Link>
              )}
            </div>
          ) : f.media_kind === 'video' && video ? (
            <p className="small">
              <b dir="auto">{video.title}</b> <span className="ltr">· {video.aspect} · {video.width}×{video.height}</span>
            </p>
          ) : (
            <p className="small muted">{p.image.none}</p>
          )}
          {editable && (
            <>
              <div className="segmented" role="tablist">
                <button type="button" role="tab" aria-selected={mediaTab === 'designs'} aria-checked={mediaTab === 'designs'} onClick={() => setMediaTab('designs')}>
                  {s.mediaTabs.designs}
                </button>
                <button type="button" role="tab" aria-selected={mediaTab === 'videos'} aria-checked={mediaTab === 'videos'} onClick={() => setMediaTab('videos')}>
                  {s.mediaTabs.videos}
                </button>
              </div>
              {mediaTab === 'designs' ? (
                <>
                  <p className="xsmall muted">{p.image.approvedOnly}</p>
                  {designs.length > 0 && (
                    <ul className="design-pick" data-testid="design-pick">
                      {designs.map((d) => (
                        <li key={d.id} className={`design-option${d.id === f.image_project_id ? ' is-selected' : ''}`}>
                          <DocPreview doc={d.document} images={loaded} label={d.title} />
                          <span className="small" dir="auto">
                            <b>{d.title}</b>
                          </span>
                          {d.status === 'approved' ? (
                            <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void attachDesign(d)} aria-label={`${p.image.attach}: ${d.title}`}>
                              {busy === 'attach' ? p.image.attaching : p.image.attach}
                            </button>
                          ) : (
                            <Link className="btn btn-sm btn-ghost" href={`/app/images/${d.id}${f.id ? `?post=${f.id}` : ''}`} prefetch={false}>
                              {p.image.approveFirst}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row">
                    <button type="button" className="btn btn-sm" onClick={() => setPicker(true)} disabled={busy !== null}>
                      <Icon name="image" />
                      {p.image.library}
                    </button>
                    {f.id ? (
                      <Link className="btn btn-sm" href={`/app/images/new?purpose=social_post&post=${f.id}`} prefetch={false}>
                        <Icon name="brush" />
                        {s.openImageStudio}
                      </Link>
                    ) : (
                      <span className="xsmall muted">{p.image.saveFirst}</span>
                    )}
                  </div>
                </>
              ) : videos.length === 0 ? (
                <p className="small muted">{s.noVideos}</p>
              ) : (
                <ul className="design-pick" data-testid="video-pick">
                  {videos.map((v) => (
                    <li key={v.id} className={`design-option${v.id === f.render_job_id ? ' is-selected' : ''}`}>
                      {v.url ? <video src={`${v.url}#t=0.1`} muted playsInline preload="metadata" className="video-option" /> : <div className="video-option" />}
                      <span className="small" dir="auto">
                        <b>{v.title}</b> <span className="ltr xsmall muted">{v.aspect}</span>
                      </span>
                      {v.approved ? (
                        <button type="button" className="btn btn-sm" onClick={() => {
                          setF((x) => ({ ...x, media_kind: 'video', render_job_id: v.id, image_project_id: null, media_asset_id: null }));
                          setMediaUrl(v.url);
                        }} aria-label={`${s.useVideo}: ${v.title}`}>
                          {s.useVideo}
                        </button>
                      ) : (
                        <span className="xsmall muted">{s.videoNotApproved}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {error && (
          <p className="callout callout-danger small" role="alert">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="row">
            {editable && (
              <button type="button" className="btn" onClick={() => void save('manual')} disabled={busy !== null || (!dirty && !!f.id)}>
                <Icon name="save" />
                {busy === 'save' ? t.common.saving : p.saveDraft}
              </button>
            )}
            {f.status === 'draft' && f.id && (
              <button type="button" className="btn" onClick={() => void act('submit')} disabled={busy !== null}>
                {s.actions.submit}
              </button>
            )}
            {(f.status === 'draft' || f.status === 'awaiting_review') && (
              <button type="button" className="btn btn-primary" onClick={() => void act('approve')} disabled={busy !== null || issues.length > 0 || !f.id && !dirty}>
                <Icon name="check" />
                {p.approve}
              </button>
            )}
            {f.status === 'awaiting_review' && (
              <button type="button" className="btn" onClick={() => setDialog('reject')} disabled={busy !== null}>
                {s.actions.reject}
              </button>
            )}
            {f.status === 'approved' && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setDialog('schedule')} disabled={busy !== null || paused} data-testid="open-schedule">
                  <Icon name="clock" />
                  {s.actions.schedule}
                </button>
                <button type="button" className="btn" onClick={() => setDialog('unapprove')} disabled={busy !== null}>
                  <Icon name="lock" />
                  {p.removeApproval}
                </button>
              </>
            )}
            {f.status === 'scheduled' && (
              <button type="button" className="btn" onClick={() => void act('unschedule')} disabled={busy !== null}>
                {s.actions.unschedule}
              </button>
            )}
            {f.id && ['draft', 'awaiting_review', 'approved', 'scheduled', 'failed'].includes(f.status) && (
              <button type="button" className="btn btn-ghost" onClick={() => setDialog('cancel')} disabled={busy !== null}>
                {s.actions.cancel}
              </button>
            )}
            {f.id && (
              <button type="button" className="btn btn-ghost" onClick={() => setDialog('revisions')}>
                <Icon name="clock" />
                {s.revisions.title}
              </button>
            )}
          </div>
        )}
        {(f.status === 'draft' || f.status === 'awaiting_review') && issues.length > 0 && (
          <ul className="plain-list xsmall muted" data-testid="post-issues">
            {issues.map((i) => (
              <li key={i}>{s.issues[i]}</li>
            ))}
          </ul>
        )}
      </div>

      <aside className="stack">
        <section className="stack-sm" aria-labelledby={`${id}-prev`}>
          <h2 id={`${id}-prev`} className="section-title">
            {p.preview.title}
          </h2>
          <article className="fb-card" data-testid="post-preview">
            <header className="fb-head">
              <span className="avatar" aria-hidden="true">
                {(page?.page_name || pageName || 'P').charAt(0)}
              </span>
              <span>
                <b dir="auto">{page?.page_name || pageName || p.preview.page}</b>
                <small className="muted">{f.published_at ? <RelativeTime iso={f.published_at} /> : p.preview.justNow}</small>
              </span>
            </header>
            {f.headline.trim() && (
              <p className="fb-text fb-headline" dir="auto">
                {f.headline}
              </p>
            )}
            {(f.caption.trim() || hashtags.length > 0) && (
              <p className="fb-text" dir="auto">
                {f.caption.trim()}
                {hashtags.length > 0 && (
                  <>
                    {f.caption.trim() && '\n\n'}
                    <span className="fb-tags">{hashtags.map((h) => `#${h}`).join(' ')}</span>
                  </>
                )}
              </p>
            )}
            {mediaUrl ? (
              f.media_kind === 'video' ? (
                <video className="fb-image" src={mediaUrl} controls playsInline muted data-testid="preview-video" />
              ) : (
                <img className="fb-image" src={mediaUrl} alt={design?.title ?? p.image.title} />
              )
            ) : (
              <div className="fb-image fb-empty">{p.image.none}</div>
            )}
            {f.cta.trim() && (
              <div className="fb-cta">
                <span className="btn btn-sm" dir="auto">
                  {f.cta}
                </span>
              </div>
            )}
            <footer className="fb-foot xsmall muted">{f.simulated || !page || page.is_mock ? s.previewSimulated : p.preview.note}</footer>
          </article>
        </section>
        <details className="panel panel-pad">
          <summary className="small">
            <b>{p.payload.title}</b>
          </summary>
          <p className="xsmall muted">{p.payload.note}</p>
          <pre className="payload ltr" data-testid="post-payload">
            {JSON.stringify({ channel: 'facebook_page', page: page?.page_name ?? null, simulated: page ? page.is_mock : true, message, media: f.media_kind === 'video' ? { kind: 'video', render_job_id: f.render_job_id } : { kind: 'image', asset_id: f.media_asset_id }, published: f.status === 'published' && !f.simulated }, null, 2)}
          </pre>
        </details>
      </aside>

      <AssetPicker
        open={picker}
        selected={f.media_asset_id && !f.image_project_id ? [f.media_asset_id] : []}
        max={1}
        filter={(a) => a.media_type === 'image'}
        onClose={(ids, assets) => {
          setPicker(false);
          const pick = ids?.[0];
          if (!pick) return;
          setF((x) => ({ ...x, media_kind: 'image', image_project_id: null, media_asset_id: pick, render_job_id: null }));
          setMediaUrl(assets.find((a) => a.id === pick)?.url ?? null);
        }}
      />
      {f.id && (
        <>
          <ScheduleDialog open={dialog === 'schedule'} pages={pages} suggested={suggestedTime} busy={busy !== null} onSchedule={(page_id, local_time, timezone) => void act('schedule', { page_id, local_time, timezone })} onClose={() => setDialog(null)} />
          <PostRevisions open={dialog === 'revisions'} postId={f.id} canRestore={editable} busy={busy !== null} onRestore={(rid) => void act('restore', { revision_id: rid })} onClose={() => setDialog(null)} />
        </>
      )}
      <ConfirmDialog open={dialog === 'unapprove'} title={p.removeApproval} body={p.unapproveBody} confirmLabel={p.removeApproval} busy={busy !== null} onConfirm={() => void act('unapprove')} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'cancel'} title={s.actions.cancel} body={s.cancelBody} confirmLabel={s.actions.cancel} danger busy={busy !== null} onConfirm={() => void act('cancel')} onClose={() => setDialog(null)} />
      {dialog === 'reject' && (
        <div className="callout stack-sm" role="dialog" aria-label={s.actions.reject} data-testid="reject-box">
          <label className="field">
            <span className="field-label">{s.rejectNote}</span>
            <textarea className="textarea" rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} dir="auto" />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={rejectNote.trim().length < 3 || busy !== null} onClick={() => void act('reject', { note: rejectNote })}>
              {s.actions.reject}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
