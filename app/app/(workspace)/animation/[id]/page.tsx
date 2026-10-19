import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { StoryboardEditor } from '@/components/animation/StoryboardEditor';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.animation.title };
}

/** Storyboard editor of one animation project (data loaded client-side through /api/animation/[id]). */
export default async function AnimationProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireAppContext();
  const catalogs = await getCatalogs();
  const names = Object.fromEntries(catalogs.characters.map((c) => [c.id, c.name]));
  return (
    <div className="content-inner">
      <StoryboardEditor projectId={id} names={names} />
    </div>
  );
}
