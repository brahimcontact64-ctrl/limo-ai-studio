import type { Metadata } from 'next';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { getI18n } from '@/lib/i18n/server';
import { CharacterLibrary } from '@/components/characters/CharacterLibrary';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.characters.title };
}

export default async function CharactersPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const catalogs = await getCatalogs();
  const approved = catalogs.characters.filter((c) => c.reference_status === 'approved').length;

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>{t.characters.title}</h1>
          <p>{t.characters.lead}</p>
        </div>
        <span className="badge badge-warning mono ltr">
          {approved}/{catalogs.characters.length} · {t.characters.reference.approved}
        </span>
      </div>
      <div className="callout" style={{ marginBottom: 24 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5h.01" />
        </svg>
        <div>
          <strong>{t.characters.referencesTitle}</strong>
          {t.characters.referencesBody}
        </div>
      </div>
      {catalogs.characters.length === 0 ? (
        <p className="callout callout-danger">{t.characters.catalogUnavailable}</p>
      ) : (
        <CharacterLibrary characters={catalogs.characters} canCreate={ctx.canEdit} />
      )}
    </div>
  );
}
