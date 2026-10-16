'use client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { ASSET_EXTENSIONS, ASSET_MAX_BYTES } from '@/lib/assets/files';

export type UploadError = 'too_large' | 'type_not_allowed' | 'upload_failed' | 'unavailable';

async function mediaInfo(file: File): Promise<{ width?: number; height?: number; duration_ms?: number }> {
  try {
    if (file.type.startsWith('image/')) {
      const bmp = await createImageBitmap(file);
      const info = { width: bmp.width, height: bmp.height };
      bmp.close();
      return info;
    }
    if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio') as HTMLVideoElement;
      el.preload = 'metadata';
      el.src = url;
      await new Promise<void>((resolve) => {
        el.onloadedmetadata = () => resolve();
        el.onerror = () => resolve();
        window.setTimeout(resolve, 5000);
      });
      URL.revokeObjectURL(url);
      return {
        duration_ms: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined,
        width: el.videoWidth || undefined,
        height: el.videoHeight || undefined,
      };
    }
  } catch {
    /* metadata is best effort */
  }
  return {};
}

/** Uploads one file to workspace-assets/<org>/<uuid>.<ext> and registers it. Returns the new asset id. */
export async function uploadAsset(organizationId: string, file: File, kind: string): Promise<{ id: string } | { error: UploadError }> {
  const ext = ASSET_EXTENSIONS[file.type];
  if (!ext) return { error: 'type_not_allowed' };
  if (file.size > ASSET_MAX_BYTES) return { error: 'too_large' };
  const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
  const info = await mediaInfo(file);
  const { error: upErr } = await getSupabaseBrowser().storage.from('workspace-assets').upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: /bucket not found/i.test(upErr.message) ? 'unavailable' : 'upload_failed' };
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object_path: path, kind, mime_type: file.type, size_bytes: file.size, file_name: file.name, ...info }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) as { asset_id?: string; error?: string } | undefined;
  if (!res?.ok || !body?.asset_id) return { error: body?.error === 'unavailable' ? 'unavailable' : 'upload_failed' };
  return { id: body.asset_id };
}
