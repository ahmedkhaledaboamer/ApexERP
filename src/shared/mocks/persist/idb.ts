import type { MockSnapshot } from './registry'

/**
 * Minimal key-value adapter over the raw IndexedDB API (no dependency). One database, one object
 * store, one record: the latest mock DB snapshot. Dev only (see ./browser.ts).
 */
export const DB_NAME = 'apexcrm-dev-mockdb'
const STORE = 'snapshots'
const KEY = 'current'

export interface SnapshotAdapter {
  load(): Promise<MockSnapshot | null>
  save(snapshot: MockSnapshot): Promise<void>
  clear(): Promise<void>
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      // Let "Reset demo data" in another tab delete the database.
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Mock DB is blocked by another tab.'))
  })
}

export function indexedDbAdapter(): SnapshotAdapter {
  let db: Promise<IDBDatabase> | null = null
  const conn = () => (db ??= open())
  return {
    async load() {
      const d = await conn()
      const value = await request(d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
      return (value as MockSnapshot | undefined) ?? null
    },
    async save(snapshot) {
      const d = await conn()
      const tx = d.transaction(STORE, 'readwrite')
      // put() structured-clones synchronously, so live store references are safe to pass.
      tx.objectStore(STORE).put(snapshot, KEY)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
    async clear() {
      if (db) {
        ;(await db).close()
        db = null
      }
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        // Another tab still holds it open: deletion completes once that tab closes or reloads.
        req.onblocked = () => resolve()
      })
    },
  }
}
