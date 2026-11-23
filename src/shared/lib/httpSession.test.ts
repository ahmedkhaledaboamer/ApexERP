import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '@/shared/lib/apiError'
import { createSessionGuard, installSessionInterceptors, isSessionFreeUrl, toApiError, type SessionTokens } from '@/shared/lib/httpSession'

type Reply = { status: number; data?: unknown; headers?: Record<string, string> } | 'network' | 'timeout'
type Handler = (config: InternalAxiosRequestConfig) => Reply | Promise<Reply>

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown = {}, headers: Record<string, string> = {}): AxiosResponse {
  const response: AxiosResponse = { data, status, statusText: '', headers: new AxiosHeaders(headers), config }
  if (status >= 200 && status < 300) return response
  throw new AxiosError('Request failed', status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, null, response)
}

/** An axios instance with a fake adapter, the session guard and a stored session. */
function setup(opts: { session?: SessionTokens | null; refresh?: ((rt: string) => Promise<SessionTokens>) | null; handler: Handler }) {
  let session: SessionTokens | null = opts.session === undefined ? { token: 'A1', refreshToken: 'R1' } : opts.session
  const expire = vi.fn(() => {
    session = null
  })
  const seen: { url?: string; auth?: string }[] = []
  const instance = axios.create({
    baseURL: '/api',
    adapter: async (config) => {
      seen.push({ url: config.url, auth: String(config.headers.Authorization ?? '') })
      const r = await opts.handler(config)
      if (r === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config, {})
      if (r === 'timeout') throw new AxiosError('timeout of 20000ms exceeded', 'ECONNABORTED', config, {})
      return reply(config, r.status, r.data, r.headers)
    },
  })
  const refresh = opts.refresh === undefined ? vi.fn(async () => ({ token: 'A2', refreshToken: 'R2' })) : opts.refresh
  const guard = createSessionGuard({
    readSession: () => session,
    refresh,
    saveTokens: (previous, tokens) => {
      if (session?.token === previous) session = { ...session, ...tokens }
    },
    expire,
  })
  installSessionInterceptors(instance, guard)
  return { instance, guard, expire, refresh, seen, get session() { return session } }
}

/** 401 unless the request carries the current good token. */
const authed = (good: () => string | undefined) => (config: InternalAxiosRequestConfig) =>
  config.headers.Authorization === `Bearer ${good()}` ? { status: 200, data: { ok: config.url } } : { status: 401, data: { message: 'Expired' } }

