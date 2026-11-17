import type { User } from '@/shared/types'
import { ApiError } from '@/shared/lib/apiError'
import { users } from './db'

/**
 * Helpers for the in-memory mock API. Each call waits like a network request and returns
 * copies, so callers never mutate the db by accident. Swapping to a real backend means
 * replacing the module api functions with `http` calls (see shared/lib/axios.ts).
 */

const LATENCY_MS = 400

export function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS))
}

export async function fail(message: string, status: number): Promise<never> {
  await delay(null)
  throw new ApiError(message, status)
}

export function tokenFor(user: User): string {
  return `mock.${btoa(JSON.stringify({ sub: user.id, role: user.role, iat: Date.now() }))}`
}

export function ownerName(id: string): string {
  return users.find((u) => u.id === id)?.name ?? 'Unassigned'
}
