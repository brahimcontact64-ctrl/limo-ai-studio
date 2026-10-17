'use client';
import { useEffect, useRef, useState } from 'react';
import type { LoadedImage } from '@/lib/images/render';
import type { ImageDoc } from '@/lib/images/types';
import { paint } from './canvas';

/** Read-only rendering of a design that fills the width of its container. */
export function DocPreview({ doc, images, label, className }: { doc: ImageDoc; images: ReadonlyMap<string, LoadedImage>; label: string; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (canvas.current && width > 0) paint(canvas.current, doc, images, width);
  }, [doc, images, width]);
  return (
    <div ref={wrap} className={`doc-preview ${className ?? ''}`} style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
