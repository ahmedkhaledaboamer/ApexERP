import type { User } from '@/shared/types'
import type { ImpersonationInfo } from '@/modules/tenancy/types'
import { ApiError } from '@/shared/lib/apiError'
import { users } from './db'

/**
 * Helpers for the in-memory mock API. Each call waits like a network request and returns
 * copies, so callers never mutate the db by accident.
 */

/** Simulated network latency; none under unit tests (Vitest sets MODE to 'test'). */
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 400

export function delay<T>(value: T): Promise<T> {
  // No latency (tests): stay asynchronous but skip the timer (a 0 ms timer still costs ~10 ms on Windows).
  if (LATENCY_MS === 0) return Promise.resolve().then(() => structuredClone(value))
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS))
}

export async function fail(message: string, status: number): Promise<never> {
  await delay(null)
  throw new ApiError(message, status)
}

/** Claims inside a mock bearer token (`mock.<base64 json>`). A real backend signs these. */
export type TokenClaims =
  | { kind: 'user'; sub: string; co: string; iat: number; imp?: ImpersonationInfo | null; exp?: number }
  | { kind: 'platform'; sub: string; iat: number }

/** Refresh token claims (POST /auth/refresh only; never accepted as an access token). */
export interface RefreshClaims {
  kind: 'refresh'
  sub: string
  co: string
  iat: number
  exp: number
}

/**
 * Session lifetimes (docs/API.md › Auth › Refresh). Long by default so a demo never signs out on its
 * own; the dev hook `window.__apexAuth.expireSession()` forces expiry. Real time (Date.now), not the
 * simulated billing clock: advancing the demo clock must not sign anyone out.
 */
export const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60_000
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000

/** base64 of the UTF-8 JSON, so non-Latin text in claims (an impersonation reason in Arabic, curly quotes) works. */
function encode(claims: TokenClaims | RefreshClaims): string {
  const bytes = new TextEncoder().encode(JSON.stringify(claims))
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return `mock.${btoa(bin)}`
}

function decode(payload: string): unknown {
  const bin = atob(payload)
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

/** Workspace session token: user + the company of their active membership (+ impersonator). */
export function tokenFor(user: User, imp: ImpersonationInfo | null = null): string {
  return encode({ kind: 'user', sub: user.id, co: user.companyId, iat: Date.now(), ...(imp ? { imp } : {}) })
}

/**
 * The tokens of a signed-in session: an access token that expires after ACCESS_TOKEN_TTL_MS and a
 * refresh token. Support sessions (impersonation) get no refresh token: their record decides when
 * they end (401 impersonation_expired).
 */
export function sessionTokensFor(user: User, imp: ImpersonationInfo | null = null): { token: string; refreshToken?: string; expiresAt?: string } {
  const iat = Date.now()
  if (imp) return { token: tokenFor(user, imp) }
  const exp = iat + ACCESS_TOKEN_TTL_MS
  return {
    token: encode({ kind: 'user', sub: user.id, co: user.companyId, iat, exp }),
    refreshToken: encode({ kind: 'refresh', sub: user.id, co: user.companyId, iat, exp: iat + REFRESH_TOKEN_TTL_MS }),
    expiresAt: new Date(exp).toISOString(),
  }
}

export function readRefreshToken(token: unknown): RefreshClaims | null {
  try {
    const parsed = decode(String(token ?? '').replace(/^mock\./, '')) as Partial<RefreshClaims>
    if (parsed.kind === 'refresh' && typeof parsed.sub === 'string' && typeof parsed.co === 'string' && typeof parsed.exp === 'number') {
      return parsed as RefreshClaims
    }
  } catch {
    // Malformed token.
  }
  return null
}

/** Platform console token; it can't open any workspace's data. */
export function platformTokenFor(platformUserId: string): string {
  return encode({ kind: 'platform', sub: platformUserId, iat: Date.now() })
}

export function readToken(authorization: string | null | undefined): TokenClaims | null {
  const token = String(authorization ?? '').replace(/^Bearer\s+/i, '')
  try {
    const parsed = decode(token.replace(/^mock\./, '')) as (Partial<TokenClaims> & { kind?: string }) | Partial<RefreshClaims>
    // A refresh token is never an access token.
    if (parsed.kind === 'refresh') return null
    if (parsed.kind === 'platform' && typeof parsed.sub === 'string') return parsed as TokenClaims
    if (typeof parsed.sub === 'string' && typeof (parsed as { co?: unknown }).co === 'string') {
      return { ...(parsed as TokenClaims), kind: 'user' } as TokenClaims
    }
  } catch {
    // Malformed token.
  }
  return null
}

/** Ids are unique across tenants, so a lookup by id can't reach another company's user by name collision. */
export function ownerName(id: string): string {
  return users.find((u) => u.id === id)?.name ?? 'Unassigned'
}
