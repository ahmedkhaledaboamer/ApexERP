#!/usr/bin/env node
/**
 * `npm run build:prod [-- <outDir>]` — the build for a real backend: VITE_API_MOCK=false (no mock
 * API, no dev tools), then `check:bundle` on the output. VITE_API_URL comes from the environment or
 * .env.production(.local); without one the app calls `/api` on its own origin (reverse proxy).
 */
import { spawnSync } from 'node:child_process'

const outDir = process.argv[2] ?? 'dist'
const env = { ...process.env, VITE_API_MOCK: 'false' }
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit', env })

const vite = run(['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir'])
if (vite.status !== 0) process.exit(vite.status ?? 1)
const check = run(['scripts/check-bundle.mjs', outDir])
process.exit(check.status ?? 1)
