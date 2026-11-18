import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { Building2, ShieldAlert, Trash2, Unplug } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedOut, tenantRefreshed } from '@/store/authSlice'
import { publicWorkspaceLoaded, tenantStatusChanged } from '@/store/tenantSlice'
import { ApiError } from '@/shared/lib/apiError'
import { ROOT_DOMAIN, currentWorkspace, onTenantError, setWorkspace } from '@/shared/lib/tenantContext'
import { Button } from '@/shared/components/ui/Button'
import { getPublicWorkspace, getTenant } from '@/modules/tenancy/api'
import { useBranding } from '@/modules/tenancy/hooks'
import { PRODUCT_NAME, applyBranding, applyFavicon, brandTitle } from '@/modules/tenancy/branding'

/** Routes that don't belong to a workspace (platform console, product sign-up, public event registration). */
const isPlatformPath = (pathname: string) =>
  pathname.startsWith('/platform') || pathname === '/signup' || pathname.startsWith('/legal/') || pathname.startsWith('/e/')

/**
 * Resolves and enforces the tenant:
 *  - signed in: the tenant comes from the session (the server resolved it from the membership)
 *    and is refreshed from GET /tenant; if the app was opened on another workspace's address,
 *    the session doesn't match and the mismatch screen is shown (no tenant data is fetched);
 *  - signed out on a workspace address: loads that workspace's public branding, or shows
 *    "workspace not found";
 *  - applies the tenant palette to the brand CSS variables, the document title and the favicon.
 * The API also reports tenant problems (mismatch, not found, suspended) and those switch the
 * app to the same screens.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const session = useAppSelector((s) => s.auth.session)
  const status = useAppSelector((s) => s.tenant.status)
  const { pathname } = useLocation()
  const workspace = currentWorkspace()
  const branding = useBranding()
  const platform = isPlatformPath(pathname)

  // API-reported tenant errors.
  useEffect(
    () =>
      onTenantError((code, message) => {
        const map = {
          workspace_not_found: 'not_found',
          tenant_mismatch: 'mismatch',
          workspace_suspended: 'suspended',
          workspace_deleted: 'deleted',
        } as const
        dispatch(tenantStatusChanged({ status: map[code], message }))
      }),
    [dispatch],
  )

  // Session vs address: checked on the client too, so a mismatched tab never requests tenant data.
  const mismatch = !!session && !!workspace && session.tenant.subdomain !== workspace
  useEffect(() => {
    if (mismatch) dispatch(tenantStatusChanged({ status: 'mismatch' }))
    else if (status === 'mismatch' && session) dispatch(tenantStatusChanged({ status: 'ok' }))
  }, [mismatch, session, status, dispatch])

  // Refresh the tenant record (plan, modules, branding, regional settings) from the server.
  const tenantQuery = useQuery({
    queryKey: ['tenant', session?.tenant.id],
    queryFn: getTenant,
    enabled: !!session && !mismatch && !platform,
    staleTime: 5 * 60_000,
  })
  useEffect(() => {
    if (tenantQuery.data) dispatch(tenantRefreshed(tenantQuery.data))
  }, [tenantQuery.data, dispatch])

  // Public branding of the workspace address, before sign-in.
  const publicQuery = useQuery({
    queryKey: ['public-workspace', workspace],
    queryFn: () => getPublicWorkspace(workspace!),
    enabled: !session && !!workspace && !platform,
    retry: false,
    staleTime: Infinity,
  })
  useEffect(() => {
    if (publicQuery.data) {
      dispatch(publicWorkspaceLoaded(publicQuery.data))
      dispatch(tenantStatusChanged({ status: publicQuery.data.status === 'suspended' ? 'suspended' : 'ok' }))
    } else if (publicQuery.error instanceof ApiError && publicQuery.error.status === 404) {
      dispatch(publicWorkspaceLoaded(null))
      dispatch(tenantStatusChanged({ status: 'not_found', message: publicQuery.error.message }))
    }
  }, [publicQuery.data, publicQuery.error, dispatch])
  useEffect(() => {
    if (!workspace && !session && status !== 'ok') dispatch(tenantStatusChanged({ status: 'ok' }))
  }, [workspace, session, status, dispatch])

  useEffect(() => {
    applyBranding(branding)
    document.title = brandTitle(branding)
  }, [branding])

  // The workspace favicon while signed in to it or on its sign-in page; the product icon elsewhere
  // (bare domain, platform console, after sign-out).
  const faviconUrl = platform ? null : (branding.faviconUrl ?? null)
  useEffect(() => {
    applyFavicon(faviconUrl)
  }, [faviconUrl])

  if (!platform) {
    if (status === 'not_found') return <WorkspaceNotFound workspace={workspace} />
    if (status === 'mismatch') return <WorkspaceMismatch workspace={workspace} />
    if (status === 'suspended') return <WorkspaceSuspended />
    if (status === 'deleted') return <WorkspaceDeleted />
  }
  return <>{children}</>
}

function Screen({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-canvas px-4 py-16">
      <div role="alert" className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-sunken text-muted [&_svg]:size-6">{icon}</div>
        <h1 className="text-[1.25rem] font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 space-y-4 text-[0.875rem] text-muted">{children}</div>
        <p className="mt-8 text-[0.75rem] text-subtle">{PRODUCT_NAME}</p>
      </div>
    </div>
  )
}

/** Leaves the workspace address (dev: drops ?workspace=; prod: goes to the bare domain). */
function useLeaveWorkspace() {
  return () => {
    setWorkspace(null)
    if (window.location.hostname.endsWith(ROOT_DOMAIN)) window.location.href = `https://${ROOT_DOMAIN}/login`
    else window.location.href = '/login?workspace='
  }
}

