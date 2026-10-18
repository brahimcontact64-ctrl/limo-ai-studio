import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Accessibility audit (Milestone 9): axe-core (WCAG 2.0/2.1 A and AA rules) on public pages and the main
 * workspace pages, in English and Arabic. Fails on "serious" or "critical" violations.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

const PUBLIC = ['/', '/pricing', '/faq', '/login', '/signup'];
const APP = ['/app', '/app/create', '/app/projects/new', '/app/stories', '/app/images/new', '/app/posts', '/app/posts/new', '/app/social', '/app/assets', '/app/settings', '/app/billing'];

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${path} · ${v.impact} · ${v.id} · ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')} — ${v.help}${process.env.A11Y_DETAIL ? ' :: ' + v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} {${n.any.map((a) => JSON.stringify(a.data)).join(';')}}`).join(' | ') : ''}`);
}

test('no serious or critical accessibility violations (English and Arabic)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the rule scan');
  test.setTimeout(300_000);
  const email = `e2e+a11y-${Date.now()}@limo.test`;
  const found: string[] = [];
  await page.goto('/');
  for (const locale of ['en', 'ar']) {
    await page.context().addCookies([{ name: 'limo_locale', value: locale, url: new URL(page.url()).origin }]);
    for (const p of PUBLIC) found.push(...(await scan(page, p)).map((x) => `[${locale}] ${x}`));
  }
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  for (const locale of ['en', 'ar']) {
    await page.context().addCookies([{ name: 'limo_locale', value: locale, url: new URL(page.url()).origin }]);
    for (const p of APP) found.push(...(await scan(page, p)).map((x) => `[${locale}] ${x}`));
  }
  console.log(found.length ? found.join('\n') : 'no serious/critical violations');
  expect(found).toEqual([]);
});
