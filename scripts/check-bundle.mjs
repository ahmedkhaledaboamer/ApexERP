#!/usr/bin/env node
/**
 * `npm run check:bundle [-- <dir>]` — fails if a real-backend build (VITE_API_MOCK=false) still
 * contains mock code: MSW, its service worker, the dev hooks (window.__apex*), seed data or the demo
 * password. Run on the output of `npm run build:prod` (which runs it for you).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const dir = process.argv[2] ?? 'dist'

/** Content markers: [label, pattern]. Each one only exists in mock / dev-only code. */
const MARKERS = [
  ['MSW runtime', /\[MSW\]|msw\/browser|setupWorker|["'`]msw["'`/]/],
  ['MSW service worker', /mockServiceWorker/],
  ['dev hooks (window.__apex*)', /__apex[A-Z]/],
  ['dev failure simulator', /Simulated failure \(dev\)/],
  ['billing simulator', /Billing simulator|\/dev\/billing\//],
  ['demo password', /apex2025/],
  ['seed data (Crest Logistics)', /Crest Logistics/],
  ['seed data (customers)', /Hatta Mountain Resorts/],
  ['seed data (finance history)', /financeHistorySeed|Etimad tender portal/],
  ['mock DB persistence', /apexcrm-mock-db|mockPersistence/],
]

/** File-name markers (the worker script copied from public/, chunks named after mock modules). */
const FILE_MARKERS = [/mockServiceWorker\.js$/, /(^|[/\\])(mocks?|seed|devBilling|BillingSimulator|DevDataTools|devFailures|devAuthHooks)[-.]/i]

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`check:bundle: "${dir}" is not a directory. Build first (npm run build:prod).`)
  process.exit(2)
}

function* walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

const problems = []
let scanned = 0
for (const file of walk(dir)) {
  const rel = relative(dir, file)
  for (const re of FILE_MARKERS) if (re.test(rel)) problems.push(`${rel}: file name matches ${re}`)
  if (!/\.(js|mjs|html|css|json|map)$/.test(file)) continue
  scanned++
  const text = readFileSync(file, 'utf8')
  for (const [label, re] of MARKERS) {
    const m = re.exec(text)
    if (m) {
      const at = Math.max(0, m.index - 60)
      problems.push(`${rel}: ${label} — …${text.slice(at, m.index + m[0].length + 60).replace(/\s+/g, ' ')}…`)
    }
  }
}

if (problems.length) {
  console.error(`check:bundle: mock code found in ${dir} (${problems.length}):`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('Build with VITE_API_MOCK=false (npm run build:prod) and keep mock imports behind an inline import.meta.env check.')
  process.exit(1)
}
console.log(`check:bundle: ${scanned} files in ${dir}, no mock code.`)
