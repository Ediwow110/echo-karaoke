import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // The mocked UI suite runs only under playwright.ui.config.ts, against Vite
  // with /api stubbed. A name-exact ignore let a second ui-mock-* file slip in
  // here, where it would be driven against the real app with no stubs.
  testIgnore: /ui-mock/,
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
});
