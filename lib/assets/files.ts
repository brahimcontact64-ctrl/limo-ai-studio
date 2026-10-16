/** Upload rules for the workspace-assets bucket (mirrors the bucket's allowed types and 100 MB limit). */
export const ASSET_MAX_BYTES = 100 * 1024 * 1024;

export const ASSET_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
};
export const ASSET_MIME_TYPES: ReadonlySet<string> = new Set(Object.keys(ASSET_EXTENSIONS));

export function defaultKindFor(mime: string): 'photo' | 'video' | 'audio' {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'photo';
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
