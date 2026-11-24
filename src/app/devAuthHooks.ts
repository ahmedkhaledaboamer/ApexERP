import type { AppStore } from '@/app/store'
import { tokensRefreshed } from '@/store/authSlice'
import { sessionGuard } from '@/shared/lib/axios'

/**
 * Dev / e2e only (mock API on, dev server): `window.__apexAuth` forces the session states that
 * otherwise take hours. Loaded with a dynamic import behind `import.meta.env.DEV`, so it is never in
 * a production bundle.
 *
 *  - expireAccessToken(): the access token stops working; the next request 401s, the client
 *    refreshes once and retries (the user notices nothing).
 *  - expireSession(): access AND refresh token stop working; the next request 401s, the refresh is
 *    refused → signed out, /login with "Your session expired" and the return path.
 *  - refreshNow(): runs the proactive refresh immediately.
 */
const INVALID = 'mock.expired'

export interface DevAuthHooks {
  expireAccessToken(): void
  expireSession(): void
  refreshNow(): Promise<boolean>
}

export function installDevAuthHooks(store: AppStore): () => void {
  const hooks: DevAuthHooks = {
    expireAccessToken() {
      if (store.getState().auth.session) store.dispatch(tokensRefreshed({ token: INVALID }))
    },
    expireSession() {
      if (store.getState().auth.session) store.dispatch(tokensRefreshed({ token: INVALID, refreshToken: INVALID }))
    },
    refreshNow: () => sessionGuard.refreshNow(),
  }
  const w = window as unknown as { __apexAuth?: DevAuthHooks }
  w.__apexAuth = hooks
  return () => {
    if (w.__apexAuth === hooks) delete w.__apexAuth
  }
}
