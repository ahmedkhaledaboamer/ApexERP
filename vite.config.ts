/// <reference types="vitest/config" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * A real-backend build (VITE_API_MOCK=false) must not ship the mock: the app code drops it by
 * itself (dead-code elimination of the dynamic imports), and this removes MSW's service-worker
 * script that `public/` would otherwise copy into the output. `npm run check:bundle` verifies both.
 */
function dropMockWorker(): Plugin {
  let outDir = ''
  let mockOff = false
  return {
    name: 'apex:drop-mock-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      mockOff = config.env.VITE_API_MOCK === 'false'
    },
    closeBundle() {
      if (mockOff) rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropMockWorker()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Unit tests run the mock services directly (no browser, no MSW).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each test file gets a fresh module graph, so the in-memory mock stores start clean.
    isolate: true,
    // The table-driven isolation/role suites make thousands of in-process requests; on a busy machine a
    // single test can pass 5 s without being wrong. They are deterministic, so allow time, not retries.
    testTimeout: 30_000,
    // beforeAll hooks that import every mock handler (the whole app's API) can pass the 10 s default under load.
    hookTimeout: 60_000,
  },
})
