import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test.describe('auth + core navigation', () => {
  test('homepage loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText(/hustler/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('login works and dashboard renders live stats', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    await expect(page.getByText(/HeistBuddy/i)).toBeVisible();
    await expect(page.getByText(/Cash/i).first()).toBeVisible();
  });

  test('core pages render without an error boundary firing', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    const routes = ['/heists', '/families', '/garage', '/marketplace', '/bank', '/gym', '/stocks'];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    }
  });
});

test.describe('money-critical flows', () => {
  test('blackjack bet debits and resolves correctly', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    await page.goto('/casino/blackjack');

    // Anchor to the stats-header cash figure specifically - a plain $-pattern
    // match also hits the bet-preset buttons ($1,000 etc) on this page.
    const cashStat = page.locator('text=💵 Cash').locator('xpath=following-sibling::*[1]');
    const cashBefore = await cashStat.textContent();

    // A hand from a previous run may still be open server-side (casino_hands
    // resumes across page loads) - resolve it first so Deal is visible. The
    // page also re-renders periodically (live stats poll), so retry the
    // whole interaction a couple of times instead of fighting one race.
    await expect(async () => {
      const leftoverStand = page.getByRole('button', { name: /^stand$/i });
      if (await leftoverStand.isVisible().catch(() => false)) {
        await leftoverStand.click();
        await page.waitForTimeout(1000);
      }
      const betInput = page.locator('input[type="number"]').first();
      await betInput.fill('1000', { timeout: 3000 });
      await page.getByRole('button', { name: /deal/i }).click({ timeout: 3000 });
    }).toPass({ timeout: 20000, intervals: [1000] });

    await expect(
      page.getByRole('button', { name: /^stand$/i }).or(page.getByText(/win|lose|push|bust/i))
    ).toBeVisible({ timeout: 8000 });

    // Cash must have changed (bet was debited) - proves the RPC actually ran.
    await expect(cashStat).not.toHaveText(cashBefore ?? '', { timeout: 5000 });
  });

  test('rapid-fire clicks are rate-limited server-side (anti-bot gate)', async ({ page }) => {
    // Fire two native DOM clicks in the same tick (no await between) so both
    // reach the click handler before React's setState-driven re-render can
    // commit a `disabled` attribute - this is exactly the race a scripted
    // client (no human reaction-time gap at all) would win against a
    // client-only busy-lock. The server-side TOO_FAST gate is what actually
    // has to stop it.
    await loginAs(page, 'heistbuddy_test@example.com');
    await page.goto('/casino/roulette');
    await page.getByRole('button', { name: /^red$/i }).click();

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /spin/i.test(b.textContent ?? ''));
      btn?.click();
      btn?.click();
    });

    await expect(page.getByText(/slow down/i)).toBeVisible({ timeout: 8000 });
  });
});
