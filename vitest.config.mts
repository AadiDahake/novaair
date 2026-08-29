import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The tests run against the in-memory store, so they need no database and no network.
    env: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  },
})
