/**
 * Registry of every piece of mutable mock-API state, so the in-memory "database" can be
 * snapshotted and restored as one structured-clone-able object (dev persistence in IndexedDB,
 * see ./browser.ts). Pure in-memory code: no IndexedDB, no DOM. Owning modules register their
 * stores right where they're declared; restore is always in place (same array / object / Map
 * instance), so every module holding a reference sees the restored contents.
 *
 * Bump VERSION whenever the *shape* of a stored record changes in a way old saved data would
 * break (store additions/removals are picked up automatically through the name hash).
 */
export const VERSION = 8 // 5: database alignment part B (task enums, blocked flag, sub-tasks, time entries, attachments sizeBytes/mimeType, lead status history); 6: part A (lead status type/flags, follow-up dates, customer/quotation/contract enums, quotation viewedAt); 7: marketing (campaigns, campaign costs, bulk emails, recipients, leads.campaignId); 8: events (events, event team, attendees, history, leads.eventId, Crest Event source)

export interface StoreAdapter {
  /** A structured-clone-able value (it is cloned on save and on restore). */
  save(): unknown
  /** Replace the store's contents with `value` (already a private copy). */
  load(value: unknown): void
}

export interface MockSnapshot {
  version: string
  savedAt: number
  stores: Record<string, unknown>
}

const stores = new Map<string, StoreAdapter>()

export function register(name: string, adapter: StoreAdapter): void {
  // A re-executed module (HMR) re-registers its stores: the newest instance wins.
  if (stores.has(name) && import.meta.env.MODE === 'test') throw new Error(`Mock store "${name}" is registered twice.`)
  stores.set(name, adapter)
}

/** An array restored in place (same array object, contents replaced). */
export function registerArray<T>(name: string, arr: T[]): T[] {
  register(name, {
    save: () => arr,
    load: (v) => {
      arr.splice(0, arr.length, ...(v as T[]))
    },
  })
  return arr
}

/** A plain object map (Record), restored in place: keys removed, then assigned. */
export function registerObject<T extends object>(name: string, obj: T): T {
  register(name, {
    save: () => obj,
    load: (v) => {
      for (const k of Object.keys(obj)) delete (obj as Record<string, unknown>)[k]
      Object.assign(obj, v as object)
    },
  })
  return obj
}

export function registerMap<K, V>(name: string, map: Map<K, V>): Map<K, V> {
  register(name, {
    save: () => [...map.entries()],
    load: (v) => {
      map.clear()
      for (const [k, val] of v as [K, V][]) map.set(k, val)
    },
  })
  return map
}

export function registerSet<T>(name: string, set: Set<T>): Set<T> {
  register(name, {
    save: () => [...set],
    load: (v) => {
      set.clear()
      for (const x of v as T[]) set.add(x)
    },
  })
  return set
}

/** A module-level scalar (`let seq = …`) exposed through accessors. */
export function registerValue<T>(name: string, get: () => T, set: (value: T) => void): void {
  register(name, { save: get, load: (v) => set(v as T) })
}

export function registeredStoreNames(): string[] {
  return [...stores.keys()].sort()
}

/** FNV-1a over the sorted store names, plus the manual VERSION. */
export function schemaVersion(): string {
  let h = 2166136261
  for (const ch of registeredStoreNames().join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return `v${VERSION}-${h.toString(36)}`
}

/**
 * The whole mock DB. Values reference live state: the caller must clone it before mutating
 * anything (IndexedDB `put` clones synchronously; `takeSnapshot(true)` clones here).
 */
export function takeSnapshot(clone = false): MockSnapshot {
  const out: Record<string, unknown> = {}
  for (const [name, s] of stores) out[name] = s.save()
  return { version: schemaVersion(), savedAt: Date.now(), stores: clone ? structuredClone(out) : out }
}

/**
 * Restores a snapshot. Returns false (and touches nothing) when it was made for another schema:
 * different VERSION or a different set of stores. Missing stores keep their seed.
 */
export function restoreSnapshot(snap: MockSnapshot | null | undefined): boolean {
  if (!snap || snap.version !== schemaVersion() || !snap.stores) return false
  const data = structuredClone(snap.stores)
  for (const [name, s] of stores) {
    if (name in data) s.load(data[name])
  }
  return true
}
