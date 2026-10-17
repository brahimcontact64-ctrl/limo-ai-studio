import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVICE_KEY, SUPABASE_URL, activateSubscription, signUpAndOnboard } from './account';

/**
 * Milestone 3: script editing, Mock AI proposals, undo/redo, autosave, revisions (compare + restore),
 * approval lock, Arabic RTL, edit conflicts and cross-workspace isolation. Local/staging stack only.
 */
test.skip(!SUPABASE_URL || !SERVICE_KEY, 'E2E_SUPABASE_URL / E2E_SERVICE_ROLE_KEY not set');

async function newProductAd(page: Page, title: string) {
  await page.goto('/app/create/product_ad');
  await page.getByLabel('Project name').fill(title);
  await page.getByLabel('Product name').fill('Glow Serum');
  const points = page.getByLabel(/Selling points/);
  await points.fill('Vitamin C');
  await points.press('Enter');
  await page.getByLabel('Call to action').fill('Order on our page');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  return page.url();
}

const scene = (page: Page, i: number) => page.locator('.script-scene').nth(i);

test('script editor: Mock AI, undo, autosave, history, restore and approval', async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e+script-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const url = await newProductAd(page, `Script ${info.project.name}`);

  // Whole-script Mock AI draft: a proposal, applied only after review.
  await page.getByRole('tab', { name: /Script/ }).click();
  await expect(page.getByText('Mock AI is a built-in placeholder', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Generate draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Mock AI suggestions' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Apply selected/ }).click();
  await expect(scene(page, 0).getByLabel(/Camera direction/)).toHaveValue('Slow push-in, eye level');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();

  // One scene: type, shorten with Mock AI, undo and redo.
  const narration = scene(page, 1).getByLabel(/Narration/);
  const full = 'This serum keeps your skin bright and fresh all day long.';
  await narration.fill(full);
  await scene(page, 1).getByText('Mock AI for this scene').click();
  await scene(page, 1).getByRole('button', { name: 'Shorten' }).click();
  await expect(dialog.getByText('Replaces your text').first()).toBeVisible();
  await dialog.getByRole('button', { name: /Apply selected/ }).click();
  await expect(narration).toHaveValue('This serum keeps your skin bright and…');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(narration).toHaveValue(full);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await expect(narration).toHaveValue('This serum keeps your skin bright and…');

  // Autosave (no click).
  await expect(page.locator('.save-state')).toContainText('Autosaved', { timeout: 15_000 });

  // History: compare revision 1 with the editor, then restore it.
  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('dialog', { name: 'Revision history' });
  await expect(history.getByText('Mock AI applied').first()).toBeVisible();
  await history.getByRole('button', { name: /Revision 1/ }).click();
  await expect(history.getByText('Revision 1 compared with the editor')).toBeVisible();
  await expect(history.locator('.change-list li').first()).toBeVisible();
  await history.getByRole('button', { name: 'Restore this revision' }).click();
  await history.getByRole('alert').getByRole('button', { name: 'Restore this revision' }).click();
  await expect(page.getByText('Revision 1 restored.')).toBeVisible();
  // The editor reloads the restored project and stays on the Script step.
  await expect(page.getByRole('tab', { name: /Script/ })).toHaveAttribute('aria-selected', 'true');
  await expect(scene(page, 0).getByLabel(/Camera direction/)).toHaveValue('');

  // Approve: the script locks; reload keeps it locked.
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Approve script' }).click();
  await expect(page.getByText('Script approved.')).toBeVisible();
  await expect(page.getByTestId('script-status')).toHaveText('Approved');
  await page.goto(url);
  await expect(page.getByTestId('script-locked')).toBeVisible();
  await page.getByRole('tab', { name: /Script/ }).click();
  await expect(scene(page, 0).getByLabel(/Narration/)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Generate draft' })).toBeDisabled();

  // Editing an approved script needs an explicit confirmation.
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove approval and edit' }).click();
  await expect(page.getByText('Approval removed.', { exact: false })).toBeVisible();
  await expect(page.locator('.studio-title-meta')).toContainText('Changed since approval');
  await expect(scene(page, 0).getByLabel(/Narration/)).toBeEnabled();

  // Arabic, right to left.
  await page.context().addCookies([{ name: 'limo_locale', value: 'ar', url: new URL(page.url()).origin }]);
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('tab', { name: /النص/ }).click();
  await expect(page.getByText('ذكاء اصطناعي تجريبي').first()).toBeVisible();
  await page.getByRole('button', { name: 'إنشاء مسودة' }).click();
  await expect(page.getByRole('dialog', { name: 'مراجعة اقتراحات الذكاء الاصطناعي التجريبي' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

async function signIn(browser: Browser, baseURL: string, email: string, password: string) {
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

test('two tabs: the second save is refused instead of overwriting; other workspaces see nothing', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const email = `e2e+conflict-${info.project.name}-${Date.now()}@limo.test`;
  await page.goto('/');
  await page.context().addCookies([{ name: 'limo_locale', value: 'en', url: new URL(page.url()).origin }]);
  await signUpAndOnboard(page, email);
  await activateSubscription(email);
  const url = await newProductAd(page, `Conflict ${info.project.name}`);
  const projectId = url.split('/').pop()!;

  const second = await page.context().newPage();
  await second.goto(url);
  await page.goto(url);
  await page.locator('#project-title-bar').fill('Saved first');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Project saved.')).toBeVisible();

  await second.locator('#project-title-bar').fill('Saved second');
  await second.keyboard.press('Control+s');
  await expect(second.getByText('changed in another tab or by a teammate', { exact: false })).toBeVisible();
  await second.getByRole('button', { name: 'Reload latest version' }).click();
  await expect(second.locator('#project-title-bar')).toHaveValue('Saved first');

  // Another workspace (E2E_EMAIL / E2E_PASSWORD) cannot see the history, restore or approve.
  const otherEmail = process.env.E2E_EMAIL;
  const otherPassword = process.env.E2E_PASSWORD;
  test.skip(!otherEmail || !otherPassword, 'E2E_EMAIL / E2E_PASSWORD (a user in another workspace) not set');
  const other = await signIn(browser, baseURL!, otherEmail!, otherPassword!);
  const revs = await other.request.get(`/api/projects/${projectId}/revisions`);
  expect((await revs.json()).revisions).toEqual([]);
  const own = await page.request.get(`/api/projects/${projectId}/revisions`);
  const ownRevs = (await own.json()).revisions as Array<{ id: string }>;
  expect(ownRevs.length).toBeGreaterThanOrEqual(2);
  const restore = await other.request.post(`/api/projects/${projectId}/revisions/${ownRevs[0]!.id}`, { data: {} });
  expect(restore.status()).toBe(404);
  const approve = await other.request.post(`/api/projects/${projectId}/approval`, { data: { action: 'approve' } });
  expect(approve.status()).toBe(404);
  const snapshot = await other.request.get(`/api/projects/${projectId}/revisions/${ownRevs[0]!.id}`);
  expect(snapshot.status()).toBe(404);
  await other.context().close();
});
