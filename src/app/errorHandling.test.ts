import { describe, expect, it } from 'vitest'
import { MAX_QUERY_RETRIES, queryRetryDelay, shouldRetryQuery, shouldThrowToBoundary } from '@/app/queryClient'
import { REFRESH_LEAD_MS, refreshDelay } from '@/app/authSession'
import { isPublicPath } from '@/app/SessionExpiryHost'
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  friendlyErrorMessage,
  isTransientError,
  serverErrorMessage,
} from '@/shared/lib/apiError'
import { emitNetworkNotice, isOnline, onNetworkNotice, reportRequestFailed, reportRequestSucceeded, resetNetworkStatus, watchBrowserConnectivity } from '@/shared/lib/networkStatus'

const net = () => new ApiError(NETWORK_ERROR_MESSAGE, 0, 'network_error')
const timeout = () => new ApiError(SERVER_ERROR_MESSAGE, 0, 'timeout')
const cancelled = () => new ApiError('The request was cancelled.', 0, 'canceled')
const status = (s: number, code?: string) => new ApiError('x', s, code)

describe('query retry policy', () => {
  it('retries network, timeout and 5xx failures up to 2 times', () => {
    for (const e of [net(), timeout(), status(500), status(502), status(503)]) {
      expect(shouldRetryQuery(0, e)).toBe(true)
      expect(shouldRetryQuery(1, e)).toBe(true)
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, e)).toBe(false)
    }
  })

  it('never retries 4xx, cancellations or non-API errors', () => {
    for (const e of [status(400), status(401), status(402), status(403), status(404), status(409), status(410), status(422), status(423), status(429), cancelled(), new TypeError('x'), 'boom']) {
      expect(shouldRetryQuery(0, e)).toBe(false)
    }
  })

  it('backs off 1 s, 2 s, 4 s, capped at 8 s', () => {
    expect([0, 1, 2, 3, 10].map(queryRetryDelay)).toEqual([1000, 2000, 4000, 8000, 8000])
  })

  it('throws to the page boundary only for transient errors with no data to show', () => {
    expect(shouldThrowToBoundary(status(500), { state: { data: undefined } } as never)).toBe(true)
    expect(shouldThrowToBoundary(net(), { state: { data: undefined } } as never)).toBe(true)
    expect(shouldThrowToBoundary(status(500), { state: { data: [] } } as never)).toBe(false)
    expect(shouldThrowToBoundary(status(404), { state: { data: undefined } } as never)).toBe(false)
    expect(shouldThrowToBoundary(status(403), { state: { data: undefined } } as never)).toBe(false)
  })
})

describe('error messages', () => {
  it('maps every failure to a friendly message', () => {
    expect(friendlyErrorMessage(net())).toBe(NETWORK_ERROR_MESSAGE)
    expect(friendlyErrorMessage(timeout())).toBe(SERVER_ERROR_MESSAGE)
    expect(friendlyErrorMessage(new ApiError('internal', 500, undefined, 'req-9'))).toBe('Something went wrong on our side. Try again. (Reference: req-9)')
    expect(friendlyErrorMessage(new ApiError('Name is required.', 422))).toBe('Name is required.')
    expect(friendlyErrorMessage(new ApiError('', 400))).toBe(SERVER_ERROR_MESSAGE)
    expect(friendlyErrorMessage(new TypeError('Cannot read properties of undefined'))).toBe(SERVER_ERROR_MESSAGE)
    expect(friendlyErrorMessage(null)).toBe(SERVER_ERROR_MESSAGE)
  })

  it('serverErrorMessage adds the reference only when there is one', () => {
    expect(serverErrorMessage()).toBe(SERVER_ERROR_MESSAGE)
    expect(serverErrorMessage('abc')).toBe(`${SERVER_ERROR_MESSAGE} (Reference: abc)`)
  })

  it('ApiError carries status, code and request id', () => {
    const e = new ApiError('m', 503, 'down', 'r-1')
    expect(e).toMatchObject({ message: 'm', status: 503, code: 'down', requestId: 'r-1', name: 'ApiError' })
    expect(isTransientError(e)).toBe(true)
    expect(new ApiError('m', 400).requestId).toBeUndefined()
  })
})

describe('proactive refresh timing', () => {
  const now = Date.parse('2026-11-23T10:00:00Z')
  it('refreshes a minute before expiry, immediately when already due, never without expiresAt', () => {
    expect(refreshDelay('2026-11-23T11:00:00Z', now)).toBe(60 * 60_000 - REFRESH_LEAD_MS)
    expect(refreshDelay('2026-11-23T10:00:30Z', now)).toBe(0)
    expect(refreshDelay('2026-11-23T09:00:00Z', now)).toBe(0)
    expect(refreshDelay(undefined, now)).toBeNull()
    expect(refreshDelay('not a date', now)).toBeNull()
    // Far-future expiry is capped to what setTimeout can hold (re-armed later).
    expect(refreshDelay('2027-11-23T10:00:00Z', now)).toBe(2_147_483_647)
  })
})

describe('session expiry redirect', () => {
  it('only leaves pages of the signed-in app', () => {
    for (const p of ['/login', '/signup', '/w/crest', '/w/crest/login', '/platform', '/platform/companies', '/e/abc', '/pay/tok', '/legal/terms', '/verify/letter']) expect(isPublicPath(p)).toBe(true)
    for (const p of ['/dashboard', '/leads', '/crm/customers', '/events', '/finance', '/platformer', '/loginx']) expect(isPublicPath(p)).toBe(false)
  })
})

describe('network status', () => {
  it('a request without a response marks offline; any response or the online event clears it', () => {
    resetNetworkStatus(true)
    expect(isOnline()).toBe(true)
    reportRequestFailed()
    expect(isOnline()).toBe(false)
    reportRequestSucceeded()
    expect(isOnline()).toBe(true)

    const listeners: Record<string, () => void> = {}
    const target = { addEventListener: (t: string, l: () => void) => (listeners[t] = l), removeEventListener: () => {} }
    const off = watchBrowserConnectivity(target as never)
    listeners.offline()
    expect(isOnline()).toBe(false)
    listeners.online()
    expect(isOnline()).toBe(true)
    reportRequestFailed()
    listeners.online()
    expect(isOnline()).toBe(true)
    off()
  })

  it('failed-write notices are coalesced', () => {
    resetNetworkStatus(true)
    const got: string[] = []
    const off = onNetworkNotice((n) => got.push(n.title))
    emitNetworkNotice({ title: 'a', body: '' }, 10_000)
    emitNetworkNotice({ title: 'b', body: '' }, 11_000)
    emitNetworkNotice({ title: 'c', body: '' }, 14_000)
    off()
    expect(got).toEqual(['a', 'c'])
  })
})
