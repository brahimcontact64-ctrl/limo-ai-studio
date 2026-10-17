import type { Metadata } from 'next';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { emptyProject } from '@/lib/studio/draft';
import { isCastVariantId } from '@/lib/studio/limits';
import { StudioEditor } from '@/components/studio/StudioEditor';
import { customAsRecords, listCustomCharacters } from '@/lib/data/characters';
import { getSupabaseServer } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.newProject };
}

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ cast?: string }> }) {
  const ctx = await requireAppContext();
  const { locale, t } = await getI18n();
  const catalogs = await getCatalogs();
  if (!catalogs.ok) {
    return (
      <div className="content-inner">
        <p className="callout callout-danger">{t.characters.catalogUnavailable}</p>
      </div>
    );
  }
  const languageCodes = catalogs.languages.map((l) => l.code);
  const draft = emptyProject({
    content_type: catalogs.contentTypes.find((c) => c.code === 'storytelling')?.code ?? catalogs.contentTypes[0]?.code ?? '',
    language_code: languageCodes.includes(locale) ? locale : (languageCodes[0] ?? 'en'),
    export_presets: catalogs.exportPresets.some((p) => p.code === 'vertical_9_16') ? ['vertical_9_16'] : [],
  });
  // Optional pre-selected cast from the character library (?cast=limo_boy,nova_girl).
  const preset = ((await searchParams).cast ?? '').split(',').filter((id) => isCastVariantId(id) && catalogs.characters.some((c) => c.id === id));
  draft.cast = [...new Set(preset)].slice(0, 18);

  const custom = ctx.org ? customAsRecords(await listCustomCharacters(await getSupabaseServer(), ctx.org.organization_id)) : [];

  return (
    <StudioEditor
      initialDraft={draft}
      status="draft"
      updatedAt={null}
      catalogs={{ contentTypes: catalogs.contentTypes, languages: catalogs.languages, exportPresets: catalogs.exportPresets, characters: [...catalogs.characters, ...custom] }}
      canEdit={ctx.canEdit}
      subscriptionActive={ctx.subscriptionActive}
    />
  );
}
