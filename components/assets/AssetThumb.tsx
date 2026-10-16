'use client';
import { Icon } from '@/components/ui/Icon';

export interface ClientAsset {
  id: string;
  kind: string;
  media_type: 'image' | 'video' | 'audio' | 'other';
  file_name: string;
  label: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
  url: string | null;
}

export function AssetThumb({ asset, size = 'md' }: { asset: ClientAsset; size?: 'sm' | 'md' }) {
  const cls = `asset-thumb ${size}`;
  if (asset.media_type === 'image' && asset.url) {
    return (
      <span className={cls}>
        <img src={asset.url} alt={asset.label ?? asset.file_name} loading="lazy" />
      </span>
    );
  }
  if (asset.media_type === 'video' && asset.url) {
    return (
      <span className={cls}>
        <video src={`${asset.url}#t=0.1`} muted playsInline preload="metadata" aria-label={asset.label ?? asset.file_name} />
        <span className="asset-badge">
          <Icon name="play" size={12} />
        </span>
      </span>
    );
  }
  return (
    <span className={`${cls} asset-icon`} aria-label={asset.label ?? asset.file_name}>
      <Icon name={asset.media_type === 'audio' ? 'sparkle' : 'layers'} size={22} />
    </span>
  );
}