describe('session guard: 401 → refresh once → retry', () => {
  it('refreshes and retries a request that 401s', async () => {
    let good = 'A2'
    const t = setup({ handler: authed(() => good) })
    const res = await t.instance.get('/leads')
    expect(res.data).toEqual({ ok: '/leads' })
    expect(t.refresh).toHaveBeenCalledTimes(1)
    expect(t.session).toEqual({ token: 'A2', refreshToken: 'R2' })
    expect(t.expire).not.toHaveBeenCalled()
    good = 'x'
  })

  it('single flight: parallel 401s share one refresh and are all retried with the new token', async () => {
    let resolveRefresh!: (t: SessionTokens) => void
    const refresh = vi.fn(() => new Promise<SessionTokens>((r) => (resolveRefresh = r)))
    const t = setup({ refresh, handler: authed(() => 'A2') })
    const all = Promise.all(['/a', '/b', '/c', '/d'].map((u) => t.instance.get(u)))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // More requests fail while the refresh is in flight: they queue on the same refresh.
    const late = t.instance.get('/e')
    await new Promise((r) => setTimeout(r, 5))
    resolveRefresh({ token: 'A2', refreshToken: 'R2' })
    const results = await Promise.all([all, late])
    expect(results[0].map((r) => r.data.ok)).toEqual(['/a', '/b', '/c', '/d'])
    expect(results[1].data.ok).toBe('/e')
    expect(refresh).toHaveBeenCalledTimes(1)
    // Every retry carried the new token.
    expect(t.seen.filter((s) => s.auth === 'Bearer A2')).toHaveLength(5)
  })

  it('refresh refused → expire exactly once for many parallel 401s, all reject with the 401', async () => {
    const refresh = vi.fn(async () => {
      throw new ApiError('Your session has expired.', 401, 'session_expired')
    })
    const t = setup({ refresh, handler: () => ({ status: 401, data: { message: 'Expired' } }) })
    const results = await Promise.allSettled(['/a', '/b', '/c'].map((u) => t.instance.get(u)))
    expect(results.every((r) => r.status === 'rejected' && (r.reason as ApiError).status === 401)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(t.expire).toHaveBeenCalledTimes(1)
  })

  it('no refresh token → expire once, no refresh call', async () => {
    const t = setup({ session: { token: 'A1' }, handler: () => ({ status: 401 }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ status: 401 })
    expect(t.refresh).not.toHaveBeenCalled()
    expect(t.expire).toHaveBeenCalledTimes(1)
  })

  it('refresh not wired (unit tests / app not mounted) → the 401 just rejects', async () => {
    const t = setup({ refresh: null, handler: () => ({ status: 401 }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ status: 401 })
    expect(t.expire).toHaveBeenCalledTimes(1)
  })

  it('still 401 after the refresh → expire (no loop)', async () => {
    const t = setup({ handler: () => ({ status: 401 }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ status: 401 })
    expect(t.refresh).toHaveBeenCalledTimes(1)
    expect(t.expire).toHaveBeenCalledTimes(1)
    expect(t.seen).toHaveLength(2)
  })

  it('refresh unreachable (network) → keeps the session, fails the request only', async () => {
    const refresh = vi.fn(async () => {
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0, 'network_error')
    })
    const t = setup({ refresh, handler: () => ({ status: 401 }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ status: 401 })
    expect(t.expire).not.toHaveBeenCalled()
    expect(t.session).not.toBeNull()
  })

  it('ignores 401s of sign-in, refresh, platform and explicitly-authorized calls', async () => {
    const t = setup({ handler: () => ({ status: 401, data: { message: 'Wrong password' } }) })
    await expect(t.instance.post('/auth/login', {})).rejects.toMatchObject({ status: 401, message: 'Wrong password' })
    await expect(t.instance.post('/auth/login/2fa', {})).rejects.toMatchObject({ status: 401 })
    await expect(t.instance.get('/platform/overview', { headers: { Authorization: 'Bearer P1' } })).rejects.toMatchObject({ status: 401 })
    await expect(t.instance.get('/anything', { headers: { Authorization: 'Bearer other' } })).rejects.toMatchObject({ status: 401 })
    expect(t.refresh).not.toHaveBeenCalled()
    expect(t.expire).not.toHaveBeenCalled()
  })

  it('support-session endings (impersonation_*) are left to the impersonation banner', async () => {
    const t = setup({ handler: () => ({ status: 401, data: { message: 'Ended', code: 'impersonation_ended' } }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ code: 'impersonation_ended' })
    expect(t.refresh).not.toHaveBeenCalled()
    expect(t.expire).not.toHaveBeenCalled()
  })

  it('signed out → requests go without a token and a 401 does nothing', async () => {
    const t = setup({ session: null, handler: () => ({ status: 401 }) })
    await expect(t.instance.get('/a')).rejects.toMatchObject({ status: 401 })
    expect(t.seen[0].auth).toBe('')
    expect(t.expire).not.toHaveBeenCalled()
  })

  it('a request that raced a finished refresh is retried with the current token, without another refresh', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const check = authed(() => 'A2')
    const t = setup({
      handler: async (c) => {
        if (c.url === '/slow') await gate
        return check(c)
      },
    })
    const slow = t.instance.get('/slow') // sent with A1, answers after the refresh
    await t.instance.get('/fast') // 401 → refresh A1 → A2 → retried
    release()
    await expect(slow).resolves.toMatchObject({ data: { ok: '/slow' } })
    expect(t.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshNow (proactive): rotates the tokens; refused → expire', async () => {
    const ok = setup({ handler: () => ({ status: 200 }) })
    expect(await ok.guard.refreshNow()).toBe(true)
    expect(ok.session?.token).toBe('A2')
    const refused = setup({
      refresh: async () => {
        throw new ApiError('no', 401, 'session_expired')
      },
      handler: () => ({ status: 200 }),
    })
    expect(await refused.guard.refreshNow()).toBe(false)
    expect(refused.expire).toHaveBeenCalledTimes(1)
  })
})

describe('error mapping (toApiError)', () => {
  const config = { headers: new AxiosHeaders(), url: '/x' } as InternalAxiosRequestConfig

  it('5xx → friendly message with the request id from X-Request-Id; server text kept in details', async () => {
    const t = setup({ session: null, handler: () => ({ status: 503, data: { message: 'db down' }, headers: { 'X-Request-Id': 'req-42' } }) })
    const e = (await t.instance.get('/a').catch((x) => x)) as ApiError & { details?: unknown }
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(503)
    expect(e.requestId).toBe('req-42')
    expect(e.message).toBe(`${SERVER_ERROR_MESSAGE} (Reference: req-42)`)
    expect(e.details).toEqual({ message: 'db down' })
  })

  it('request id from the body when there is no header', () => {
    const e = toApiError(new AxiosError('x', 'ERR_BAD_RESPONSE', config, null, { data: { requestId: 'b-1' }, status: 500, statusText: '', headers: {}, config }))
    expect(e.requestId).toBe('b-1')
    expect(e.message).toContain('b-1')
  })

  it('4xx keeps the server message and code', () => {
    const e = toApiError(new AxiosError('x', 'ERR_BAD_REQUEST', config, null, { data: { message: 'Name is required.', code: 'invalid' }, status: 422, statusText: '', headers: {}, config }))
    expect(e).toMatchObject({ status: 422, code: 'invalid', message: 'Name is required.' })
  })

  it('4xx without a body gets a readable default', () => {
    const e = toApiError(new AxiosError('x', 'ERR_BAD_REQUEST', config, null, { data: '', status: 404, statusText: '', headers: {}, config }))
    expect(e.message).toBe('We couldn’t find that.')
  })

  it('no response → network_error; timeout → timeout with the server message; cancel → canceled', async () => {
    const net = setup({ session: null, handler: () => 'network' })
    await expect(net.instance.get('/a')).rejects.toMatchObject({ status: 0, code: 'network_error', message: NETWORK_ERROR_MESSAGE })
    const slow = setup({ session: null, handler: () => 'timeout' })
    await expect(slow.instance.get('/a')).rejects.toMatchObject({ status: 0, code: 'timeout', message: SERVER_ERROR_MESSAGE })
    expect(toApiError(new axios.CanceledError('stop'))).toMatchObject({ status: 0, code: 'canceled' })
  })
})

describe('isSessionFreeUrl', () => {
  it('matches the sign-in, refresh, dev, platform and public endpoints only', () => {
    for (const u of ['/auth/login', '/auth/login/2fa', '/auth/refresh', '/auth/dev/sign-in', '/platform/overview', '/public/workspaces/x']) expect(isSessionFreeUrl(u)).toBe(true)
    for (const u of ['/auth/me', '/leads', '/auth/switch-role', '/tenant']) expect(isSessionFreeUrl(u)).toBe(false)
  })
})
