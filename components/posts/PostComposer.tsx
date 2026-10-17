'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { CAPTION_MAX, HASHTAGS_MAX, facebookDraftPayload, normalizeHashtags, validatePost } from '@/lib/images/posts';
import type { ImageDoc } from '@/lib/images/types';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { DocPreview } from '@/components/images/DocPreview';
import { renderToBlob, saveExport, useLoadedImages } from '@/components/images/canvas';
import { imageMessage, postJson } from '@/components/images/api';

export interface ComposerPost {
  id: string | null;
  title: string;
  caption: string;
  hashtags: string[];
  image_project_id: string | null;
  media_asset_id: string | null;
  status: 'draft' | 'approved';
  updated_at: string | null;
}

export interface ComposerImage {
  id: string;
  title: string;
  status: 'draft' | 'approved';
  document: ImageDoc;
}

type SaveResult = { id?: string; updated_at?: string; status?: 'draft' | 'approved'; error?: string };

/**
 * Social post: caption → image (an approved Image Studio design or a library image) → preview → approve.
 * Approval only marks the post ready for the future Facebook step; nothing is published here.
 */
export function PostComposer({
  organizationId,
  post: initial,
  images: designs,
  urls,
  mediaUrl: initialMediaUrl,
  pageName,
  canEdit,
}: {
  organizationId: string;
  post: ComposerPost;
  images: ComposerImage[];
  urls: Record<string, string>;
  mediaUrl: string | null;
  pageName: string;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const p = t.posts;
  const id = useId();
  const toast = useToast();
  const router = useRouter();
  const loaded = useLoadedImages(urls);
  const [title, setTitle] = useState(initial.title);
  const [caption, setCaption] = useState(initial.caption);
  const [tagsText, setTagsText] = useState(initial.hashtags.map((h) => `#${h}`).join(' '));
  const [imageProjectId, setImageProjectId] = useState(initial.image_project_id);
  const [mediaAssetId, setMediaAssetId] = useState(initial.media_asset_id);
  const [mediaUrl, setMediaUrl] = useState(initialMediaUrl);
  const [status, setStatus] = useState(initial.status);
  const [base, setBase] = useState(initial.updated_at);
  const [busy, setBusy] = useState<'save' | 'attach' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [confirmUnapprove, setConfirmUnapprove] = useState(false);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify([initial.title, initial.caption, initial.hashtags, initial.image_project_id, initial.media_asset_id]));

  const hashtags = useMemo(() => normalizeHashtags(tagsText), [tagsText]);
  const design = designs.find((d) => d.id === imageProjectId) ?? null;
  const approved = status === 'approved';
  const canChange = canEdit && !approved;
  const dirty = JSON.stringify([title, caption, hashtags, imageProjectId, mediaAssetId]) !== savedKey;
  const issues = validatePost({ caption, media_asset_id: mediaAssetId, image_status: design ? design.status : null });
  const postId = initial.id;

  async function save(): Promise<{ id: string; updated_at: string } | null> {
    setError(null);
    setBusy('save');
    const res = await postJson<SaveResult>('/api/posts', {
      id: postId,
      base_updated_at: base,
      title: title.trim() || p.untitled,
      caption,
      hashtags,
      image_project_id: imageProjectId,
      media_asset_id: mediaAssetId,
    });
    setBusy(null);
    if (!res.ok || !res.body.id || !res.body.updated_at) {
      setError(imageMessage(t, res.body));
      return null;
    }
    setBase(res.body.updated_at);
    setSavedKey(JSON.stringify([title, caption, hashtags, imageProjectId, mediaAssetId]));
    if (!postId) {
      router.replace(`/app/posts/${res.body.id}`);
      return { id: res.body.id, updated_at: res.body.updated_at };
    }
    toast(p.saved, 'success');
    return { id: res.body.id, updated_at: res.body.updated_at };
  }

  /** An approved design is rendered to PNG at its design size and saved to the library for this post. */
  async function attachDesign(d: ComposerImage) {
    setError(null);
    setBusy('attach');
    try {
      const blob = await renderToBlob(d.document, loaded, 'png', 1);
      const saved = await saveExport(organizationId, d.id, blob, 'png', d.document.width, d.document.height, null);
      if (!saved.ok) return setError(imageMessage(t, { error: saved.error }));
      setImageProjectId(d.id);
      setMediaAssetId(saved.data.media_asset_id);
      setMediaUrl(URL.createObjectURL(blob));
    } catch {
      setError(t.images.errors.render);
    } finally {
      setBusy(null);
    }
  }

  async function setApproval(approve: boolean) {
    let current = base;
    if (approve && (dirty || !postId)) {
      const saved = await save();
      if (!saved) return;
      current = saved.updated_at;
      if (!postId) return;
    }
    setError(null);
    setBusy('approve');
    const res = await postJson<SaveResult>(`/api/posts/${postId}`, { action: approve ? 'approve' : 'unapprove', base_updated_at: current });
    setBusy(null);
    setConfirmUnapprove(false);
    if (!res.ok || !res.body.updated_at) return setError(imageMessage(t, res.body));
    setStatus(res.body.status ?? (approve ? 'approved' : 'draft'));
    setBase(res.body.updated_at);
    toast(approve ? p.approvedToast : p.unapprovedToast, 'success');
  }

  const payload = facebookDraftPayload({ id: postId ?? '(unsaved)', caption, hashtags, media_asset_id: mediaAssetId });

  return (
    <div className="post-layout">
      <div className="stack">
        <section className="panel panel-pad stack">
          <div className="row">
            <span className={`badge ${approved ? 'badge-success' : 'badge-info'}`} data-testid="post-status">
              {approved ? p.approved : p.draft}
            </span>
            {dirty && canChange && <span className="xsmall muted">{t.images.editor.unsaved}</span>}
          </div>
          {approved && (
            <p className="callout callout-success small" data-testid="post-ready">
              <Icon name="check" />
              <span>{p.readyNotConnected}</span>
            </p>
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${id}-title`}>
              {p.fields.title}
            </label>
            <input id={`${id}-title`} className="input" maxLength={200} value={title} disabled={!canChange} onChange={(e) => setTitle(e.target.value)} dir="auto" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-caption`}>
              {p.fields.caption}
            </label>
            <textarea id={`${id}-caption`} className="textarea" rows={6} maxLength={CAPTION_MAX} value={caption} disabled={!canChange} onChange={(e) => setCaption(e.target.value)} dir="auto" data-testid="post-caption" />
            <span className="field-hint ltr">{fmt(p.fields.captionCount, { n: caption.length, max: CAPTION_MAX })}</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-tags`}>
              {p.fields.hashtags}
            </label>
            <input id={`${id}-tags`} className="input" value={tagsText} disabled={!canChange} onChange={(e) => setTagsText(e.target.value)} dir="auto" placeholder="#offer #new" />
            <span className="field-hint">{fmt(p.fields.hashtagsHint, { max: HASHTAGS_MAX })}</span>
          </div>
        </section>

        <section className="panel panel-pad stack" aria-labelledby={`${id}-img`}>
          <h2 id={`${id}-img`} className="section-title">
            {p.image.title}
          </h2>
          {mediaAssetId ? (
            <div className="row">
              <span className="small">{design ? <b dir="auto">{design.title}</b> : p.image.libraryImage}</span>
              {canChange && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setImageProjectId(null);
                    setMediaAssetId(null);
                    setMediaUrl(null);
                  }}
                >
                  <Icon name="x" />
                  {p.image.remove}
                </button>
              )}
              {design && (
                <Link className="btn btn-sm" href={`/app/images/${design.id}${postId ? `?post=${postId}` : ''}`} prefetch={false}>
                  <Icon name="edit" />
                  {p.image.edit}
                </Link>
              )}
            </div>
          ) : (
            <p className="small muted">{p.image.none}</p>
          )}
          {canChange && (
            <>
              <p className="xsmall muted">{p.image.approvedOnly}</p>
              {designs.length > 0 && (
                <ul className="design-pick" data-testid="design-pick">
                  {designs.map((d) => (
                    <li key={d.id} className={`design-option${d.id === imageProjectId ? ' is-selected' : ''}`}>
                      <DocPreview doc={d.document} images={loaded} label={d.title} />
                      <span className="small" dir="auto">
                        <b>{d.title}</b>
                      </span>
                      {d.status === 'approved' ? (
                        <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void attachDesign(d)} aria-label={`${p.image.attach}: ${d.title}`}>
                          {busy === 'attach' ? p.image.attaching : p.image.attach}
                        </button>
                      ) : (
                        <Link className="btn btn-sm btn-ghost" href={`/app/images/${d.id}${postId ? `?post=${postId}` : ''}`} prefetch={false}>
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
                {postId ? (
                  <Link className="btn btn-sm" href={`/app/images/new?purpose=social_post&post=${postId}`} prefetch={false}>
                    <Icon name="plus" />
                    {p.image.create}
                  </Link>
                ) : (
                  <span className="xsmall muted">{p.image.saveFirst}</span>
                )}
              </div>
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
            {canChange && (
              <button type="button" className="btn" onClick={() => void save()} disabled={busy !== null || (!dirty && !!postId)}>
                <Icon name="save" />
                {busy === 'save' ? t.common.saving : p.saveDraft}
              </button>
            )}
            {!approved && (
              <button type="button" className="btn btn-primary" onClick={() => void setApproval(true)} disabled={busy !== null || issues.length > 0}>
                <Icon name="check" />
                {p.approve}
              </button>
            )}
            {approved && (
              <button type="button" className="btn" onClick={() => setConfirmUnapprove(true)} disabled={busy !== null}>
                <Icon name="lock" />
                {p.removeApproval}
              </button>
            )}
          </div>
        )}
        {!approved && issues.length > 0 && (
          <ul className="plain-list xsmall muted" data-testid="post-issues">
            {issues.map((i) => (
              <li key={i}>{p.issues[i]}</li>
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
                {(pageName || 'P').charAt(0)}
              </span>
              <span>
                <b dir="auto">{pageName || p.preview.page}</b>
                <small className="muted">{p.preview.justNow}</small>
              </span>
            </header>
            {(caption.trim() || hashtags.length > 0) && (
              <p className="fb-text" dir="auto">
                {caption.trim()}
                {hashtags.length > 0 && (
                  <>
                    {caption.trim() && '\n\n'}
                    <span className="fb-tags">{hashtags.map((h) => `#${h}`).join(' ')}</span>
                  </>
                )}
              </p>
            )}
            {mediaUrl ? <img className="fb-image" src={mediaUrl} alt={design?.title ?? p.image.title} /> : <div className="fb-image fb-empty">{p.image.none}</div>}
            <footer className="fb-foot xsmall muted">{p.preview.note}</footer>
          </article>
        </section>
        <details className="panel panel-pad">
          <summary className="small">
            <b>{p.payload.title}</b>
          </summary>
          <p className="xsmall muted">{p.payload.note}</p>
          <pre className="payload ltr" data-testid="post-payload">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      </aside>

      <AssetPicker
        open={picker}
        selected={mediaAssetId && !imageProjectId ? [mediaAssetId] : []}
        max={1}
        filter={(a) => a.media_type === 'image'}
        onClose={(ids, assets) => {
          setPicker(false);
          const pick = ids?.[0];
          if (!pick) return;
          setImageProjectId(null);
          setMediaAssetId(pick);
          setMediaUrl(assets.find((a) => a.id === pick)?.url ?? null);
        }}
      />
      <ConfirmDialog open={confirmUnapprove} title={p.removeApproval} body={p.unapproveBody} confirmLabel={p.removeApproval} busy={busy === 'approve'} onConfirm={() => void setApproval(false)} onClose={() => setConfirmUnapprove(false)} />
    </div>
  );
}
