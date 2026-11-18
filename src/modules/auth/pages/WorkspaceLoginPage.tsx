import { useLayoutEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { currentWorkspace, setWorkspace } from '@/shared/lib/tenantContext'
import { useAppDispatch } from '@/store/hooks'
import { publicWorkspaceLoaded, tenantStatusChanged } from '@/store/tenantSlice'
import LoginPage from '@/modules/auth/pages/LoginPage'

/**
 * `/w/:subdomain` (and `/w/:subdomain/login`): one workspace's sign-in page on the bare domain.
 * Points the tab at that workspace, so TenantProvider loads its public branding (or shows
 * "Workspace not found"), then renders the normal sign-in screen.
 */
export default function WorkspaceLoginPage() {
  const { subdomain = '' } = useParams()
  const sub = subdomain.trim().toLowerCase()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const synced = currentWorkspace() === sub

  useLayoutEffect(() => {
    if (!sub || currentWorkspace() === sub) return
    setWorkspace(sub)
    dispatch(publicWorkspaceLoaded(null))
    dispatch(tenantStatusChanged({ status: 'ok' }))
    // Same URL, new location: TenantProvider re-renders and resolves the new workspace.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: location.state })
  }, [sub, dispatch, navigate, location.pathname, location.search, location.state])

  if (!synced) return null
  return <LoginPage />
}
