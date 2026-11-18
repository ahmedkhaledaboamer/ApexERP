import type { QueryClient } from '@tanstack/react-query'
import type { AppStore, RootState } from '@/app/store'
import { loadUserPrefs } from '@/app/store'
import { tenantContextReset } from '@/store/tenantSlice'
import { clearUserData } from '@/shared/lib/storage'
import { setActiveIdentity } from '@/shared/lib/tenantContext'
import { setRegion } from '@/shared/lib/region'

/** Who the app is acting as: user + company + impersonation. Any change is a session transition. */
function identityOf(state: RootState): string {
  const s = state.auth.session
  return s ? `${s.user.id}|${s.tenant.id}|${s.impersonation?.platformUserId ?? ''}:${s.impersonation?.startedAt ?? ''}` : ''
}

export type TransitionKind = 'login' | 'logout' | 'tenant-switch' | 'user-switch' | 'impersonation-start' | 'impersonation-stop'

type SessionValue = RootState['auth']['session']

/** One support session = operator + start time (write mode keeps it; a new session changes it). */
function impersonationId(s: SessionValue): string | null {
  return s?.impersonation ? `${s.impersonation.platformUserId}:${s.impersonation.startedAt}` : null
}

export function transitionKind(prev: SessionValue, next: SessionValue): TransitionKind {
  const prevImp = impersonationId(prev)
  const nextImp = impersonationId(next)
  // Support sessions are their own transitions, whatever the company/user before or after.
  if (nextImp && nextImp !== prevImp) return 'impersonation-start'
  if (prevImp && nextImp !== prevImp) return 'impersonation-stop'
  if (!next) return 'logout'
  if (!prev) return 'login'
  return prev.tenant.id !== next.tenant.id ? 'tenant-switch' : 'user-switch'
}

/** Transitions that also wipe the user data kept in storage (drafts, cached records, session flags). */
export const WIPES_USER_DATA: ReadonlySet<TransitionKind> = new Set<TransitionKind>(['logout', 'tenant-switch', 'impersonation-start', 'impersonation-stop'])

/**
 * The one place session transitions are handled (sign-in, sign-out, tenant switch, role/user
 * switch, impersonation start/stop). It runs synchronously inside the dispatch, before React
 * renders the new session:
 *  1. points query keys and scoped storage at the new company + user;
 *  2. cancels and drops the whole TanStack Query cache (every transition);
 *  3. on sign-out, tenant switch and impersonation start/stop, wipes user data in storage (drafts,
 *     cached records), so nothing the operator saw or typed as the user survives either way;
 *     UI preferences are kept, scoped by company + user;
 *  4. resets tenant-scoped Redux state and loads the incoming user's own preferences.
 * Regional settings follow the session's tenant whenever it changes.
 */
export function watchSessionTransitions(store: AppStore, queryClient: QueryClient, { persist }: { persist: boolean }): () => void {
  let lastIdentity = identityOf(store.getState())
  let lastSession = store.getState().auth.session
  let lastTenant = lastSession?.tenant ?? null
  return store.subscribe(() => {
    const state = store.getState()
    const session = state.auth.session
    const tenant = session?.tenant ?? null
    if (tenant !== lastTenant) {
      lastTenant = tenant
      setRegion(tenant?.regional ?? null)
    }
    const identity = identityOf(state)
    if (identity === lastIdentity) {
      lastSession = session
      return
    }
    const kind = transitionKind(lastSession, session)
    lastIdentity = identity
    lastSession = session
    setActiveIdentity(tenant?.id ?? null, session?.user.id ?? null)
    void queryClient.cancelQueries()
    queryClient.clear()
    if (persist && WIPES_USER_DATA.has(kind)) clearUserData()
    store.dispatch(tenantContextReset(persist && session ? loadUserPrefs() : null))
  })
}
