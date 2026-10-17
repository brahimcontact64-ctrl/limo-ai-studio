'use client';
import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { renderDoc, type Ctx2D, type LoadedImage } from '@/lib/images/render';
import { FORMAT_EXT, FORMAT_MIME, type ImageFormat } from '@/lib/images/formats';
import type { ImageDoc } from '@/lib/images/types';

/**
 * Loads workspace images from signed URLs. crossOrigin="anonymous" keeps the canvas exportable
 * (storage answers with CORS headers); an image that fails to load is simply absent and the renderer
 * draws a neutral box in its place.
 */
export function useLoadedImages(urls: Record<string, string>): ReadonlyMap<string, LoadedImage> {
  const [images, setImages] = useState<ReadonlyMap<string, LoadedImage>>(() => new Map());
  const key = Object.keys(urls).sort().join(',');
  useEffect(() => {
    let alive = true;
    for (const [id, url] of Object.entries(urls)) {
      if (images.has(id)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        if (!alive) return;
        setImages((prev) => new Map(prev).set(id, { source: img, width: img.naturalWidth, height: img.naturalHeight }));
      };
      img.src = url;
    }
    return () => {
      alive = false;
    };
    // Only newly added ids are loaded; urls of known ids do not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return images;
}

/** Draws `doc` into `canvas` so it fills `cssWidth` CSS pixels (sharp on high-density screens). */
export function paint(canvas: HTMLCanvasElement, doc: ImageDoc, images: ReadonlyMap<string, LoadedImage>, cssWidth: number) {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const scale = (cssWidth / doc.width) * dpr;
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  renderDoc(ctx as unknown as Ctx2D, doc, images, scale);
}

/**
 * Renders the document at `scale` (1 = design size) into a real image file. Rejects when the browser
 * silently substitutes another format (e.g. no WebP encoder) so the user never gets a mislabelled file.
 */
export async function renderToBlob(doc: ImageDoc, images: ReadonlyMap<string, LoadedImage>, format: ImageFormat, scale: 1 | 2, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width * scale;
  canvas.height = doc.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render');
  if (format === 'jpeg') {
    // JPEG has no transparency: start from white instead of black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  renderDoc(ctx as unknown as Ctx2D, doc, images, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, FORMAT_MIME[format], format === 'png' ? undefined : quality));
  if (!blob) throw new Error('render');
  if (blob.type !== FORMAT_MIME[format]) throw new Error('unsupported');
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const fileNameFor = (title: string, format: ImageFormat, w: number, h: number) =>
  `${(title.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image').toLowerCase()}-${w}x${h}.${FORMAT_EXT[format]}`;

export interface SavedExport {
  export_id: string;
  media_asset_id: string;
  from_approved: boolean;
}

/** Uploads an export to workspace-assets/<org>/exports/ and registers it (the server re-reads the bytes). */
export async function saveExport(
  organizationId: string,
  projectId: string,
  blob: Blob,
  format: ImageFormat,
  width: number,
  height: number,
  revisionNumber: number | null,
): Promise<{ ok: true; data: SavedExport } | { ok: false; error: string }> {
  const path = `${organizationId}/exports/${crypto.randomUUID()}.${FORMAT_EXT[format]}`;
  const up = await getSupabaseBrowser().storage.from('workspace-assets').upload(path, blob, { contentType: FORMAT_MIME[format], upsert: false });
  if (up.error) return { ok: false, error: 'upload' };
  const res = await fetch(`/api/images/${projectId}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object_path: path, format, width, height, revision_number: revisionNumber }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) as Partial<SavedExport> & { error?: string };
  if (!res?.ok || !body.media_asset_id) {
    // Best effort: do not leave an unregistered file behind.
    await getSupabaseBrowser().storage.from('workspace-assets').remove([path]).catch(() => null);
    return { ok: false, error: body.error ?? 'upload' };
  }
  return { ok: true, data: body as SavedExport };
}
