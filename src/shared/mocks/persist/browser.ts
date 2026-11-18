import type { SetupWorker } from 'msw/browser'
import { restoreSnapshot, takeSnapshot } from './registry'
import { indexedDbAdapter, type SnapshotAdapter } from './idb'

/**
 * Dev-only persistence of the mock API's in-memory DB in IndexedDB, so a page reload keeps the
 * demo data. Loaded with a dynamic import from main.tsx only when
 * `import.meta.env.DEV && VITE_API_MOCK !== 'false'` (never in production bundles, never in
 * unit tests). Not localStorage: the app's tenant storage clearing never touches it.
 *
 * - load: before the worker starts and before the app renders; a snapshot from another schema
 *   (VERSION or store set changed) is discarded and the app starts from the seed;
 * - save: debounced after every mocked mutating request, and on `pagehide`;
 * - reset: delete the database and reload, so both synthetic companies reseed.
 */

export interface PersistStatus {
  /** 'seed': started from seed data; 'restored': loaded from this browser. */
  source: 'seed' | 'restored'
  lastSavedAt: number | null
  error: string | null
}

const SAVE_DEBOUNCE_MS = 300
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])

let adapter: SnapshotAdapter | null = null
let status: PersistStatus = { source: 'seed', lastSavedAt: null, error: null }
let timer: ReturnType<typeof setTimeout> | null = null
let resetting = false
const listeners = new Set<() => void>()

function setStatus(patch: Partial<PersistStatus>) {
  status = { ...status, ...patch }
  for (const fn of listeners) fn()
}

export function getPersistStatus(): PersistStatus {
  return status
}

export function subscribePersistStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function saveNow(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  if (!adapter || resetting) return
  try {
    const snap = takeSnapshot()
    await adapter.save(snap)
    setStatus({ lastSavedAt: snap.savedAt, error: null })
  } catch (e) {
    setStatus({ error: e instanceof Error ? e.message : String(e) })
  }
}

function scheduleSave() {
  if (resetting) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS)
}

/** Loads the saved mock DB (if any) into the in-memory stores and starts saving changes. */
export async function startMockPersistence(worker: SetupWorker): Promise<void> {
  adapter = indexedDbAdapter()
  try {
    const saved = await adapter.load()
    if (saved && restoreSnapshot(saved)) {
      setStatus({ source: 'restored', lastSavedAt: saved.savedAt })
    } else if (saved) {
      console.info('[mock-db] Saved demo data is from an older schema; starting from seed.')
      await adapter.clear()
    }
  } catch (e) {
    // A broken or blocked database must never stop the app: run on seed data.
    console.warn('[mock-db] Could not load saved demo data; starting from seed.', e)
    setStatus({ error: e instanceof Error ? e.message : String(e) })
  }

  worker.events.on('response:mocked', ({ request }) => {
    if (!READ_ONLY.has(request.method.toUpperCase())) scheduleSave()
  })
  window.addEventListener('pagehide', () => void saveNow())
  // Dev / test helper only: a production build drops it.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') window.__apexDevReset = resetDemoData
}

/** Deletes the saved mock DB and reloads: both synthetic companies reseed. */
export async function resetDemoData(): Promise<void> {
  resetting = true
  if (timer) clearTimeout(timer)
  timer = null
  try {
    await (adapter ?? indexedDbAdapter()).clear()
  } finally {
    window.location.reload()
  }
}

declare global {
  interface Window {
    /** Dev only: delete the persisted mock DB and reload (see shared/mocks/persist/browser.ts). */
    __apexDevReset?: () => Promise<void>
  }
}
