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
}
