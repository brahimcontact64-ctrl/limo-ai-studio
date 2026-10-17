import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 5: Story Engine through the UI — series + Story Bible, three consecutive episodes that each
 * continue from the previous approved ending, timeline, revising episode 1 (later episodes flagged for
 * review, not rewritten), Arabic RTL and workspace isolation. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

/** Approve the episode's script in the studio, write its ending from the Mock AI suggestion, approve the episode. */
async function finishEpisode(page: Page, summary: string, hook: string) {
  await page.getByRole('link', { name: 'Open script' }).click();
  await expect(page.getByTestId('episode-banner')).toBeVisible();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
  await page.getByRole('link', { name: 'Open story page' }).click();
  await expect(page.getByTestId('episode-script-status')).toHaveText('Approved');
  await page.getByRole('button', { name: /Suggest from script/ }).click();
  await expect(page.getByText('Mock AI suggestion loaded', { exact: false })).toBeVisible();
  await page.getByLabel('Summary').fill(summary);
  await page.getByLabel('Ending hook').fill(hook);
  await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Market' });
  await page.getByRole('button', { name: 'Save ending' }).click();
  await expect(page.getByText('Ending saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve episode' }).click();
  await expect(page.getByText('Episode approved.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('episode-status')).toHaveText('Episode approved');
}

async function signIn(browser: Browser, baseURL: string, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'limo_locale', value: 'en', url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
  return page;
}

test('three episodes continue from each approved ending; revising episode 1 flags later episodes', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(360_000);
  const email = `e2e+story-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);

  // Series with its Story Bible.
  await page.goto('/app/stories');
  await page.getByRole('button', { name: 'New series' }).click();
  const form = page.getByRole('dialog', { name: 'New series' });
  await form.getByLabel('Series title').fill(`Market Mystery ${info.project.name}`);
  await form.getByLabel('Premise').fill('Every week something goes missing at the market.');
  await form.getByLabel('First location').fill('Market');
  await form.getByLabel('First plot thread (optional)').fill('The lost key');
  await form.getByLabel('Limo · Boy').check();
  await form.getByLabel('Nova · Grandmother').check();
  await form.getByRole('button', { name: 'Create series' }).click();
  await page.waitForURL(/\/app\/stories\/[0-9a-f-]{36}\?tab=bible/);
  const seriesUrl = page.url().split('?')[0]!;
  await expect(page.getByTestId('bible-character-limo_boy')).toBeVisible();
  await expect(page.getByText('Version 1')).toBeVisible();

  // Episode 1.
  await page.goto(`${seriesUrl}?tab=episodes`);
  await page.getByRole('button', { name: 'Start episode 1' }).click();
  await page.waitForURL(/\/episodes\/1$/);
  await expect(page.getByText('First episode: starts from the Story Bible.')).toBeVisible();
  await finishEpisode(page, 'Limo and Grandma search the market.', 'A map falls out of the crate.');

  // Episodes 2 and 3 continue from the exact approved endings.
  for (const [n, summary, hook] of [
    [2, 'They follow the map to the fountain.', 'The fountain is dry.'],
    [3, 'The key was in the fountain all along.', 'Someone is watching.'],
  ] as const) {
    await page.goto(`${seriesUrl}?tab=episodes`);
    await expect(page.getByText(`Episode ${n} starts from the approved ending of episode ${n - 1}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Continue story' }).click();
    await page.waitForURL(new RegExp(`/episodes/${n}$`));
    const start = page.getByTestId('starting-point');
    await expect(start).toContainText(`Starts from the approved ending of episode ${n - 1}`);
    await expect(start).toContainText(n === 2 ? 'A map falls out of the crate.' : 'The fountain is dry.');
    // The script's first scene starts from that ending.
    await page.getByRole('link', { name: 'Open script' }).click();
    await page.getByRole('tab', { name: /Script/ }).click();
    await expect(page.locator('.script-scene').first().getByLabel(/Narration/)).toHaveValue(n === 2 ? 'A map falls out of the crate.' : 'The fountain is dry.');
    await page.getByRole('link', { name: 'Open story page' }).click();
    await finishEpisode(page, summary, hook);
  }

  // Timeline: only approved events, open threads kept.
  await page.goto(`${seriesUrl}?tab=timeline`);
  await expect(page.locator('.story-timeline-episode')).toHaveCount(3);
  await expect(page.getByTestId('open-threads')).toContainText('The lost key');

  // Revise episode 1: reopen it. Episodes 2 and 3 are flagged, not rewritten.
  await page.goto(`${seriesUrl}/episodes/1`);
  await page.getByRole('button', { name: 'Reopen episode' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen episode' }).click();
  await expect(page.getByText('Episode reopened.', { exact: false })).toBeVisible();
  await page.goto(`${seriesUrl}?tab=episodes`);
  await expect(page.getByTestId('episode-2')).toContainText('Needs review');
  await expect(page.getByTestId('episode-3')).toContainText('Needs review');
  await expect(page.getByTestId('episode-3')).toContainText('Episode approved');
  await expect(page.getByRole('button', { name: 'Continue story' })).toBeDisabled();
  await page.goto(`${seriesUrl}/episodes/2`);
  await expect(page.getByTestId('review-reason').first()).toContainText('Episode 1 was reopened: directly affects this episode.');
  await page.goto(`${seriesUrl}/episodes/3`);
  await expect(page.getByTestId('review-reason').first()).toContainText('Episode 1 was reopened');

  // Another workspace sees nothing and cannot act.
  const other = await signIn(browser, baseURL!, process.env.E2E_EMAIL!, process.env.E2E_PASSWORD!);
  // Streaming (loading.tsx) means the status line is sent before notFound(); the page itself is the 404 page.
  await other.goto(seriesUrl);
  await expect(other.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(other.getByText(`Market Mystery ${info.project.name}`)).toHaveCount(0);
  await other.goto(`${seriesUrl}/episodes/1`);
  await expect(other.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const api = await other.request.post(`${seriesUrl.replace('/app/stories/', '/api/stories/')}/episodes`, { data: { based_on_episode_id: null } });
  expect([403, 404]).toContain(api.status());
  await other.context().close();

  // Arabic, right to left.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(`${seriesUrl}?tab=bible`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'مرجع القصة' })).toBeVisible();
  await page.goto(`${seriesUrl}/episodes/2`);
  await expect(page.getByTestId('needs-review')).toContainText('بحاجة إلى مراجعة');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
