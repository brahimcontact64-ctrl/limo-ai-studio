import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { isCreationMode } from '@/lib/create/modes';
import { CreateForm } from '@/components/create/CreateForm';

type Params = { params: Promise<{ mode: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t } = await getI18n();
  const { mode } = await params;
  return {
    title: isCreationMode(mode) ? t.create.modes[mode].name : t.nav.create,
  };
}

export default async function CreateModePage({ params }: Params) {
  const { mode } = await params;
  if (!isCreationMode(mode)) notFound();
  if (mode === 'story') redirect('/app/projects/new');
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
  const codes = catalogs.languages.map((l) => l.code);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{t.nav.create}</p>
          <h1>{t.create.modes[mode].name}</h1>
          <p>{t.create.modes[mode].body}</p>
        </div>
      </div>
      {!ctx.canEdit ? (
        <p className="callout callout-warning">{t.app.viewerReadOnly}</p>
      ) : (
        <CreateForm
          mode={mode}
          languages={catalogs.languages}
          exportPresets={catalogs.exportPresets}
          contentTypes={catalogs.contentTypes}
          defaultLanguage={codes.includes(locale) ? locale : (codes[0] ?? 'en')}
        />
      )}
    </div>
  );
}
