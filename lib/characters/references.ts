import { REQUIRED_VIEWS, REFERENCE_VIEWS, type ReferenceView } from './canon.ts';

export type AssetKind = 'rendered_reference' | 'rigged_model' | 'turntable_video';
export type ReferenceStatus = 'pending_review' | 'approved' | 'rejected' | 'superseded';

export interface ReferenceAsset {
  id: string;
  asset_kind: AssetKind;
  view: ReferenceView | null;
  expression_key: string | null;
  outfit_key: string | null;
  /** Approved scene variant the file belongs to (never counts as a canonical view). */
  variant_id?: string | null;
  spec_version: number;
  status: ReferenceStatus;
  mime_type: string;
  provenance: string;
  provenance_note?: string | null;
  review_note?: string | null;
  created_at: string;
  size_bytes?: number;
  width?: number | null;
  height?: number | null;
  model_meta?: Record<string, unknown>;
  /** Short-lived signed URL (only for files the viewer may read). */
  url?: string | null;
}

export type SlotState = 'approved' | 'pending_review' | 'missing';
export interface ViewSlot {
  view: ReferenceView;
  required: boolean;
  state: SlotState;
  asset: ReferenceAsset | null;
}

/** View slots for the current spec version: the approved image wins, then the newest pending one. */
export function viewSlots(assets: ReferenceAsset[], specVersion: number | null): ViewSlot[] {
  return REFERENCE_VIEWS.map((view) => {
    const mine = assets.filter((a) => a.asset_kind === 'rendered_reference' && a.view === view && !a.expression_key && !a.outfit_key && !a.variant_id && a.spec_version === specVersion);
    const approved = mine.find((a) => a.status === 'approved') ?? null;
    const pending = mine.filter((a) => a.status === 'pending_review').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    return {
      view,
      required: (REQUIRED_VIEWS as readonly string[]).includes(view),
      state: approved ? 'approved' : pending ? 'pending_review' : 'missing',
      asset: approved ?? pending,
    };
  });
}

/** Mirrors limo_refresh_reference_status: ready only when the spec is approved and all required views are approved. */
export function referenceReadiness(slots: ViewSlot[], specApproved: boolean): 'approved' | 'in_review' | 'pending' {
  const required = slots.filter((s) => s.required);
  if (specApproved && required.every((s) => s.state === 'approved')) return 'approved';
  return slots.some((s) => s.state === 'pending_review') ? 'in_review' : 'pending';
}

export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MODEL_MIME = ['model/gltf-binary', 'model/gltf+json', 'application/octet-stream'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/webm'] as const;

/** File extension per type; .fbx files arrive as application/octet-stream. */
export const REFERENCE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'application/octet-stream': 'fbx',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
export const REFERENCE_MAX_BYTES = 100 * 1024 * 1024;

/** Which file types each kind accepts: a rendered image is never accepted as a rigged model, and vice versa. */
export function mimeAllowedFor(kind: AssetKind, mime: string): boolean {
  if (kind === 'rendered_reference') return (IMAGE_MIME as readonly string[]).includes(mime);
  if (kind === 'rigged_model') return (MODEL_MIME as readonly string[]).includes(mime);
  return (VIDEO_MIME as readonly string[]).includes(mime);
}

/** Model files are often reported without a type by the browser; infer it from the extension. */
export function referenceMime(file: { name: string; type: string }): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'glb') return 'model/gltf-binary';
  if (ext === 'gltf') return 'model/gltf+json';
  if (ext === 'fbx') return 'application/octet-stream';
  return file.type || 'application/octet-stream';
}

/** Every item must be confirmed by the reviewer before approval (enforced again in the database). */
export const REVIEW_CHECKLIST: Record<AssetKind, string[]> = {
  rendered_reference: ['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'view_correct', 'no_text_or_watermark'],
  rigged_model: ['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'rig_checked'],
  turntable_video: ['identity_matches_spec', 'proportions_match', 'palette_matches', 'family_friendly', 'view_correct', 'no_text_or_watermark'],
};