export function WorkspaceNotFound({ workspace }: { workspace: string | null }) {
  const leave = useLeaveWorkspace()
  return (
    <Screen icon={<Unplug />} title="Workspace not found">
      <p>
        {workspace ? (
          <>
            There’s no workspace at <span className="font-mono text-ink-2">{workspace}</span>. Check the address, or ask your administrator for
            the right link.
          </>
        ) : (
          'We couldn’t find a workspace for this address.'
        )}
      </p>
      <Button variant="secondary" onClick={leave}>
        Go to sign in
      </Button>
    </Screen>
  )
}

export function WorkspaceMismatch({ workspace }: { workspace: string | null }) {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const session = useAppSelector((s) => s.auth.session)
  const leave = useLeaveWorkspace()
  const goToMine = () => {
    if (!session) return leave()
    setWorkspace(session.tenant.subdomain)
    if (window.location.hostname.endsWith(ROOT_DOMAIN)) window.location.href = `https://${session.tenant.subdomain}.${ROOT_DOMAIN}/`
    else window.location.href = `/dashboard?workspace=${session.tenant.subdomain}`
  }
  const signOut = () => {
    queryClient.clear()
    dispatch(signedOut())
    dispatch(tenantStatusChanged({ status: 'ok' }))
  }
  return (
    <Screen icon={<ShieldAlert />} title="This address belongs to another workspace">
      <p>
        You’re signed in to <span className="font-medium text-ink-2">{session?.tenant.name ?? 'another workspace'}</span>, but this address is
        for <span className="font-mono text-ink-2">{workspace ?? 'a different workspace'}</span>. Nothing from either workspace is shown here.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {session && <Button onClick={goToMine}>Open {session.tenant.branding.displayName}</Button>}
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </Screen>
  )
}

export function WorkspaceSuspended() {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const message = useAppSelector((s) => s.tenant.message)
  return (
    <Screen icon={<Building2 />} title="Workspace suspended">
      <p>{message ?? 'This workspace is suspended. Contact your administrator.'}</p>
      <Button
        variant="secondary"
        onClick={() => {
          queryClient.clear()
          dispatch(signedOut())
          dispatch(tenantStatusChanged({ status: 'ok' }))
        }}
      >
        Sign out
      </Button>
    </Screen>
  )
}

/** The subscription was cancelled and its retention period ended: the company's data was deleted. */
export function WorkspaceDeleted() {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const message = useAppSelector((s) => s.tenant.message)
  return (
    <Screen icon={<Trash2 />} title="Workspace deleted">
      <p>{message ?? 'This workspace was cancelled and its data has been deleted after the retention period.'}</p>
      <p>To start again, sign up for a new workspace.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            queryClient.clear()
            dispatch(signedOut())
            dispatch(tenantStatusChanged({ status: 'ok' }))
          }}
        >
          Sign out
        </Button>
      </div>
    </Screen>
  )
}
