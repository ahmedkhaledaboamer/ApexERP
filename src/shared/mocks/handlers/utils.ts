import { HttpResponse } from 'msw'
import type { User } from '@/shared/types'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'

/** Base path the mock answers on; matches the axios baseURL. */
export const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

/** Reads the signed-in user from the mock bearer token (`mock.<base64 json>`). */
export function userFrom(request: Request): User {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { sub } = JSON.parse(atob(token.replace(/^mock\./, ''))) as { sub: string }
    const user = users.find((u) => u.id === sub)
    // A deactivated account loses access immediately, even with a token issued earlier.
    if (user && user.active === false) throw new ApiError('This account is deactivated.', 401)
    if (user) return user
  } catch {
    // Malformed token: treated as signed out below.
  }
  throw new ApiError('Your session has expired. Sign in again.', 401)
}

/** Runs a mock service call and turns its result, or its ApiError, into an HTTP response. */
export async function respond<T>(run: () => Promise<T> | T): Promise<Response> {
  try {
    return HttpResponse.json((await run()) as never)
  } catch (error) {
    if (error instanceof ApiError) return HttpResponse.json({ message: error.message }, { status: error.status })
    throw error
  }
}
