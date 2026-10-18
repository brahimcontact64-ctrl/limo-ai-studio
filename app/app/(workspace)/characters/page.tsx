import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { customAsRecords, listCustomCharacters } from '@/lib/data/characters';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { CharacterLibrary } from '@/components/characters/CharacterLibrary';
import { CustomCharacters } from '@/components/characters/CustomCharacters';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.characters.title };
}

export default async function CharactersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const tab = (await searchParams).tab === 'custom' ? 'custom' : 'library';
  const catalogs = await getCatalogs();
  const approved = catalogs.characters.filter((c) => c.reference_status === 'approved').length;
  const custom = ctx.org && tab === 'custom' ? await listCustomCharacters(await getSupabaseServer(), ctx.org.organization_id) : [];

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>{t.characters.title}</h1>
          <p>{t.characters.lead}</p>
        </div>
        <span className="badge badge-warning mono ltr" data-testid="approved-count">
          {approved}/{catalogs.characters.length} · {t.characters.reference.approved}
        </span>
      </div>
      <nav className="tabs admin-tabs" aria-label={t.characters.title} style={{ marginBottom: 24 }}>
        <Link className="tab" href="/app/characters" aria-current={tab === 'library' ? 'page' : undefined}>
          {t.characters.title}
        </Link>
        <Link className="tab" href="/app/characters?tab=custom" aria-current={tab === 'custom' ? 'page' : undefined}>
          {t.characters.custom.title}
        </Link>
      </nav>
      {tab === 'custom' ? (
        <CustomCharacters rows={custom} records={customAsRecords(custom)} canEdit={ctx.canEdit} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
