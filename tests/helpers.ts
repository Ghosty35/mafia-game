import { expect, type Page } from '@playwright/test';

// Shared login helper for smoke tests. Uses the standing test accounts
// (see memory: heistbuddy_test / riptarget_test, testpass123) - never
// real player credentials.
export async function loginAs(page: Page, email: string, password = 'testpass123') {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // The submit handler only exists once React has hydrated. Playwright is
  // fast enough to fill and click before that happens, and a pre-hydration
  // click is swallowed silently - no request, no error, the form just sits
  // there. Retry the whole fill+submit until the navigation actually starts
  // rather than sleeping a fixed amount and hoping.
  const email$ = page.locator('input[type="email"], input[name="email"]');
  const pass$ = page.locator('input[type="password"]');
  const submit$ = page.getByRole('button', { name: /sign in/i });

  await expect(async () => {
    if (!page.url().includes('/login')) return; // already through
    await email$.fill(email, { timeout: 5000 });
    await pass$.fill(password, { timeout: 5000 });
    await submit$.click({ timeout: 5000 });
    await page.waitForURL('**/dashboard', { timeout: 6000 });
  }).toPass({ timeout: 45000, intervals: [500, 1000, 2000] });

  await dismissWelcomeModal(page);
}

// The WelcomeModal shows for any account created in the last 7 days (or with
// no dismissal recorded yet in this browser context) - a fresh Playwright
// context always qualifies. Dismiss it like a real user would so it doesn't
// block interaction with the rest of the page underneath, same as it should
// on every fresh login/session in normal play.
export async function dismissWelcomeModal(page: Page) {
  const closeBtn = page.getByRole('button', { name: /close/i }).first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
    await closeBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
}
