import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppContext } from '@/lib/data/context';
import { loadProject } from '@/lib/data/projects';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { factsFromBrief } from '@/lib/social/compose';
import { POST_LANGUAGES, type BusinessType, type PostLanguage } from '@/lib/social/types';
import { Composer, type ComposerPrefill } from '@/components/social/Composer';
import { loadComposerData } from '@/components/posts/loadComposer';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.posts.newPost };
}

const BUSINESS: Record<string, BusinessType> = { product_ad: 'retail', business_promo: 'services', social_post: 'other', social_video: 'creator', story: 'storytelling', explainer: 'education', ugc_ad: 'retail', custom: 'other' };

/** New post. ?project=<studio project> starts from its brief (facts, language) — product brief → post without leaving the app. */
export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const ctx = await requireAppContext();
  if (!ctx.org || !ctx.canEdit) redirect('/app/posts');
  const { t, locale } = await getI18n();
  const supabase = await getSupabaseServer();
  const q = await searchParams;
  let prefill: ComposerPrefill | null = null;
  let title = '';
  let sourceProject: string | null = null;
  let language: PostLanguage = (POST_LANGUAGES as readonly string[]).includes(locale) ? (locale as PostLanguage) : 'en';
  if (q.project && isUuid(q.project)) {
    const project = await loadProject(supabase, q.project);
    if (project && project.organization_id === ctx.org.organization_id) {
      const d = project.draft;
      const brief = d.creation_brief as Record<string, unknown>;
      prefill = { prompt: [d.title, typeof brief.productDescription === 'string' ? brief.productDescription : d.brief].filter(Boolean).join('. '), facts: factsFromBrief(brief), business: BUSINESS[d.creation_mode] ?? 'other' };
      title = d.title;
      sourceProject = q.project;
      if ((POST_LANGUAGES as readonly string[]).includes(d.language_code)) language = d.language_code as PostLanguage;
    }
  }
  const data = await loadComposerData(supabase, ctx.org.organization_id, ctx.org.name, null);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/posts">
            {t.posts.title}
          </Link>
          <h1>{t.posts.newPost}</h1>
        </div>
      </div>
      <Composer
        organizationId={ctx.org.organization_id}
        post={{
          id: null, title, caption: '', headline: '', cta: '', hashtags: [], language_code: language, tone: 'friendly', media_kind: 'image', image_project_id: null, media_asset_id: null,
          render_job_id: null, source_project_id: sourceProject, origin: 'manual', status: 'draft', updated_at: null, page_id: null, scheduled_at: null, timezone: null, published_at: null,
          external_post_id: null, simulated: false, last_error: null, review_note: null, automation_policy_version: null,
        }}
        designs={data.designs}
        urls={data.urls}
        videos={data.videos}
        mediaUrl={null}
        pages={data.pages}
        paused={data.paused}
        pageName={data.pageName}
        canEdit
        prefill={prefill}
      />
    </div>
  );
}
