/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
})
