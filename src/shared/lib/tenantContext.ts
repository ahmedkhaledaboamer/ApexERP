import { hashKey, type QueryKey } from '@tanstack/react-query'

/**
 * Client-side tenant context that lives outside React: the active company id (for query keys and
 * storage prefixes) and the workspace the app was opened on. The company id is only ever read
 * from the server's session; it is never sent back in a request.
 */

let activeCompanyId: string | null = null

export function getActiveCompanyId(): string | null {
  return activeCompanyId
}

export function setActiveCompanyId(id: string | null): void {
  activeCompanyId = id
}

let activeUserId: string | null = null

/** The signed-in user (scopes per-user preferences and data in storage.ts). */
export function getActiveUserId(): string | null {
  return activeUserId
}

/** Sets company and user together (session transitions). */
export function setActiveIdentity(companyId: string | null, userId: string | null): void {
  activeCompanyId = companyId
  activeUserId = companyId ? userId : null
}

/**
 * The single helper that puts the company id into every TanStack Query key. Installed as the
 * QueryClient's `queryKeyHashFn`, so no hook can forget it: identical keys from two companies
 * never share a cache entry.
 */
export function tenantQueryKeyHash(queryKey: QueryKey): string {
  return hashKey([activeCompanyId ?? 'no-tenant', ...queryKey])
}

/** Same scoping for a key you build by hand (e.g. cache reads outside a hook). */
export function tenantQueryKey<T extends readonly unknown[]>(key: T): readonly [string, ...T] {
  return [activeCompanyId ?? 'no-tenant', ...key] as const
}

/* ---------------- Workspace address ---------------- */

/** Production root domain; `<subdomain>.apexcrm.app` opens a workspace. */
export const ROOT_DOMAIN = 'apexcrm.app'
export const WORKSPACE_STORAGE_KEY = 'apexcrm.workspace'
const SUBDOMAIN = /^([a-z0-9][a-z0-9-]{0,62})\.(?:apexcrm\.app|localhost)$/i
const RESERVED = new Set(['www', 'app', 'platform', 'admin', 'api'])
const WORKSPACE_PATH = /^\/w\/([a-z0-9][a-z0-9-]{0,62})(?:\/login)?\/?$/i

/**
 * The workspace this tab was opened on: the subdomain (`crest.apexcrm.app`, `crest.localhost`),
 * or in dev `?workspace=crest` (remembered for the tab; `?workspace=` clears it). Null on the bare
 * domain, where sign-in finds the workspace from the account.
 */
export function resolveWorkspace(
  loc: Pick<Location, 'hostname' | 'search'> & { pathname?: string } = window.location,
): string | null {
  const host = SUBDOMAIN.exec(loc.hostname)?.[1]?.toLowerCase()
  if (host && !RESERVED.has(host)) return host
  try {
    // Per-workspace sign-in page on the bare domain: /w/<subdomain>[/login].
    const path = WORKSPACE_PATH.exec(loc.pathname ?? '')?.[1]?.toLowerCase()
    if (path) {
      window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, path)
      return path
    }
    const param = new URLSearchParams(loc.search).get('workspace')
    if (param !== null) {
      const v = param.trim().toLowerCase()
      if (v) window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, v)
      else window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY)
      return v || null
    }
    return window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY)
  } catch {
    return null
  }
}

let workspace: string | null | undefined

/** Cached for the tab; call `refreshWorkspace()` after changing the address in dev. */
export function currentWorkspace(): string | null {
  if (workspace === undefined) workspace = typeof window === 'undefined' ? null : resolveWorkspace()
  return workspace
}

export function setWorkspace(next: string | null): void {
  workspace = next
  try {
    if (next) window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, next)
    else window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY)
  } catch {
    // Storage unavailable: the workspace lasts until reload.
  }
}

/* ---------------- Tenant errors raised by the API (axios → TenantProvider) ---------------- */

export type TenantErrorCode = 'workspace_not_found' | 'tenant_mismatch' | 'workspace_suspended' | 'workspace_deleted'
type TenantErrorListener = (code: TenantErrorCode, message: string) => void
const tenantErrorListeners = new Set<TenantErrorListener>()

export function onTenantError(listener: TenantErrorListener): () => void {
  tenantErrorListeners.add(listener)
  return () => tenantErrorListeners.delete(listener)
}

export function emitTenantError(code: string | undefined, message: string): void {
  if (code === 'workspace_not_found' || code === 'tenant_mismatch' || code === 'workspace_suspended' || code === 'workspace_deleted') {
    tenantErrorListeners.forEach((l) => l(code, message))
  }
}
