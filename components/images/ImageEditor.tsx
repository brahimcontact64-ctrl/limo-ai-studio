'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { createHistory, pushHistory, redo, replacePresent, undo, type History } from '@/lib/studio/history';
import {
  addLayer,
  duplicateLayer,
  hitTest,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  placeholders as findPlaceholders,
  removeLayer,
  reorderLayer,
  setLocked,
  updateLayer,
} from '@/lib/images/doc';
import type { ImageFormat } from '@/lib/images/formats';
import type { Background, ImageBrief, ImageDoc, ImageLayer, ImagePurpose, ImageStyle, Aspect, Layer, TextLayer, TextRole } from '@/lib/images/types';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { downloadBlob, fileNameFor, paint, renderToBlob, saveExport, useLoadedImages } from './canvas';
import { BackgroundProps, LayerProps } from './LayerProps';
import { ExportDialog, PreviewDialog, RevisionsDialog, type ExportItem, type RevisionItem } from './ImageDialogs';
import { imageMessage, postJson } from './api';

export interface EditorProject {
  id: string;
  organization_id: string;
  title: string;
  purpose: ImagePurpose;
  aspect: Aspect;
  style: ImageStyle;
  prompt: string;
  brief: ImageBrief;
  document: ImageDoc;
  status: 'draft' | 'approved';
  updated_at: string;
  series_id: string | null;
  source_project_id: string | null;
}

