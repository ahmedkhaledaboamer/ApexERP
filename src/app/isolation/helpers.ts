/**
 * Shared helpers for the isolation suites (*.isolation.test.ts). No app imports at module level:
 * the client suite installs the fake `window` before it imports the store.
 */

/** In-memory Web Storage (node has no localStorage / sessionStorage). */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
  entries(): [string, string][] {
    return [...this.map.entries()]
  }
}

/** Installs a fake `window` with in-memory local and session storage; returns both. */
export function installMemoryWindow(): { local: MemoryStorage; session: MemoryStorage } {
  const local = new MemoryStorage()
  const session = new MemoryStorage()
  ;(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: session }
  return { local, session }
}

/** A user-scoped key: `<companyId>:<userId>:apexcrm.(pref|data).<key>`. */
export const SCOPED_KEY = /^([^:]+):([^:]+):apexcrm\.(pref|data)\./

/**
 * Every global (not company/user-scoped) key the app may write (docs/API.md "Client storage"):
 * the company session, the platform session, the last theme for the login screen, the sign-up
 * rate-limit client id, the workspace the tab was opened on and the dev text direction.
 */
export const ALLOWED_GLOBAL_KEYS: ReadonlySet<string> = new Set([
  'apexcrm.session',
  'apexcrm.platform',
  'apexcrm.device',
  'apexcrm.client-id',
  'apexcrm.workspace',
  'apexcrm.dir',
])

/* ---------------- Mock API through the real MSW handlers ---------------- */

export type ApiResult = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Sends a request through the real MSW handlers (the same code the browser worker runs), like the
 * `api()` helper in src/shared/mocks/services/platform.test.ts.
 */
export async function callApi(token: string | null, method: string, path: string, body?: unknown): Promise<ApiResult> {
  // MSW resolves the handlers' relative paths (`/api/...`) against document.baseURI; give node one.
  ;(globalThis as { document?: unknown }).document ??= { baseURI: 'http://localhost/' }
  const [{ getResponse }, { handlers }] = await Promise.all([import('msw'), import('@/shared/mocks/handlers')])
  const req = new Request(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  })
  const res = await getResponse(handlers, req)
  if (!res) throw new Error(`No handler for ${method} ${path}`)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
