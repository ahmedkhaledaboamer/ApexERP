/**
 * The app's configuration, read from `import.meta.env` once and validated (docs: .env.example,
 * README "Running against a real backend").
 *
 *  - VITE_API_URL   API base: a path on this origin ("/api", the default) or an absolute
 *                   http(s) URL ("https://api.example.com/api"). No trailing slash needed.
 *  - VITE_API_MOCK  "false" talks to the real backend; anything else (default "true") starts the
 *                   in-browser mock API (MSW) and the dev-only tools.
 *
 * Note: code that must be dropped from the production bundle (the mock, dev tools) keeps its own
 * inline `import.meta.env.VITE_API_MOCK !== 'false'` / `import.meta.env.DEV` check, because the
 * bundler only removes dead branches it can see as literals at the call site.
 */
export interface AppEnv {
  /** axios baseURL, without a trailing slash. */
  apiUrl: string
  /** In-browser mock API (MSW) on. */
  apiMock: boolean
  /** Vite dev server (not a production build). */
  dev: boolean
  /** Vite mode: development, production, test… */
  mode: string
}

export class EnvError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid configuration: ${problems.join(' ')}`)
    this.name = 'EnvError'
  }
}

type RawEnv = Record<string, unknown>

/** Pure: raw env → typed config, or EnvError listing every problem. */
export function parseEnv(raw: RawEnv): AppEnv {
  const problems: string[] = []

  const mockRaw = raw.VITE_API_MOCK
  let apiMock = true
  if (mockRaw !== undefined && mockRaw !== '') {
    const v = String(mockRaw).trim().toLowerCase()
    if (v === 'false') apiMock = false
    else if (v !== 'true') problems.push(`VITE_API_MOCK must be "true" or "false" (got "${String(mockRaw)}").`)
  }

  const urlRaw = raw.VITE_API_URL
  let apiUrl = '/api'
  if (urlRaw !== undefined && String(urlRaw).trim() !== '') {
    const v = String(urlRaw).trim()
    if (v.startsWith('/')) apiUrl = v
    else {
      try {
        const u = new URL(v)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') problems.push(`VITE_API_URL must be http(s) (got "${v}").`)
        else apiUrl = v
      } catch {
        problems.push(`VITE_API_URL must be a path like "/api" or an absolute URL (got "${v}").`)
      }
    }
  }
  // (Real backend with VITE_API_URL unset = same origin under /api, e.g. behind a reverse proxy.)
  apiUrl = apiUrl.replace(/\/+$/, '') || '/'

  if (problems.length) throw new EnvError(problems)
  return { apiUrl, apiMock, dev: raw.DEV === true, mode: typeof raw.MODE === 'string' ? raw.MODE : 'production' }
}

let cached: AppEnv | null = null

/** The validated config (throws EnvError on a bad value; main.tsx shows it on the startup screen). */
export function getEnv(): AppEnv {
  if (!cached) cached = parseEnv(import.meta.env as unknown as RawEnv)
  return cached
}

/** Same, but never throws (falls back to the defaults); for module-level constants such as the axios baseURL. */
export function safeEnv(): AppEnv {
  try {
    return getEnv()
  } catch {
    return { apiUrl: '/api', apiMock: import.meta.env.VITE_API_MOCK !== 'false', dev: import.meta.env.DEV, mode: import.meta.env.MODE }
  }
}
