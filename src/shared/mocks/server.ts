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
  | { kind: 'user'; sub: string; co: string; iat: number; imp?: ImpersonationInfo | null }
  | { kind: 'platform'; sub: string; iat: number }

/** base64 of the UTF-8 JSON, so non-Latin text in claims (an impersonation reason in Arabic, curly quotes) works. */
function encode(claims: TokenClaims): string {
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

/** Platform console token; it can't open any workspace's data. */
export function platformTokenFor(platformUserId: string): string {
  return encode({ kind: 'platform', sub: platformUserId, iat: Date.now() })
}

export function readToken(authorization: string | null | undefined): TokenClaims | null {
  const token = String(authorization ?? '').replace(/^Bearer\s+/i, '')
  try {
    const parsed = decode(token.replace(/^mock\./, '')) as Partial<TokenClaims> & { kind?: string }
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
