import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { PATHS } from '@/app/paths'
import { onSessionExpired } from '@/app/authSession'
import { useAppDispatch } from '@/store/hooks'
import { signedOut } from '@/store/authSlice'

/** Router state the login page reads to say why the user is there. */
export interface SessionExpiredState {
  from: string
  reason: 'expired'
}

/** Pages that don't belong to the signed-in app: expiry there signs out without leaving the page. */
const PUBLIC_PREFIXES = ['/login', '/signup', '/w/', '/legal/', '/platform', '/e/', '/t/', '/s/', '/f/', '/p/', '/pay/', '/verify/']

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))
}

/**
 * The session expired (a 401 the client couldn't fix by refreshing): go to /login with the return
 * path and the "Your session expired" notice, then sign out (the session transition cancels and
 * clears every query). Mounted once inside the router (AppProviders).
 */
export function SessionExpiryHost() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const location = useLocation()
  const here = useRef(location)
  here.current = location

  useEffect(
    () =>
      onSessionExpired(() => {
        const { pathname, search } = here.current
        if (isPublicPath(pathname)) {
          dispatch(signedOut())
          return
        }
        const state: SessionExpiredState = { from: pathname + search, reason: 'expired' }
        // Navigation and sign-out in ONE synchronous render: signed out on the old page, ProtectedRoute
        // would redirect first (dropping the notice); on /login still signed in, LoginPage would bounce
        // to the dashboard.
        flushSync(() => {
          navigate(PATHS.login, { replace: true, state })
          dispatch(signedOut())
        })
      }),
    [navigate, dispatch],
  )
  return null
}
