'use client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/client';
import type { ImageDoc, ImagePurpose } from '@/lib/images/types';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { DocPreview } from './DocPreview';
import { useLoadedImages } from './canvas';

export interface ImageGridItem {
  id: string;
  title: string;
  purpose: ImagePurpose;
  status: 'draft' | 'approved';
  updated_at: string;
  document: ImageDoc;
}

/** Image projects as rendered thumbnails (drawn from the design, so they always match the editor). */
export function ImageGrid({ items, urls, linkSuffix = '' }: { items: ImageGridItem[]; urls: Record<string, string>; linkSuffix?: string }) {
  const { t } = useI18n();
  const images = useLoadedImages(urls);
  return (
    <ul className="image-grid" data-testid="image-grid">
      {items.map((p) => (
        <li key={p.id}>
          <Link className="image-card panel" href={`/app/images/${p.id}${linkSuffix}`} prefetch={false}>
            <span className="image-card-thumb">
              <DocPreview doc={p.document} images={images} label={p.title} />
            </span>
            <span className="image-card-body">
              <b dir="auto">{p.title}</b>
              <span className="row xsmall muted">
                <span className={`badge ${p.status === 'approved' ? 'badge-success' : 'badge-info'}`}>{p.status === 'approved' ? t.images.approved : t.images.draft}</span>
                <span>{t.images.purposes[p.purpose]}</span>
                {p.document.meta.generator === 'mock-layout-v1' && <span>· {t.images.mockShort}</span>}
              </span>
              <span className="xsmall muted">
                <RelativeTime iso={p.updated_at} template={t.common.updated} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
