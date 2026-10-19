/**
 * Clean internal DEMO workspace for truthful screen captures (Flagship #1 shots 4–5). LOCAL stack only.
 *   * one dedicated demo account (no test account, no personal data), profile "LIMO Démo"
 *   * workspace "LIMO — مساحة عرض توضيحية" with a clearly labelled SAMPLE brand (« مثال ») — not a real business
 *   * a SIMULATED Facebook Page (real Meta publishing is disabled; the UI marks it "simulated")
 *   * four approved sample posts scheduled this month on that simulated Page (nothing is ever sent to Facebook), each
 *     with a plain sample card rendered locally (no AI), labelled « مثال · محتوى توضيحي »
 * AI stays as configured (disabled features stay disabled and are shown as such). Re-running is idempotent.
 * The flagship storyboard is imported separately with scripts/import-animation-scenario.ts (IMPORT_EMAIL = demo).
 *
 * Env: SUPABASE_URL (local), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (local), DEMO_EMAIL, DEMO_PASSWORD
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const e = (k: string) => process.env[k] ?? (console.error(`Missing ${k}`), process.exit(2));
const url = e('SUPABASE_URL');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error('Refusing to run: SUPABASE_URL is not a local stack.');
  process.exit(2);
}
const email = e('DEMO_EMAIL');
if (!/@(limo\.example|example\.com)$/.test(email)) {
  console.error('DEMO_EMAIL must be a reserved example address (…@limo.example), never a real mailbox.');
  process.exit(2);
}
const password = e('DEMO_PASSWORD');
const admin = createClient(url, e('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const BRAND = {
  brand_name: 'مطعم الياسمين · مثال',
  tagline: 'علامة تجريبية للعرض فقط',
  website: '',
  primary_color: '#7157EF',
  secondary_color: '#F4C430',
  default_cta: 'احجز طاولتك',
  tone: 'دافئ وعائلي',
};
/** Sample posts (Algerian Darija, restaurant theme). Titles carry « مثال » so a capture never passes for a real client. */
const POSTS = [
  { day: 23, hour: 12, title: 'مثال — كسكسي الجمعة', headline: 'كسكسي الجمعة كيما تاع الدار', caption: 'كل جمعة، كسكسي بالخضرة واللحم، مطيّب على نار هادية. جيبوا العايلة ومرحبا بيكم!', hashtags: ['كسكسي', 'الجمعة'] },
  { day: 25, hour: 19, title: 'مثال — عشاء العائلة', headline: 'عشية عائلية بنينة', caption: 'طاولة كبيرة، أطباق تقليدية وحلويات الدار. احجزوا من قبل باش تلقاو بلاصة.', hashtags: ['عشاء', 'عائلة'] },
  { day: 28, hour: 13, title: 'مثال — طبق اليوم', headline: 'شوربة فريك وبوراك', caption: 'طبق اليوم: شوربة فريك سخونة مع بوراك مقرمش. بنّة تاع الصح!', hashtags: ['طبق_اليوم'] },
  { day: 30, hour: 18, title: 'مثال — حلويات', headline: 'قهوة وحلويات تقليدية', caption: 'مقروط، بقلاوة وقهوة مزيانة. استراحة حلوة في آخر النهار.', hashtags: ['حلويات', 'قهوة'] },
];

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, { password });
  }
  const client = createClient(url, e('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  const rpc = client.rpc.bind(client) as unknown as (fn: string, a: object) => Promise<{ data: any; error: { message: string } | null }>;
  const prof = await rpc('complete_registration_profile_v2', {
    p_first_name: 'LIMO', p_last_name: 'Démo', p_country_name: 'Algeria', p_country_code: 'DZ', p_state_region: 'Alger',
    p_date_of_birth: '2000-01-01', p_account_type: 'business', p_terms_version: 'terms-2026-10', p_safety_policy_version: 'safety-2026-10',
  });
  if (prof.error && !/already/i.test(prof.error.message)) throw new Error(prof.error.message);
  const { data: m, error: mErr } = await admin.from('organization_members').select('organization_id').eq('user_id', user!.id).single();
  if (mErr) throw mErr;
  const org = (m as { organization_id: string }).organization_id;
  await admin.from('organizations').update({ name: 'LIMO — مساحة عرض توضيحية' }).eq('id', org);
  const sub = await admin.from('organization_subscriptions').upsert({ organization_id: org, plan_code: 'creator', status: 'active', started_at: new Date().toISOString(), renews_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  if (sub.error) throw sub.error;
  // Billing cycle with the Creator plan's allowances (what an approved payment would create).
  const { data: plan } = await admin.from('plan_definitions').select('video_slots, posts, facebook_pages, ai_images').eq('code', 'creator').single();
  const pl = plan as { video_slots: number; posts: number; facebook_pages: number; ai_images: number };
  const { data: bal } = await admin.from('usage_balances').select('organization_id').eq('organization_id', org).maybeSingle();
  if (!bal) {
    const ins = await admin.from('usage_balances').insert({ organization_id: org, cycle_start: new Date().toISOString(), cycle_end: new Date(Date.now() + 30 * 864e5).toISOString(), base_video_slots: pl.video_slots, base_posts: pl.posts, base_facebook_pages: pl.facebook_pages, base_images: pl.ai_images });
    if (ins.error) throw ins.error;
  }

  const kit = await rpc('save_brand_kit', { p_organization_id: org, p_kit: BRAND });
  if (kit.error) throw new Error(`brand kit: ${kit.error.message}`);

  const { data: pages } = await client.from('facebook_pages').select('id, page_name, status').eq('organization_id', org);
  let page = ((pages ?? []) as Array<{ id: string; status: string }>).find((p) => p.status === 'active');
  if (!page) {
    const add = await rpc('add_mock_facebook_page', { p_organization_id: org, p_name: 'مطعم الياسمين · مثال (صفحة محاكاة)' });
    if (add.error) throw new Error(`page: ${add.error.message}`);
    const { data: again } = await client.from('facebook_pages').select('id, status').eq('organization_id', org).eq('status', 'active').limit(1);
    page = (again as Array<{ id: string; status: string }>)[0];
  }

  const { data: existing } = await client.from('social_posts').select('title').eq('organization_id', org);
  const have = new Set(((existing ?? []) as Array<{ title: string }>).map((p) => p.title));
  const now = new Date();
  const browser = await chromium.launch();
  const card = async (headline: string) => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    await page.setContent(`<html dir="rtl"><body style="margin:0;width:1080px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;background:linear-gradient(160deg,#f7f5ff,#e4dcff);font-family:'Segoe UI',Tahoma,sans-serif;color:#2b2350">
      <div style="font-size:40px;padding:10px 28px;border-radius:999px;background:#7157ef;color:#fff">مثال · محتوى توضيحي</div>
      <div style="font-size:92px;font-weight:800;text-align:center;max-width:900px;line-height:1.25">${headline}</div>
      <div style="font-size:48px;color:#7157ef">${BRAND.brand_name}</div></body></html>`);
    const bytes = await page.screenshot({ type: 'png' });
    await page.close();
    return bytes;
  };
  for (const p of POSTS) {
    if (have.has(p.title)) continue;
    const png = await card(p.headline);
    const path = `${org}/${crypto.randomUUID()}.png`;
    const up = await client.storage.from('workspace-assets').upload(path, png, { contentType: 'image/png' });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const media = await rpc('register_media_asset', { p_organization_id: org, p_object_path: path, p_kind: 'design', p_mime_type: 'image/png', p_size_bytes: png.length, p_file_name: 'sample-card.png', p_width: 1080, p_height: 1080, p_duration_ms: null, p_label: `${p.title} (بطاقة مثال)` });
    if (media.error) throw new Error(`media: ${media.error.message}`);
    const saved = await rpc('save_social_post_v2', {
      p_organization_id: org, p_post_id: null, p_base_updated_at: null, p_title: p.title, p_caption: p.caption, p_headline: p.headline, p_hashtags: p.hashtags,
      p_cta: BRAND.default_cta, p_language_code: 'ar', p_tone: 'friendly', p_media_kind: 'image', p_image_project_id: null, p_media_asset_id: media.data, p_render_job_id: null,
      p_source_project_id: null, p_origin: 'manual', p_revision_source: 'manual', p_revision_label: 'demo sample',
    });
    if (saved.error) throw new Error(`post ${p.title}: ${saved.error.message}`);
    const id = (saved.data as { id: string }).id;
    const read = async () => ((await client.from('social_posts').select('updated_at').eq('id', id).single()).data as { updated_at: string }).updated_at;
    const ap = await rpc('approve_social_post', { p_post_id: id, p_base_updated_at: await read() });
    if (ap.error) throw new Error(`approve ${p.title}: ${ap.error.message}`);
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:00:00`;
    const sc = await rpc('schedule_social_post', { p_post_id: id, p_base_updated_at: await read(), p_page_id: page!.id, p_local_time: local, p_timezone: 'Africa/Algiers' });
    if (sc.error) throw new Error(`schedule ${p.title}: ${sc.error.message}`);
  }
  await browser.close();
  console.log(`demo workspace ready: org ${org}, simulated page, ${POSTS.length} sample posts scheduled (simulated)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
