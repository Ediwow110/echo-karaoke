import { defineConfig } from 'vitest/config';

// Integration tests call a locally served Supabase stack:
//   npx supabase start
//   npx supabase functions serve
//   LOCAL_SUPABASE_URL and LOCAL_SUPABASE_ANON_KEY set in the environment
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