const AUTOSAVE_MS = 3000;
type Drag = { kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'; id: string; startX: number; startY: number; start: Layer; startDoc: ImageDoc; moved: boolean };
type SaveResult = { id?: string; updated_at?: string; revision_number?: number; status?: string; error?: string };

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

function layerLabel(l: Layer, e: { kinds: Record<'text' | 'image' | 'shape', string>; roles: Record<string, string> }) {
  if (l.type === 'text') return l.content.split('\n')[0]?.slice(0, 40) || l.name || e.kinds.text;
  // Generated layers are named after their role in English; show the translated role instead.
  if (l.type === 'image' && (!l.name || l.name === l.role)) return e.roles[l.role] ?? e.kinds.image;
  if (l.type === 'shape' && (!l.name || l.name === 'shape')) return e.kinds.shape;
  return l.name;
}

export function ImageEditor({
  project,
  urls: initialUrls,
  canEdit,
  revisions: initialRevisions,
  exports: initialExports,
  brandLogo,
  postId,
}: {
  project: EditorProject;
  urls: Record<string, string>;
  canEdit: boolean;
  revisions: RevisionItem[];
  exports: ExportItem[];
  brandLogo: { id: string; url: string } | null;
  postId: string | null;
}) {
  const { t } = useI18n();
  const e = t.images.editor;
  const toast = useToast();
  const router = useRouter();

  const [hist, setHist] = useState<History<ImageDoc>>(() => createHistory(project.document));
  const doc = hist.present;
  const [title, setTitle] = useState(project.title);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState(project.status);
  const [base, setBase] = useState(project.updated_at);
  const [revisionNumber, setRevisionNumber] = useState<number | null>(initialRevisions[0]?.revision_number ?? null);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify([project.title, project.document]));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [lastSave, setLastSave] = useState<'manual' | 'autosave' | null>(null);
  const [urls, setUrls] = useState(initialUrls);
  const images = useLoadedImages(urls);
  const [exports, setExports] = useState(initialExports);
  const [revisions, setRevisions] = useState(initialRevisions);
  const [dialog, setDialog] = useState<'revisions' | 'preview' | 'export' | 'unapprove' | null>(null);
  const [picker, setPicker] = useState<null | { mode: 'add' | 'replace' | 'logo' }>(null);
  const [busy, setBusy] = useState<'approve' | 'restore' | 'export' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canChange = canEdit && status === 'draft' && !conflict;
  const key = useMemo(() => JSON.stringify([title, doc]), [title, doc]);
  const dirty = key !== savedKey;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty && canChange;
  const layer = doc.layers.find((l) => l.id === selected) ?? null;
  const placeholderLayers = useMemo(() => findPlaceholders(doc), [doc]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // ---------- History ----------
  /** Typing-style edits (merged into bursts). */
  const edit = useCallback((fn: (d: ImageDoc) => ImageDoc) => setHist((h) => pushHistory(h, fn(h.present), Date.now())), []);
  /** Discrete actions: always their own undo step. */
  const act = useCallback((fn: (d: ImageDoc) => ImageDoc) => setHist((h) => pushHistory(h, fn(h.present), Date.now(), false)), []);
  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  // ---------- Save ----------
  const save = useCallback(
    async (source: 'manual' | 'autosave'): Promise<{ updated_at: string; revision_number: number | null } | null> => {
      if (!canChange || savingRef.current) return null;
      savingRef.current = true;
      setSaving(true);
      if (source === 'manual') setSaveError(null);
      const snapshotKey = key;
      const res = await postJson<SaveResult>('/api/images', {
        id: project.id,
        base_updated_at: base,
        title: title.trim() || project.title,
        purpose: project.purpose,
        aspect: project.aspect,
        style: project.style,
        prompt: project.prompt,
        brief: project.brief,
        document: doc,
        source,
        series_id: project.series_id,
        source_project_id: project.source_project_id,
      });
      savingRef.current = false;
      setSaving(false);
      if (!res.ok || !res.body.updated_at) {
        if (res.body.error === 'conflict') setConflict(true);
        const message = imageMessage(t, res.body);
        setSaveError(message);
        if (source === 'manual') toast(message, 'error');
        return null;
      }
      setBase(res.body.updated_at);
      setRevisionNumber(res.body.revision_number ?? null);
      setSavedKey(snapshotKey);
      setSaveError(null);
      setLastSave(source);
      return { updated_at: res.body.updated_at, revision_number: res.body.revision_number ?? null };
    },
    [base, canChange, doc, key, project, t, title, toast],
  );

  // Autosave a few seconds after the last change.
  useEffect(() => {
    if (!dirty || !canChange || saveError) return;
    const timer = window.setTimeout(() => void save('autosave'), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, canChange, key, save, saveError]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const beforeUnload = (ev: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  // ---------- Approval / restore ----------
  async function approve() {
    let current = base;
    if (dirty) {
      const saved = await save('manual');
      if (!saved) return;
      current = saved.updated_at;
    }
    setBusy('approve');
    const res = await postJson<SaveResult>(`/api/images/${project.id}`, { action: 'approve', base_updated_at: current });
    setBusy(null);
    if (!res.ok || !res.body.updated_at) return toast(imageMessage(t, res.body), 'error');
    setStatus('approved');
    setBase(res.body.updated_at);
    setRevisionNumber(res.body.revision_number ?? revisionNumber);
    setSelected(null);
    setDialog(null);
    // State is updated in place: a refresh would remount the editor and close whatever the user opens next.
    toast(t.images.preview.approved, 'success');
  }

  async function unapprove() {
    setBusy('approve');
    const res = await postJson<SaveResult>(`/api/images/${project.id}`, { action: 'unapprove' });
    setBusy(null);
    setDialog(null);
    if (!res.ok || !res.body.updated_at) return toast(imageMessage(t, res.body), 'error');
    setStatus('draft');
    setBase(res.body.updated_at);
    toast(t.images.preview.unapproved, 'success');
  }

  async function restore(rev: RevisionItem) {
    setBusy('restore');
    const res = await postJson<SaveResult>(`/api/images/${project.id}`, { action: 'restore', revision_id: rev.id, base_updated_at: base });
    setBusy(null);
    if (!res.ok || !res.body.updated_at) {
      if (res.body.error === 'conflict') setConflict(true);
      return toast(imageMessage(t, res.body), 'error');
    }
    // The page re-renders with the restored design (the editor remounts on the new version).
    setSavedKey(key);
    setDialog(null);
    toast(fmt(t.images.revisions.restored, { n: rev.revision_number }), 'success');
    router.refresh();
  }

  async function exportImage(format: ImageFormat, scale: 1 | 2, quality: number) {
    setExportError(null);
    let revision = revisionNumber;
    if (dirty && canChange) {
      const saved = await save('manual');
      if (!saved) return;
      revision = saved.revision_number;
    }
    setBusy('export');
    try {
      const blob = await renderToBlob(doc, images, format, scale, quality);
      const w = doc.width * scale;
      const h = doc.height * scale;
      downloadBlob(blob, fileNameFor(title, format, w, h));
      if (canEdit) {
        const saved = await saveExport(project.organization_id, project.id, blob, format, w, h, revision);
        if (!saved.ok) setExportError(imageMessage(t, { error: saved.error }));
        else {
          setExports((x) => [{ id: saved.data.export_id, format, width: w, height: h, size_bytes: blob.size, from_approved: saved.data.from_approved, created_at: new Date().toISOString() }, ...x]);
          toast(fmt(t.images.export.done, { format: t.images.export.formats[format], w, h }), 'success');
        }
      }
    } catch (err) {
      setExportError(err instanceof Error && err.message === 'unsupported' ? fmt(t.images.export.unsupported, { format: t.images.export.formats[format] }) : t.images.errors.render);
    } finally {
      setBusy(null);
    }
  }

  /** Revisions saved since the page loaded are fetched when the history is opened. */
  async function openRevisions() {
    setDialog('revisions');
    const res = await fetch(`/api/images/${project.id}/revisions`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { revisions?: RevisionItem[]; urls?: Record<string, string> } | null;
    if (!res?.ok || !body?.revisions) return;
    setUrls((u) => ({ ...body.urls, ...u }));
    setRevisions(body.revisions);
  }

  // ---------- Adding layers ----------
  const addText = (role: TextRole) => {
    const presets: Record<TextRole, Partial<TextLayer>> = {
      headline: { content: e.defaults.headline, size: 88, weight: 900 },
      body: { content: e.defaults.body, size: 44, weight: 400 },
      price: { content: e.defaults.price, size: 72, weight: 900, color: '#ffffff', background: '#e8553a', padding: 20, radius: 16, w: Math.round(doc.width * 0.4) },
      offer: { content: e.defaults.offer, size: 48, weight: 700, color: '#211e2b', background: '#ffd84d', padding: 16, radius: 12 },
      cta: { content: e.defaults.cta, size: 48, weight: 700, color: '#ffffff', background: '#7157ef', padding: 22, radius: 999, w: Math.round(doc.width * 0.5) },
      caption: { content: e.defaults.body, size: 36, weight: 400 },
    };
    const l = newTextLayer(doc, { role, name: e.roles[role], ...presets[role] });
    if (l.w !== Math.round(doc.width * 0.8)) l.x = Math.round((doc.width - l.w) / 2);
    l.h = Math.round(l.size * l.line_height + l.padding * 2);
    act((d) => addLayer(d, l));
    setSelected(l.id);
  };
  const addImage = (assetId: string, role: ImageLayer['role']) => {
    const l = role === 'logo' ? newImageLayer(doc, assetId, { role, name: e.roles.logo, w: Math.round(doc.width * 0.22), h: Math.round(doc.width * 0.12), x: Math.round(doc.width * 0.05), y: Math.round(doc.height * 0.04) }) : newImageLayer(doc, assetId, { role, name: e.roles[role] });
    act((d) => addLayer(d, l));
    setSelected(l.id);
  };
  const addLogo = () => {
    if (brandLogo) {
      setUrls((u) => ({ ...u, [brandLogo.id]: brandLogo.url }));
      addImage(brandLogo.id, 'logo');
    } else setPicker({ mode: 'logo' });
  };

  // ---------- Canvas interaction ----------
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageWidth(el.clientWidth));
    ro.observe(el);
    setStageWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (canvasRef.current && stageWidth > 0) paint(canvasRef.current, doc, images, stageWidth);
  }, [doc, images, stageWidth]);
  const scale = stageWidth > 0 ? stageWidth / doc.width : 1;

  const toDoc = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  function onPointerDown(ev: React.PointerEvent) {
    if (ev.button !== 0) return;
    const handle = (ev.target as HTMLElement).dataset.handle as Drag['kind'] | undefined;
    const p = toDoc(ev.clientX, ev.clientY);
    let target: Layer | null;
    if (handle && layer) target = layer;
    else {
      target = hitTest(doc, p.x, p.y);
      setSelected(target?.id ?? null);
    }
    if (!target || target.locked || !canChange) return;
    stageRef.current?.setPointerCapture(ev.pointerId);
    drag.current = { kind: handle ?? 'move', id: target.id, startX: p.x, startY: p.y, start: target, startDoc: doc, moved: false };
  }

  function onPointerMove(ev: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toDoc(ev.clientX, ev.clientY);
    const dx = Math.round(p.x - d.startX);
    const dy = Math.round(p.y - d.startY);
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    const s = d.start;
    let patch: Partial<Layer>;
    if (d.kind === 'move') patch = { x: s.x + dx, y: s.y + dy };
    else {
      const west = d.kind === 'nw' || d.kind === 'sw';
      const north = d.kind === 'nw' || d.kind === 'ne';
      let w = Math.max(16, s.w + (west ? -dx : dx));
      let h = Math.max(16, s.h + (north ? -dy : dy));
      if (ev.shiftKey || s.type === 'image') {
        // Images keep their proportions (hold Shift to keep them for text and shapes too).
        const ratio = s.w / s.h;
        if (w / h > ratio) h = Math.round(w / ratio);
        else w = Math.round(h * ratio);
      }
      patch = { w, h, x: west ? s.x + s.w - w : s.x, y: north ? s.y + s.h - h : s.y };
    }
    const next = updateLayer(d.startDoc, d.id, patch);
    // The first movement records one undo step; the rest of the drag updates that same step.
    setHist((h) => (d.moved ? replacePresent(h, next) : pushHistory(h, next, Date.now(), false)));
    d.moved = true;
  }

  function onPointerUp(ev: React.PointerEvent) {
    if (drag.current) stageRef.current?.releasePointerCapture(ev.pointerId);
    drag.current = null;
  }

  // Keyboard: undo/redo, nudge, delete, duplicate (not while typing in a field).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (isTyping(ev.target) || document.querySelector('dialog[open]')) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        doRedo();
        return;
      }
      if (!selected || !canChange) return;
      const step = ev.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const mv = moves[ev.key];
      if (mv) {
        ev.preventDefault();
        edit((d) => {
          const l = d.layers.find((x) => x.id === selected);
          return l ? updateLayer(d, selected, { x: l.x + mv[0], y: l.y + mv[1] }) : d;
        });
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        act((d) => removeLayer(d, selected));
        setSelected(null);
      } else if (mod && ev.key.toLowerCase() === 'd') {
        ev.preventDefault();
        act((d) => duplicateLayer(d, selected));
      } else if (ev.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, canChange, doRedo, doUndo, edit, selected]);

  const box = layer && stageWidth > 0 ? { left: layer.x * scale, top: layer.y * scale, width: layer.w * scale, height: layer.h * scale, transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined } : null;
  const approved = status === 'approved';
  const statusText = conflict ? e.conflictShort : saving ? t.common.saving : dirty ? e.unsaved : lastSave === 'autosave' ? e.autosaved : lastSave ? e.saved : null;

  return (
    <div className="image-editor stack">
      {postId && (
        <Link className="eyebrow" href={`/app/posts/${postId}`} prefetch={false}>
          ← {e.backToPost}
        </Link>
      )}
      <div className="editor-bar panel">
        <div className="editor-title">
          <label className="sr-only" htmlFor="image-title">
            {t.images.create.name}
          </label>
          <input id="image-title" className="input input-sm title-input" maxLength={200} value={title} disabled={!canChange} onChange={(ev) => setTitle(ev.target.value)} dir="auto" />
          <span className={`badge ${approved ? 'badge-success' : 'badge-info'}`} data-testid="image-status">
            {approved ? t.images.approved : t.images.draft}
          </span>
          {doc.meta.generator === 'mock-layout-v1' && <span className="badge badge-warning plain">{t.images.mockBadge}</span>}
        </div>
        <div className="row editor-actions">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={doUndo} disabled={!canChange || hist.past.length === 0} aria-label={e.undo} title={e.undo} data-testid="undo">
            <Icon name="restore" />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={doRedo} disabled={!canChange || hist.future.length === 0} aria-label={e.redo} title={e.redo} data-testid="redo">
            <Icon name="restore" style={{ transform: 'scaleX(-1)' }} />
          </button>
          {statusText && (
            <span className="xsmall muted" role="status" data-testid="save-status">
              {statusText}
            </span>
          )}
          <span className="spacer" />
          {canChange && (
            <button type="button" className="btn btn-sm" onClick={() => void save('manual')} disabled={saving || !dirty}>
              <Icon name="save" />
              {e.save}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void openRevisions()}>
            <Icon name="clock" />
            {t.images.revisions.title}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDialog('preview')}>
            <Icon name="play" />
            {e.preview}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDialog('export')}>
            <Icon name="download" />
            {e.export}
          </button>
          {canEdit && !approved && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('preview')} disabled={conflict}>
              <Icon name="check" />
              {e.approve}
            </button>
          )}
          {canEdit && approved && (
            <button type="button" className="btn btn-sm" onClick={() => setDialog('unapprove')}>
              <Icon name="lock" />
              {e.removeApproval}
            </button>
          )}
        </div>
      </div>

      {conflict && (
        <div className="callout callout-danger" role="alert">
          <Icon name="alert" />
          <div className="row">
            <span>{e.conflict}</span>
            <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
              {e.reload}
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <p className="callout callout-danger small" role="alert">
          {saveError}
        </p>
      )}
      {approved && (
        <p className="callout callout-success small" data-testid="approved-note">
          <Icon name="check" />
          <span>{e.locked}</span>
        </p>
      )}
      {!canEdit && <p className="callout small">{e.readOnly}</p>}
      {placeholderLayers.length > 0 && !approved && (
        <div className="callout callout-warning small" data-testid="placeholder-warning">
          <Icon name="alert" />
          <div className="row">
            <span>{fmt(e.placeholders, { n: placeholderLayers.length })}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setSelected(placeholderLayers[0]!.id);
                window.setTimeout(() => textRef.current?.focus(), 50);
              }}
            >
              {e.placeholderFix}
            </button>
          </div>
        </div>
      )}
      {doc.meta.characters && doc.meta.characters.length > 0 && (
        <p className="callout small" data-testid="character-meta">
          <Icon name="users" />
          <span dir="auto">
            {e.characterMeta}: {doc.meta.characters.map((c) => `${c.name} (${(t.images.referenceStatus as Record<string, string>)[c.reference_status] ?? c.reference_status})`).join(', ')}
          </span>
        </p>
      )}

      <div className="editor-grid">
        <div className="editor-stage-wrap">
          <div className="editor-stage-frame" style={{ maxWidth: doc.height > doc.width ? `${Math.round((doc.width / doc.height) * 640)}px` : undefined }}>
            <div
              ref={stageRef}
              className="editor-stage"
              style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => layer?.type === 'text' && textRef.current?.focus()}
              data-testid="editor-stage"
            >
              <canvas ref={canvasRef} role="img" aria-label={title} />
              {box && (
                <div className={`sel-box${layer?.locked ? ' locked' : ''}`} style={box} data-testid="selection">
                  {canChange &&
                    !layer?.locked &&
                    (['nw', 'ne', 'sw', 'se'] as const).map((h) => <span key={h} className={`sel-handle ${h}`} data-handle={h} aria-hidden="true" />)}
                </div>
              )}
            </div>
          </div>
          <p className="xsmall muted">{e.keyboard}</p>
        </div>

        <aside className="editor-side panel panel-pad stack" aria-label={e.layers}>
          {canChange && (
            <div className="stack-sm">
              <h3 className="section-title">{e.add}</h3>
              <div className="add-grid">
                <button type="button" className="btn btn-sm" onClick={() => addText('headline')}>
                  <Icon name="text" />
                  {e.addHeadline}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => addText('body')}>
                  <Icon name="text" />
                  {e.addText}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => addText('price')}>
                  <Icon name="card" />
                  {e.addPrice}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => addText('offer')}>
                  <Icon name="sparkle" />
                  {e.addOffer}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => addText('cta')}>
                  <Icon name="arrowRight" className="flip-rtl" />
                  {e.addCta}
                </button>
                <button type="button" className="btn btn-sm" onClick={addLogo}>
                  <Icon name="store" />
                  {e.addLogo}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setPicker({ mode: 'add' })}>
                  <Icon name="image" />
                  {e.addImage}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const l = newShapeLayer(doc);
                    act((d) => addLayer(d, l));
                    setSelected(l.id);
                  }}
                >
                  <Icon name="box" />
                  {e.addShape}
                </button>
              </div>
            </div>
          )}

          <div className="stack-sm">
            <h3 className="section-title">{e.layers}</h3>
            <ol className="layer-list" data-testid="layer-list">
              {[...doc.layers].reverse().map((l) => (
                <li key={l.id} className={`layer-row${l.id === selected ? ' is-selected' : ''}${l.visible ? '' : ' is-hidden'}`}>
                  <button type="button" className="layer-name" onClick={() => setSelected(l.id)} aria-pressed={l.id === selected} dir="auto">
                    <Icon name={l.type === 'text' ? 'text' : l.type === 'image' ? 'image' : 'box'} size={14} />
                    <span>{layerLabel(l, e)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    disabled={!canChange}
                    onClick={() => act((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) }))}
                    aria-label={`${l.visible ? e.hide : e.show}: ${layerLabel(l, e)}`}
                    title={l.visible ? e.hide : e.show}
                  >
                    <Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    disabled={!canChange}
                    onClick={() => act((d) => setLocked(d, l.id, !l.locked))}
                    aria-label={`${l.locked ? e.unlock : e.lock}: ${layerLabel(l, e)}`}
                    aria-pressed={l.locked}
                    title={l.locked ? e.unlock : e.lock}
                  >
                    <Icon name="lock" size={14} className={l.locked ? '' : 'faint'} />
                  </button>
                </li>
              ))}
            </ol>
            {doc.layers.length === 0 && <p className="xsmall muted">{e.noLayers}</p>}
          </div>

          {layer ? (
            <div className="stack-sm">
              <div className="row">
                <h3 className="section-title">{e.properties}</h3>
                <span className="spacer" />
                <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={!canChange || layer.locked} onClick={() => act((d) => reorderLayer(d, layer.id, 1))} aria-label={e.forward} title={e.forward}>
                  <Icon name="chevronUp" />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={!canChange || layer.locked} onClick={() => act((d) => reorderLayer(d, layer.id, -1))} aria-label={e.backward} title={e.backward}>
                  <Icon name="chevronDown" />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={!canChange} onClick={() => act((d) => duplicateLayer(d, layer.id))} aria-label={t.common.duplicate} title={t.common.duplicate}>
                  <Icon name="copy" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  disabled={!canChange || layer.locked}
                  onClick={() => {
                    act((d) => removeLayer(d, layer.id));
                    setSelected(null);
                  }}
                  aria-label={t.common.delete}
                  title={t.common.delete}
                >
                  <Icon name="trash" />
                </button>
              </div>
              <LayerProps layer={layer} docSize={doc} disabled={!canChange} onPatch={(patch) => edit((d) => updateLayer(d, layer.id, patch))} onReplaceImage={() => setPicker({ mode: 'replace' })} textRef={textRef} />
            </div>
          ) : (
            <p className="xsmall muted">{e.noSelection}</p>
          )}

          <BackgroundProps background={doc.background} disabled={!canChange} onChange={(b: Background) => edit((d) => ({ ...d, background: b }))} />
        </aside>
      </div>

      <RevisionsDialog open={dialog === 'revisions'} revisions={revisions} images={images} canRestore={canChange} busy={busy === 'restore'} onRestore={(r) => void restore(r)} onClose={() => setDialog(null)} />
      <PreviewDialog
        open={dialog === 'preview'}
        doc={doc}
        images={images}
        title={title}
        placeholders={placeholderLayers}
        approved={approved}
        canApprove={canEdit && !conflict}
        busy={busy === 'approve' || saving}
        onApprove={() => void approve()}
        onClose={() => setDialog(null)}
      />
      <ExportDialog open={dialog === 'export'} doc={doc} exports={exports} busy={busy === 'export'} error={exportError} onExport={(f, s, q) => void exportImage(f, s, q)} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'unapprove'}
        title={e.removeApproval}
        body={e.unapproveBody}
        confirmLabel={e.removeApproval}
        busy={busy === 'approve'}
        onConfirm={() => void unapprove()}
        onClose={() => setDialog(null)}
      />
      <AssetPicker
        open={picker !== null}
        selected={[]}
        max={1}
        filter={(a) => a.media_type === 'image'}
        onClose={(ids, assets) => {
          const mode = picker?.mode;
          setPicker(null);
          const id = ids?.[0];
          const asset = assets.find((a) => a.id === id);
          if (!id || !asset?.url) return;
          setUrls((u) => ({ ...u, [id]: asset.url! }));
          if (mode === 'replace' && layer?.type === 'image') edit((d) => updateLayer(d, layer.id, { asset_id: id, crop: null } as Partial<ImageLayer>));
          else addImage(id, mode === 'logo' ? 'logo' : 'photo');
        }}
      />
    </div>
  );
}
