import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { onPlatformUnauthorized } from '@/modules/platform/api'
import { platformKeys, usePlatform } from '@/modules/platform/hooks'
import { platformHome } from '@/modules/platform/permissions'
import { PlatformLayout, RequirePlatform, RequirePlatformPermission } from '@/modules/platform/components/PlatformLayout'
import PlatformLoginPage from '@/modules/platform/pages/PlatformLoginPage'
import OverviewPage from '@/modules/platform/pages/OverviewPage'
import CompaniesPage from '@/modules/platform/pages/CompaniesPage'
import CompanyPage from '@/modules/platform/pages/CompanyPage'
import PlansPage from '@/modules/platform/pages/PlansPage'
import PlatformSettingsPage from '@/modules/platform/pages/PlatformSettingsPage'
import AnnouncementsPage from '@/modules/platform/pages/AnnouncementsPage'
import PlatformAuditPage from '@/modules/platform/pages/PlatformAuditPage'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedOut } from '@/store/authSlice'
import { platformSignedOut } from '@/store/tenantSlice'
import { Toaster, useToast } from '@/shared/components/ui/Toast'

/** Navigation state used to come back from a support session (ImpersonationBanner). */
export interface ReturnFromSupportState {
  endSupportSession?: boolean
  notice?: { title: string; body?: string }
}

/**
 * The Super-Admin Console (/platform/*), loaded lazily so the company bundle doesn't carry it.
 * Its own sign-in, layout and guards; it never renders inside the company AppLayout, and a company
 * session never grants access (only state.tenant.platform does).
 */
export default function PlatformApp() {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()

  // An expired or foreign platform token ends the platform session (→ /platform/login).
  useEffect(
    () =>
      onPlatformUnauthorized(() => {
        queryClient.removeQueries({ queryKey: platformKeys.all })
        dispatch(platformSignedOut())
      }),
    [dispatch, queryClient],
  )

  return (
    <>
      <ReturnFromSupportSession />
      <Routes>
        <Route path="login" element={<PlatformLoginPage />} />
        <Route
          element={
            <RequirePlatform>
              <PlatformLayout />
            </RequirePlatform>
          }
        >
          <Route
            index
            element={
              <RequirePlatformPermission anyOf={['tenants:view']}>
                <OverviewPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="companies"
            element={
              <RequirePlatformPermission anyOf={['tenants:view']}>
                <CompaniesPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="companies/:id"
            element={
              <RequirePlatformPermission anyOf={['tenants:view']}>
                <CompanyPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="plans"
            element={
              <RequirePlatformPermission anyOf={['plans:manage', 'billing:view']}>
                <PlansPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="settings"
            element={
              <RequirePlatformPermission anyOf={['plans:manage']}>
                <PlatformSettingsPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="announcements"
            element={
              <RequirePlatformPermission anyOf={['announcements:manage']}>
                <AnnouncementsPage />
              </RequirePlatformPermission>
            }
          />
          <Route
            path="audit"
            element={
              <RequirePlatformPermission anyOf={['audit:view']}>
                <PlatformAuditPage />
              </RequirePlatformPermission>
            }
          />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}

function HomeRedirect() {
  const { perms } = usePlatform()
  return <Navigate to={platformHome(perms)} replace />
}

/**
 * Back from a support session (ended, expired or stopped): drop the company session HERE, outside
 * the company routes (signing out there would let the company guard redirect to /login first),
 * then show the notice. The transition clears the query cache and the user's stored data.
 */
function ReturnFromSupportSession() {
  const location = useLocation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const toast = useToast()
  const impersonating = useAppSelector((s) => !!s.auth.session?.impersonation)
  const handled = useRef<string | null>(null)
  const state = location.state as ReturnFromSupportState | null

  useEffect(() => {
    if (!state?.endSupportSession || handled.current === location.key) return
    handled.current = location.key
    if (impersonating) dispatch(signedOut())
    // After the sign-out (which resets the UI slice), so the notice survives.
    if (state.notice) toast.info(state.notice.title, state.notice.body)
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [state, impersonating, location.key, location.pathname, location.search, dispatch, navigate, toast])

  return null
}
