import { defineConfig, devices } from '@playwright/test';

// Smoke-test suite against a running dev server (npm run dev on :3000).
// Covers the highest-value regression class: a page crashing or a
// money-critical RPC silently failing. Not exhaustive route coverage -
// see tests/README.md for scope notes.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
