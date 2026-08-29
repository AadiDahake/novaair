import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3100)
const baseURL = process.env.NOVAAIR_BASE_URL ?? `http://127.0.0.1:${PORT}`

/**
 * The end-to-end run uses the in-memory store, so it needs no database and no network.
 * The same run is also the PostHog session generator: set NEXT_PUBLIC_POSTHOG_KEY and point
 * NOVAAIR_BASE_URL at a running site to record real sessions from these steps.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.NOVAAIR_BASE_URL
    ? undefined
    : {
        command: `NEXT_DIST_DIR=.next-e2e npm run build && NEXT_DIST_DIR=.next-e2e npx next start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
