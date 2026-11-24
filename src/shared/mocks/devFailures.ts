import { http, HttpResponse } from 'msw'
import type { SetupWorker } from 'msw/browser'
import { API, apiPath } from './handlers/utils'

/**
 * Dev / e2e only (mock API on the dev server; dynamic import behind `import.meta.env.DEV`, never in
 * a production bundle): `window.__apexMock` makes matching mock requests fail, to see and test
 * error states without a real backend.
 *
 *   __apexMock.fail('/crm/customers', 500, { requestId: 'req-123' })  // 5xx with X-Request-Id
 *   __apexMock.fail('/leads', 'network')                             // no response at all
 *   __apexMock.clear()
 *
 * `path` is a prefix of the API path (without /api); `method` narrows it (default: any).
 */
interface FailureRule {
  path: string
  status: number | 'network'
  method?: string
  requestId?: string
}

export interface MockFailureHooks {
  fail(path: string, status?: number | 'network', options?: { method?: string; requestId?: string }): void
  clear(): void
}

export function installMockFailureHooks(worker: SetupWorker): MockFailureHooks {
  const rules: FailureRule[] = []
  worker.use(
    http.all(`${API}/*`, ({ request }) => {
      const path = apiPath(request)
      const rule = rules.find((r) => path.startsWith(r.path) && (!r.method || r.method.toUpperCase() === request.method))
      if (!rule) return undefined
      if (rule.status === 'network') return HttpResponse.error()
      return HttpResponse.json(
        { message: 'Simulated failure (dev).', ...(rule.requestId ? { requestId: rule.requestId } : {}) },
        { status: rule.status, headers: rule.requestId ? { 'X-Request-Id': rule.requestId } : undefined },
      )
    }),
  )
  const hooks: MockFailureHooks = {
    fail(path, status = 500, options = {}) {
      rules.push({ path, status, method: options.method, requestId: options.requestId })
    },
    clear() {
      rules.length = 0
    },
  }
  ;(window as unknown as { __apexMock?: MockFailureHooks }).__apexMock = hooks
  return hooks
}
