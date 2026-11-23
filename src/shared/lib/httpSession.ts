import axios, { type AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import {
  ApiError,
  CANCELED_CODE,
  NETWORK_ERROR_CODE,
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  TIMEOUT_CODE,
  isNetworkError,
  isTransientError,
  serverErrorMessage,
} from '@/shared/lib/apiError'

/**
 * The HTTP client's session and error layer (installed on `http` in axios.ts; pure enough to test
 * with a fake adapter):
 *
 *  - attaches the company session's bearer token (unless the call set its own Authorization, as the
 *    platform console does);
 *  - turns every failure into an ApiError with status, code and request id; 5xx / timeouts get the
 *    friendly "Something went wrong on our side" message, no response gets the network message;
 *  - on a 401 for a request that carried the session token: refreshes the session ONCE (single
 *    flight; every request that 401s meanwhile waits for the same refresh) and retries; if there is
 *    no refresh token or the refresh is refused, the session has expired → `expire()` exactly once
 *    for that session (the app signs out and goes to /login).
 */

export interface SessionTokens {
  token: string
  refreshToken?: string
  /** ISO time the access token stops working. */
  expiresAt?: string
}

export interface SessionGuardDeps {
  /** The stored company session (token + refresh token), or null when signed out. */
  readSession(): SessionTokens | null
  /** POST /auth/refresh. Null: refresh isn't wired (unit tests, app not mounted) → 401s just reject. */
  refresh: ((refreshToken: string) => Promise<SessionTokens>) | null
  /** Stores the rotated tokens (only if the same session is still signed in). */
  saveTokens(previousToken: string, tokens: SessionTokens): void
  /** The session is over: sign out and send the user to /login (called once per session). */
  expire(): void
}

/** Request config with the token the guard attached (so a 401 can tell which session it was for). */
export type SessionRequestConfig = InternalAxiosRequestConfig & { _sessionToken?: string; _authRetried?: boolean }

/** Endpoints whose 401 means "wrong credentials", not "session expired", or that never use the company session. */
const SESSION_FREE = [/\/auth\/login(\/2fa)?\/?$/, /\/auth\/refresh\/?$/, /\/auth\/dev\//, /\/platform\//, /\/public\//]

export function isSessionFreeUrl(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0]
  return SESSION_FREE.some((re) => re.test(path))
}

const isRefreshUrl = (url: string | undefined) => /\/auth\/refresh\/?$/.test((url ?? '').split('?')[0])

export function createSessionGuard(deps: SessionGuardDeps) {
  let inflight: Promise<SessionTokens> | null = null
  /** The session token we already expired (so parallel 401s produce one sign-out / redirect). */
  let expiredToken: string | null = null

  function expireOnce(token: string) {
    if (expiredToken === token) return
    expiredToken = token
    deps.expire()
  }

  /** Single flight: every caller during a refresh gets the same promise. */
  function refreshTokens(): Promise<SessionTokens> {
    if (inflight) return inflight
    const session = deps.readSession()
    const refresh = deps.refresh
    if (!session?.refreshToken || !refresh) return Promise.reject(new ApiError(SESSION_EXPIRED_MESSAGE, 401, 'session_expired'))
    const previous = session.token
    inflight = refresh(session.refreshToken)
      .then((tokens) => {
        deps.saveTokens(previous, tokens)
        return tokens
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return {
    /** Request interceptor: adds the session's bearer token. */
    attach(config: SessionRequestConfig): SessionRequestConfig {
      if (config.headers.Authorization || isRefreshUrl(config.url)) return config
      const token = deps.readSession()?.token
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
        config._sessionToken = token
      }
      return config
    },

    /**
     * Proactive refresh (before `expiresAt`). Shares the in-flight refresh with reactive ones.
     * Refused → the session expired; network trouble → keep the session (a 401 later retries).
     */
    async refreshNow(): Promise<boolean> {
      const session = deps.readSession()
      if (!session?.refreshToken || !deps.refresh) return false
      try {
        await refreshTokens()
        return true
      } catch (e) {
        if (!isTransientError(e)) expireOnce(session.token)
        return false
      }
    },

    /** Response-error path for a 401. Resolves with the retried response or rejects with `error`. */
    async onUnauthorized(error: ApiError, config: SessionRequestConfig | undefined, resend: (config: SessionRequestConfig) => Promise<AxiosResponse>): Promise<AxiosResponse> {
      // Not a company-session request (sign-in, public, platform console with its own token).
      if (!config?._sessionToken || isSessionFreeUrl(config.url)) throw error
      // Support sessions end through the impersonation banner (back to the console), not /login.
      if (error.code?.startsWith('impersonation_')) throw error
      const current = deps.readSession()
      if (!current?.token || current.token === expiredToken) throw error
      const retryWith = (token: string) => {
        config._authRetried = true
        config._sessionToken = token
        config.headers.Authorization = `Bearer ${token}`
        return resend(config)
      }
      if (config._authRetried) {
        expireOnce(current.token)
        throw error
      }
      // Another request refreshed the session while this one was in flight.
      if (current.token !== config._sessionToken) return retryWith(current.token)
      if (!current.refreshToken || !deps.refresh) {
        expireOnce(current.token)
        throw error
      }
      let tokens: SessionTokens
      try {
        tokens = await refreshTokens()
      } catch (e) {
        // The refresh couldn't reach the server: keep the session, fail this request only.
        if (!isTransientError(e)) expireOnce(current.token)
        throw error
      }
      return retryWith(tokens.token)
    },
  }
}

export type SessionGuard = ReturnType<typeof createSessionGuard>

/* ---------------- Error mapping ---------------- */

interface ErrorBody {
  message?: unknown
  code?: unknown
  requestId?: unknown
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>
  const v = typeof h.get === 'function' ? h.get(name) : (h[name] ?? h[name.toLowerCase()])
  return typeof v === 'string' && v ? v : undefined
}

function defaultMessage(status: number): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE
  if (status === 403) return 'You don’t have access to this.'
  if (status === 404) return 'We couldn’t find that.'
  if (status === 429) return 'Too many requests. Wait a moment and try again.'
  return `The request failed (${status}).`
}

/**
 * Pure: axios error → ApiError. Keeps the response body as `details` (e.g. the Won flow's failed
 * `step`, LIMIT_REACHED fields) and the server's own 5xx message there too.
 */
export function toApiError(error: AxiosError<unknown>): ApiError & { details?: unknown } {
  const res = error.response
  if (!res) {
    const code: string | undefined = error.code
    if (code === 'ERR_CANCELED' || axios.isCancel(error)) return new ApiError('The request was cancelled.', 0, CANCELED_CODE)
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return new ApiError(SERVER_ERROR_MESSAGE, 0, TIMEOUT_CODE)
    return new ApiError(NETWORK_ERROR_MESSAGE, 0, NETWORK_ERROR_CODE)
  }
  const body = (res.data && typeof res.data === 'object' ? res.data : {}) as ErrorBody
  const requestId = headerValue(res.headers, 'x-request-id') ?? (typeof body.requestId === 'string' ? body.requestId : undefined)
  const code = typeof body.code === 'string' ? body.code : undefined
  const serverMessage = typeof body.message === 'string' && body.message ? body.message : undefined
  const message = res.status >= 500 ? serverErrorMessage(requestId) : (serverMessage ?? defaultMessage(res.status))
  return Object.assign(new ApiError(message, res.status, code, requestId), { details: res.data })
}

/* ---------------- Installation ---------------- */

export interface InterceptorHooks {
  /** Extra request headers (X-Workspace). */
  decorate?(config: SessionRequestConfig): void
  /** Called for every error response (tenant / billing / impersonation event emitters). */
  onErrorResponse?(error: ApiError & { details?: unknown }): void
  /** Network status reporting. */
  onReachable?(): void
  onUnreachable?(): void
}

export function installSessionInterceptors(instance: AxiosInstance, guard: SessionGuard, hooks: InterceptorHooks = {}): void {
  instance.interceptors.request.use((config: SessionRequestConfig) => {
    guard.attach(config)
    hooks.decorate?.(config)
    return config
  })
  instance.interceptors.response.use(
    (res) => {
      hooks.onReachable?.()
      return res
    },
    async (raw: AxiosError<unknown>) => {
      const error = toApiError(raw)
      if (raw.response) {
        hooks.onReachable?.()
        hooks.onErrorResponse?.(error)
      } else if (isNetworkError(error)) {
        hooks.onUnreachable?.()
      }
      if (error.status === 401) return guard.onUnauthorized(error, raw.config as SessionRequestConfig | undefined, (c) => instance.request(c))
      throw error
    },
  )
}
