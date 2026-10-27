import { defineConfig } from 'vitest/config';

// Integration tests exercise the real router against a real Postgres. They read
// DATABASE_URL (echo_service), AUTH_DATABASE_URL (echo_auth) and
// BETTER_AUTH_SECRET, which is exactly what a disposable Neon branch provides —
// CI creates one per run via scripts/neon-branch.mjs, which needs NEON_API_KEY
// and NEON_PROJECT_ID. Never point these at production: the suite writes rooms.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
