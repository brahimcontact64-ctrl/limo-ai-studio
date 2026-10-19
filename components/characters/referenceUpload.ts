'use client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { mimeAllowedFor, referenceMime, REFERENCE_EXT, REFERENCE_MAX_BYTES, type AssetKind } from '@/lib/characters/references';

export interface ReferenceUploadInput {
  characterId: string;
  uploadPrefix: string;
  file: File;
  kind: AssetKind;
  view: string | null;
  expression: string | null;
  outfit: string | null;
  /** Approved scene variant the file belongs to (its own expression/outfit keys are allowed only with it). */
  variantId?: string | null;
  provenance: string;
  note: string;
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) return {};
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return {};
  }
}

/** Uploads to character-library/<prefix><uuid>.<ext> (storage policies check the folder), then registers it for review. */
export async function uploadReference(input: ReferenceUploadInput): Promise<{ id: string } | { error: string }> {
  const mime = referenceMime(input.file);
  if (!mimeAllowedFor(input.kind, mime)) return { error: 'type_not_allowed' };
  if (input.file.size > REFERENCE_MAX_BYTES) return { error: 'too_large' };
  const path = `${input.uploadPrefix}${crypto.randomUUID()}.${REFERENCE_EXT[mime] ?? 'bin'}`;
  const { error: upErr } = await getSupabaseBrowser().storage.from('character-library').upload(path, input.file, { contentType: mime, upsert: false });
  if (upErr) return { error: 'upload_failed' };
  const res = await fetch(`/api/characters/${encodeURIComponent(input.characterId)}/references`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object_path: path,
      asset_kind: input.kind,
      view: input.view,
      expression_key: input.expression,
      outfit_key: input.outfit,
      ...(input.variantId ? { variant_id: input.variantId } : {}),
      mime_type: mime,
      size_bytes: input.file.size,
      provenance: input.provenance,
      provenance_note: input.note,
      ...(await imageSize(input.file)),
    }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) as { asset_id?: string; error?: string } | undefined;
  if (!res?.ok || !body?.asset_id) return { error: body?.error ?? 'upload_failed' };
  return { id: body.asset_id };
}
