import type { Session } from '@/shared/types'
import type { AppStore } from '@/app/store'
import { signedOut, tokensRefreshed, SESSION_STORAGE_KEY } from '@/store/authSlice'
import { toastAdded } from '@/store/uiSlice'
import { configureSession, http, readStoredSession, sessionGuard } from '@/shared/lib/axios'
import type { SessionTokens } from '@/shared/lib/httpSession'
import { onNetworkNotice, watchBrowserConnectivity } from '@/shared/lib/networkStatus'

/**
 * Wires the HTTP client's session layer (shared/lib/httpSession.ts) to the store:
 *  - refresh = POST /auth/refresh with the stored refresh token; rotated tokens go into the store
 *    (and from there to storage) without a session transition: same user, tenant and cache;
 *  - proactive refresh a minute before `expiresAt`; reactive refresh once on a 401 (in the client);
 *  - expiry → `onSessionExpired` listeners (SessionExpiryHost navigates to /login with the return
 *    path and the notice), then sign-out (the transition cancels and clears every query);
 *  - "a write failed while offline" notices → an error toast; browser online/offline events.
 * Called once by AppProviders.
 */

type ExpiredListener = () => void
const expiredListeners = new Set<ExpiredListener>()

/** SessionExpiryHost subscribes; without a listener the session is just signed out. */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener)
  return () => expiredListeners.delete(listener)
}

/** Refresh this long before the access token expires. */
export const REFRESH_LEAD_MS = 60_000
/** setTimeout's ceiling (~24.8 days); longer waits are re-armed. */
const MAX_TIMER_MS = 2_147_483_647

/** Pure: ms until the proactive refresh for an `expiresAt`, or null without one. */
export function refreshDelay(expiresAt: string | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return null
  return Math.min(MAX_TIMER_MS, Math.max(0, at - REFRESH_LEAD_MS - now))
}

/** Rotated tokens plus whose session they belong to (from the refresh response). */
export interface RefreshedTokens extends SessionTokens {
  userId?: string
  tenantId?: string
}

export async function postRefresh(refreshToken: string): Promise<RefreshedTokens> {
  const session = (await http.post<Session>('/auth/refresh', { refreshToken })).data
  return {
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    userId: session.user?.id,
    tenantId: session.tenant?.id,
  }
}

/**
 * Pure: do rotated tokens belong to the signed-in session? Compared by session IDENTITY (user +
 * tenant from the refresh response), not by access-token equality: the token may legitimately have
 * changed while the refresh was in flight, and dropping a rotated refresh token would sign the user
 * out on the next refresh (a real backend revokes the used one). Without identity info, fall back to
 * "the session still holds the token the refresh started from".
 */
export function acceptRotatedTokens(
  session: Pick<Session, 'token' | 'user' | 'tenant'> | null,
  previousToken: string,
  tokens: RefreshedTokens,
  storedToken?: string,
): boolean {
  if (!session) return false
  if (tokens.userId || tokens.tenantId) return tokens.userId === session.user.id && tokens.tenantId === session.tenant.id
  return session.token === previousToken || storedToken === previousToken
}

export function bindAuthSession(store: AppStore): () => void {
  const undoConfig = configureSession({
    refresh: postRefresh,
    saveTokens(previous, tokens) {
      // Signed out, or another user / workspace signed in, while the refresh was in flight: drop them.
      if (!acceptRotatedTokens(store.getState().auth.session, previous, tokens, readStoredSession()?.token)) return
      const { token, refreshToken, expiresAt } = tokens
      store.dispatch(tokensRefreshed({ token, refreshToken, expiresAt }))
    },
    expire() {
      if (!store.getState().auth.session) return
      // SessionExpiryHost navigates to /login and signs out; without it (no router), just sign out.
      if (expiredListeners.size) expiredListeners.forEach((l) => l())
      else store.dispatch(signedOut())
    },
  })

  // Proactive refresh, re-armed whenever the session's expiry changes.
  let timer: ReturnType<typeof setTimeout> | undefined
  let armedFor: string | undefined
  const arm = () => {
    const expiresAt = store.getState().auth.session?.expiresAt
    if (expiresAt === armedFor) return
    armedFor = expiresAt
    clearTimeout(timer)
    const delay = refreshDelay(expiresAt)
    if (delay === null) return
    timer = setTimeout(() => {
      armedFor = undefined
      // Still due? (A later refresh moved expiresAt.) Long waits are re-armed in chunks.
      const left = refreshDelay(store.getState().auth.session?.expiresAt)
      if (left === null) return
      if (left > 0) return arm()
      void sessionGuard.refreshNow().finally(arm)
    }, delay)
  }
  arm()
  const unsubscribe = store.subscribe(arm)

  // Another tab rotated the tokens of the same session: take them, so this tab never writes stale ones back.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== `apexcrm.${SESSION_STORAGE_KEY}` || !e.newValue) return
    try {
      const next = JSON.parse(e.newValue) as Partial<Session>
      const mine = store.getState().auth.session
      if (mine && next.token && next.token !== mine.token && next.user?.id === mine.user.id && next.tenant?.id === mine.tenant.id) {
        store.dispatch(tokensRefreshed({ token: next.token, refreshToken: next.refreshToken, expiresAt: next.expiresAt }))
      }
    } catch {
      // Ignore malformed values.
    }
  }
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) window.addEventListener('storage', onStorage)

  const offNotice = onNetworkNotice((n) => store.dispatch(toastAdded({ kind: 'error', title: n.title, body: n.body })))
  const offConnectivity = hasWindow ? watchBrowserConnectivity(window) : () => {}

  // Dev only (mock): window.__apexAuth to force expiry in e2e / by hand. Dropped from production builds.
  let offDev: (() => void) | undefined
  let disposed = false
  if (import.meta.env.DEV && import.meta.env.VITE_API_MOCK !== 'false' && import.meta.env.MODE !== 'test') {
    void import('@/app/devAuthHooks').then((m) => {
      if (!disposed) offDev = m.installDevAuthHooks(store)
    })
  }

  return () => {
    disposed = true
    undoConfig()
    clearTimeout(timer)
    unsubscribe()
    if (hasWindow) window.removeEventListener('storage', onStorage)
    offNotice()
    offConnectivity()
    offDev?.()
  }
}
