import { useMutation, useQueryClient } from '@tanstack/react-query'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Building2, LayoutDashboard, Layers, LifeBuoy, LogOut, Megaphone, ScrollText, Settings2, ShieldHalf, type LucideIcon } from 'lucide-react'
import type { PlatformPermissionV2 } from '@/modules/platform/types'
import { PLATFORM_PATHS, navItemAllowed, platformHome, visiblePlatformNav, type PlatformNavId } from '@/modules/platform/permissions'
import { platformKeys, usePlatform } from '@/modules/platform/hooks'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { stopImpersonation } from '@/modules/tenancy/api'
import { PATHS } from '@/app/paths'
import { cn } from '@/shared/lib/utils'
import { setWorkspace } from '@/shared/lib/tenantContext'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedOut } from '@/store/authSlice'
import { platformSignedOut } from '@/store/tenantSlice'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'

const ICONS: Record<PlatformNavId, LucideIcon> = {
  overview: LayoutDashboard,
  companies: Building2,
  plans: Layers,
  settings: Settings2,
  announcements: Megaphone,
  audit: ScrollText,
}

/** No platform session → the platform sign-in. A company session never counts. */
export function RequirePlatform({ children }: { children: ReactNode }) {
  const platform = useAppSelector((s) => s.tenant.platform)
  const location = useLocation()
  if (!platform) return <Navigate to={PLATFORM_PATHS.login} replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

/** Page-level permission guard: without any of `anyOf`, go to the first page the operator may open. */
export function RequirePlatformPermission({ anyOf, children }: { anyOf: PlatformPermissionV2[]; children: ReactNode }) {
  const { perms } = usePlatform()
  if (!navItemAllowed({ anyOf }, perms)) {
    const home = platformHome(perms)
    // Nothing allowed at all: show a plain message instead of redirecting in a loop.
    if (!navItemAllowed({ anyOf: ['tenants:view'] }, perms) && home === PLATFORM_PATHS.root) {
      return (
        <div className="p-10 text-center text-[0.875rem] text-muted" role="alert">
          Your platform role has no access to this page.
        </div>
      )
    }
    return <Navigate to={home} replace />
  }
  return <>{children}</>
}

/** The console's own shell (never the company AppLayout): sidebar by permission, header with the operator. */
export function PlatformLayout() {
  const { session, perms } = usePlatform()
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const items = visiblePlatformNav(perms)
  const user = session.platformUser

  function signOut() {
    queryClient.removeQueries({ queryKey: platformKeys.all })
    dispatch(platformSignedOut())
    navigate(PLATFORM_PATHS.login, { replace: true })
  }

  const nav = (mobile: boolean) =>
    items.map((item) => {
      const Icon = ICONS[item.id]
      return (
        <NavLink
          key={item.id}
          id={mobile ? undefined : `platform-nav-${item.id}`}
          data-nav={item.id}
          to={item.to}
          end={item.id === 'overview'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
              mobile ? 'h-8 px-2.5' : 'h-9 px-3',
              isActive ? 'bg-sunken text-ink' : 'text-muted hover:bg-hover hover:text-ink',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {item.label}
        </NavLink>
      )
    })

  return (
    <div id="platform-console" className="flex h-full min-h-0 bg-canvas">
      <aside aria-label="Platform navigation" className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface lg:flex">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink text-surface">
            <ShieldHalf className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[0.875rem] font-semibold">{PRODUCT_NAME}</p>
            <p className="text-[0.6875rem] font-medium tracking-[0.12em] text-muted uppercase">Super-Admin</p>
          </div>
        </div>
        <nav id="platform-nav" aria-label="Console sections" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {nav(false)}
        </nav>
        <p className="border-t border-line px-4 py-3 text-xs text-subtle">Every change is audited.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header id="platform-header" className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink text-surface lg:hidden">
            <ShieldHalf className="size-4" aria-hidden />
          </span>
          <p className="text-[0.875rem] font-semibold lg:hidden">Console</p>
          <div className="ms-auto flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-end leading-tight sm:block">
              <p id="platform-user-name" className="truncate text-[0.8125rem] font-medium">
                {user.name}
              </p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <span id="platform-user-role" data-role={user.platformRole}>
              <Badge tone="brand">{user.platformRole}</Badge>
            </span>
            <Avatar name={user.name} size="sm" />
            <Button id="platform-signout" variant="ghost" size="sm" onClick={signOut}>
              <LogOut />
              <span className="max-sm:sr-only">Sign out</span>
            </Button>
          </div>
        </header>
        <nav aria-label="Console sections (compact)" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:hidden">
          {nav(true)}
        </nav>
        <OpenSupportSessionNotice />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** An impersonation is still open in this browser (e.g. the operator came back by URL). */
function OpenSupportSessionNotice() {
  const company = useAppSelector((s) => (s.auth.session?.impersonation ? s.auth.session : null))
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  // Coming back from the session: PlatformApp is ending it right now.
  const returning = !!(useLocation().state as { endSupportSession?: boolean } | null)?.endSupportSession
  const stop = useMutation({
    mutationFn: stopImpersonation,
    onSettled: () => {
      setWorkspace(null)
      dispatch(signedOut())
    },
  })
  if (!company || returning) return null
  return (
    <div
      id="platform-open-support-session"
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning-100 bg-warning-50 px-4 py-2 text-[0.8125rem] text-warning-700 sm:px-6 dark:border-warning-500/30 dark:bg-warning-500/15 dark:text-warning-500"
    >
      <LifeBuoy className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        A support session as <span className="font-semibold">{company.user.name}</span> ({company.tenant.name}) is still open.
      </p>
      <Button size="sm" variant="secondary" 
        onClick={() => {
          setWorkspace(company.tenant.subdomain)
          navigate(PATHS.dashboard)
        }}
      >
        Return to it
      </Button>
      <Button size="sm" variant="secondary" loading={stop.isPending} onClick={() => stop.mutate()}>
        End it
      </Button>
    </div>
  )
}
