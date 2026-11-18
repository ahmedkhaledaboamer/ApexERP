import type { User } from '@/shared/types'
import { ApiError } from '@/shared/lib/apiError'
import { registerMap } from '@/shared/mocks/persist/registry'

/**
 * Tenant isolation for the mock API. Mirrors what the real backend does:
 *  - the tenant comes from the authenticated user (session token → active membership), never
 *    from the request body, query or path;
 *  - every tenant-owned record carries `companyId`; list endpoints filter by it;
 *  - a record that belongs to another company answers 404 "not found", exactly like a missing
 *    one, so ids from other tenants can't be probed;
 *  - uniqueness (duplicate leads, list values, emails) is checked within the company only.
 */

export interface TenantOwned {
  companyId: string
}

/** Server-side row type: a client-facing record plus its company. Type every mock store as Tenant<T>[]. */
export type Tenant<T> = T & TenantOwned

/**
 * ApiError with a machine-readable `code` (workspace_not_found, tenant_mismatch, ...). `details` are
 * extra body fields sent next to `{ message, code }` (e.g. LIMIT_REACHED's limit/current/max/planId);
 * the client keeps the whole body on the error as `details`.
 */
export class CodedApiError extends ApiError {
  constructor(
    message: string,
    status: number,
    code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message, status, code)
  }
}

export const NOT_FOUND = 'Not found.'

/** The tenant of the signed-in user. */
export function tenantOf(user: Pick<User, 'companyId'>): string {
  if (!user.companyId) throw new ApiError('Your session has no workspace. Sign in again.', 401)
  return user.companyId
}

/** Predicate: the record belongs to the user's company. */
export function inTenant(user: Pick<User, 'companyId'>) {
  const companyId = tenantOf(user)
  return (row: TenantOwned) => row.companyId === companyId
}

/** Rows of the user's company only. */
export function scoped<T extends TenantOwned>(rows: readonly T[], user: Pick<User, 'companyId'>): T[] {
  return rows.filter(inTenant(user))
}

/** First matching row in the user's company, or undefined (other companies' rows are invisible). */
export function findInTenant<T extends TenantOwned>(
  rows: readonly T[],
  user: Pick<User, 'companyId'>,
  predicate: (row: T) => boolean,
): T | undefined {
  const companyId = tenantOf(user)
  return rows.find((r) => r.companyId === companyId && predicate(r))
}

/** Like findInTenant, but a miss (including another company's record) throws 404. */
export function getInTenant<T extends TenantOwned & { id: string }>(
  rows: readonly T[],
  user: Pick<User, 'companyId'>,
  id: string,
  message = NOT_FOUND,
): T {
  const row = findInTenant(rows, user, (r) => r.id === id)
  if (!row) throw new ApiError(message, 404)
  return row
}

/** Stamps a new record with the user's company. The client never supplies companyId. */
export function stamp<T extends object>(row: T, user: Pick<User, 'companyId'>): T & TenantOwned {
  return Object.assign(row, { companyId: tenantOf(user) })
}

/**
 * Per-tenant singleton state (settings objects, lookup lists, rule sets). Lazily seeded on first
 * read for each company, so a new tenant starts from defaults. `name` is the store's unique key in
 * the persistence registry (dev mock DB saved in IndexedDB).
 */
export function perTenant<T>(seed: (companyId: string) => T, name: string) {
  const byCompany = registerMap(`perTenant:${name}`, new Map<string, T>())
  return {
    get(companyId: string): T {
      let v = byCompany.get(companyId)
      if (v === undefined) {
        v = seed(companyId)
        byCompany.set(companyId, v)
      }
      return v
    },
    set(companyId: string, value: T): void {
      byCompany.set(companyId, value)
    },
    /** Tests: drop all state so the next read re-seeds. */
    reset(): void {
      byCompany.clear()
    },
  }
}
