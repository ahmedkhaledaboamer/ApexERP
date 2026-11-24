/**
 * Error shape every API call rejects with; `status` mirrors the HTTP status (0 when no response
 * arrived: offline, connection refused, timeout, cancelled). `code` is a stable machine-readable
 * reason for cases the UI branches on (workspace_not_found, tenant_mismatch, session_expired, …);
 * the client adds `network_error`, `timeout` and `canceled` for failures without a response.
 * `requestId` is the server's `X-Request-Id` (or `requestId` in the body), shown with server errors
 * so support can find the request in the logs.
 */
export class ApiError extends Error {
  public requestId?: string

  constructor(
    message: string,
    public status: number,
    public code?: string,
    requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    if (requestId) this.requestId = requestId
  }
}

/** Client-side codes for failures without an HTTP response. */
export const NETWORK_ERROR_CODE = 'network_error'
export const TIMEOUT_CODE = 'timeout'
export const CANCELED_CODE = 'canceled'

export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Try again.'
export const NETWORK_ERROR_MESSAGE = 'We couldn’t reach the server. Check your connection and try again.'
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again.'

/** No response at all (offline, DNS, connection refused). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0 && error.code === NETWORK_ERROR_CODE
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0 && error.code === TIMEOUT_CODE
}

export function isServerError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 500
}

/** Worth retrying / showing "try again": network failure, timeout or 5xx. Never a 4xx. */
export function isTransientError(error: unknown): boolean {
  return isNetworkError(error) || isTimeoutError(error) || isServerError(error)
}

/** "Something went wrong on our side. Try again. (Reference: abc-123)" */
export function serverErrorMessage(requestId?: string): string {
  return requestId ? `${SERVER_ERROR_MESSAGE} (Reference: ${requestId})` : SERVER_ERROR_MESSAGE
}

/**
 * The message to show for any thrown value. ApiErrors already carry a friendly message (the axios
 * interceptor rewrites 5xx / network / timeout messages); anything else (a crash in our own code)
 * gets the generic one, never a stack-trace-ish `TypeError: …`.
 */
export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
    if (isTimeoutError(error) || isServerError(error)) return serverErrorMessage(error.requestId)
    return error.message || SERVER_ERROR_MESSAGE
  }
  return SERVER_ERROR_MESSAGE
}
