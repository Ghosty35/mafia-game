import type { Page } from '@playwright/test';

// Shared login helper for smoke tests. Uses the standing test accounts
// (see memory: heistbuddy_test / riptarget_test, testpass123) - never
// real player credentials.
export async function loginAs(page: Page, email: string, password = 'testpass123') {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
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
