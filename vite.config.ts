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

/** [chunk name, package-name patterns] → Rolldown chunk groups matching `node_modules/<package>/` (both path separators). */
function vendorChunks(spec: [name: string, packages: string[]][]) {
  return spec.map(([name, packages], i) => ({
    name,
    test: new RegExp(`[\\\\/]node_modules[\\\\/](?:${packages.map((p) => p.replace(/\//g, '[\\\\/]')).join('|')})[\\\\/]`),
    // Earlier entries win when patterns overlap.
    priority: spec.length - i,
  }))
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropMockWorker()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Vite 8 bundles with Rolldown: `output.codeSplitting.groups` is the successor of Rollup's
    // `manualChunks` (deprecated there). Big vendors get their own long-cacheable chunks; a group is
    // only loaded by the chunks that import it (charts, dnd, excel… ship with the lazy pages using them).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorChunks([
            ['vendor-react', ['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', '@remix-run/router']],
            ['vendor-query', ['@tanstack/react-query', '@tanstack/query-core']],
            ['vendor-table', ['@tanstack/react-table', '@tanstack/table-core']],
            ['vendor-redux', ['@reduxjs/toolkit', 'redux', 'react-redux', 'redux-thunk', 'reselect', 'immer', 'use-sync-external-store']],
            // Before charts: a group also takes its dependencies (recharts uses clsx), and the shell needs these.
            ['vendor-utils', ['clsx', 'tailwind-merge']],
            ['vendor-charts', ['recharts', 'recharts-scale', 'react-smooth', 'victory-vendor', 'd3-.+', 'internmap', 'decimal.js-light', 'eventemitter3', 'lodash', 'react-is', 'fast-equals']],
            ['vendor-dnd', ['@dnd-kit/.+']],
            ['vendor-motion', ['framer-motion', 'motion-dom', 'motion-utils']],
            ['vendor-forms', ['react-hook-form', '@hookform/resolvers', 'zod']],
            ['vendor-date', ['date-fns']],
            ['vendor-icons', ['lucide-react', '@radix-ui/react-icons']],
            ['vendor-excel', ['read-excel-file', 'write-excel-file', 'fflate', 'unzipper', 'jszip', '@xmldom/xmldom', 'xpath']],
            ['vendor-axios', ['axios']],
          ]),
        },
      },
    },
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
