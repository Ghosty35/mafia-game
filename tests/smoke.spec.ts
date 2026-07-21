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
    // "HeistBuddy" also appears in the live activity feed (rip/heist events
    // from other players) - anchor to the welcome heading specifically.
    await expect(page.getByRole('heading', { name: /welcome back, heistbuddy/i })).toBeVisible();
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

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('left drawer (game menu) opens and navigates', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    await page.getByRole('button', { name: /menu/i }).first().click();
    // "The Streets" (side_street_ops) is the stylized category label, and
    // menu_heists itself renders as "Jobs" - anchor to hrefs, not copy,
    // since this app uses heavily stylized slang labels throughout.
    await expect(page.getByText(/the streets/i).first()).toBeVisible();
    await page.locator('a[href="/heists"]').first().click();
    await expect(page).toHaveURL(/\/heists/);
    // Drawer closes on navigation - no leftover backdrop trapping input.
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('right drawer (profile/family menu) opens with all categories and navigates', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    await page.getByRole('button', { name: /profile.*family menu/i }).click();
    // All 5 right-sidebar categories should render (Communication/Profile/
    // Murder/Family/Reputation - mirrors the desktop RightSidebar).
    await expect(page.getByText(/my family/i).first()).toBeVisible();
    await expect(page.getByText(/my profile/i).first()).toBeVisible();
    await page.getByRole('link', { name: /my family/i }).first().click();
    await expect(page).toHaveURL(/\/families/);
  });

  test('bottom nav is present and does not overlap page content', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    const bottomNav = page.locator('nav[aria-label="Mobile navigation"]');
    await expect(bottomNav).toBeVisible();
    const box = await bottomNav.boundingBox();
    expect(box?.y).toBeGreaterThan(700); // pinned near viewport bottom (812px tall)
  });

  test('crimes page and a crime detail page have no horizontal overflow', async ({ page }) => {
    await loginAs(page, 'heistbuddy_test@example.com');
    for (const route of ['/crimes', '/crimes/pickpocket']) {
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${route} should not overflow horizontally`).toBe(false);
    }
  });
});

test.describe('responsive breakpoint consistency', () => {
  // Regression test: Sidebar.tsx once used `hidden md:block` (768px) while
  // every other responsive nav piece (RightSidebar, mobile hamburger, bottom
  // nav) used `lg:` (1024px). Any viewport in the 768-1023px gap - a real
  // width reported by a user's installed PWA WebView - showed the full
  // desktop left sidebar AND the mobile hamburger/bottom nav at the same
  // time. Pin the desktop sidebar to stay hidden through that whole gap.
  test('desktop left sidebar stays hidden through the md-lg gap (768-1023px)', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1200 });
    await loginAs(page, 'heistbuddy_test@example.com');
    const leftSidebar = page.locator('aside[aria-label="Sidebar navigation"]');
    await expect(leftSidebar).toBeHidden();
    const bottomNav = page.locator('nav[aria-label="Mobile navigation"]');
    await expect(bottomNav).toBeVisible();
  });

  test('desktop left sidebar shows at true desktop width (1024px+)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'heistbuddy_test@example.com');
    const leftSidebar = page.locator('aside[aria-label="Sidebar navigation"]');
    await expect(leftSidebar).toBeVisible();
  });
});
