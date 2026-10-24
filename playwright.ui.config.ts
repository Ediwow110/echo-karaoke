import { defineConfig, devices } from '@playwright/test';

// UI-only checks run against Vite with mocked /api responses. They need no
// Neon branch or YouTube key, so CI can gate every phone and host visual rule.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'ui-mock.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
