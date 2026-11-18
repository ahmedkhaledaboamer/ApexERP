import { defineConfig } from '@playwright/test'

/**
 * Browser tests (e2e/*.spec.ts) against the dev server with the MSW mock API.
 * Uses the locally installed Chrome (no browser download): `npm run test:e2e`.
 * The port is fixed but outside the ranges used elsewhere; 5199 belongs to another project.
 */
const PORT = Number(process.env.E2E_PORT ?? 5391)

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
