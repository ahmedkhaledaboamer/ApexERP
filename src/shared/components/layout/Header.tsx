import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  Sun,
  UserPlus,
  CircleUser,
  IdCard,
  FileText,
  CheckSquare,
  Building2,
  Palette,
  Clock,
  Plane,
  ClipboardList,
  HandCoins,
  Inbox,
} from 'lucide-react'
import { useApprovalsInbox } from '@/modules/finance/purchases/approvalsInbox'
import { planIncludes } from '@/modules/billing/gating'
import { useGateContext } from '@/modules/billing/hooks'
import type { Role } from '@/shared/types'
import { PATHS } from '@/app/paths'
import { MARKETING_PATHS } from '@/modules/marketing/paths'
import { switchRole } from '@/modules/auth/api/authApi'
import { MOCK_API } from '@/modules/auth/constants'
import { AlertsBell } from '@/modules/alerts/components/AlertsBell'
import { can } from '@/shared/lib/permissions'
import { ROLES } from '@/shared/lib/constants'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { signedIn, signedOut } from '@/store/authSlice'
import { commandPaletteSet, mobileNavOpened, quickAddLeadSet, themeToggled } from '@/store/uiSlice'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Kbd } from '@/shared/components/ui/Kbd'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { WorkspaceSwitcher } from '@/modules/tenancy/components/WorkspaceSwitcher'
import { navMatch } from './navigation'

/** Top bar: breadcrumbs, global search, "New", notifications, theme and the user menu. */
export function Header() {
  const dispatch = useAppDispatch()
  const theme = useAppSelector((s) => s.ui.theme)

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <Button variant="ghost" size="sm" iconOnly aria-label="Open navigation" className="lg:hidden" onClick={() => dispatch(mobileNavOpened())}>
        <MenuIcon />
      </Button>
      <Breadcrumbs />

      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => dispatch(commandPaletteSet(true))}
          className="hidden h-10 w-80 items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 text-[0.875rem] text-subtle shadow-xs transition-colors hover:border-subtle md:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 truncate text-start">Search leads, customers, quotations…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <Button variant="ghost" size="md" iconOnly aria-label="Search" className="md:hidden" onClick={() => dispatch(commandPaletteSet(true))}>
          <Search />
        </Button>

        <WorkspaceSwitcher />
        <NewMenu />
        <AlertsBell />

        <Button
          variant="ghost"
          size="md"
          iconOnly
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => dispatch(themeToggled())}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <span className="mx-1 hidden h-8 w-px bg-line sm:block" aria-hidden />
        <UserMenu />
      </div>
    </header>
  )
}

/** Sub-page slugs read as words ("company-profile" → "Company profile"); record ids (L-1001) stay as they are. */
function crumbLabel(segment: string): string {
  const first = segment.split('/')[0]
  if (!/^[a-z]+(-[a-z]+)*$/.test(first)) return segment
  const words = first.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function Breadcrumbs() {
  const { pathname } = useLocation()
  const match = navMatch(pathname)
  const crumbs: { label: string; to?: string }[] = []
  if (match?.section) crumbs.push({ label: match.section.label })
  if (match) {
    const exact = match.item.to === pathname
    crumbs.push({ label: match.item.label, to: exact ? undefined : match.item.to })
    if (!exact) {
      // Nested sub-pages (/events/EV-1004/check-in) get one crumb per segment: "EV-1004 › Check-in".
      const rest = decodeURIComponent(pathname.slice(match.item.to.length + 1)).split('/').filter(Boolean)
      rest.forEach((segment, i) => {
        const to = i < rest.length - 1 ? `${match.item.to}/${rest.slice(0, i + 1).map(encodeURIComponent).join('/')}` : undefined
        crumbs.push({ label: crumbLabel(segment), to })
      })
    }
  }
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
      <ol className="flex items-center gap-1.5 text-[0.9375rem]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden />}
              {c.to ? (
                <Link to={c.to} className="truncate text-muted hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={cn('truncate', last ? 'font-semibold text-ink' : 'text-muted')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function NewMenu() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const user = useCurrentUser()
  // Sales and tasks are in every plan; the role decides. `write`: nothing to create while read-only.
  const sales = !!user && can(user.role, 'sales', 'view')
  const tasks = !!user && can(user.role, 'tasks', 'view')
  const canLead = !!user && can(user.role, 'sales', 'create')
  return (
    <Menu
      className="w-56"
      trigger={(props) => (
        <Button size="md" write {...props}>
          <Plus />
          <span className="hidden sm:inline">New</span>
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Create</MenuLabel>
          {canLead && (
            <MenuItem
              icon={<UserPlus />}
              hint="Lead"
              onSelect={() => {
                close()
                dispatch(quickAddLeadSet(true))
              }}
            >
              New lead
            </MenuItem>
          )}
          {sales && (
            <MenuItem icon={<Building2 />} hint="Soon" onSelect={close}>
              New customer
            </MenuItem>
          )}
          {sales && (
            <MenuItem icon={<FileText />} hint="Soon" onSelect={close}>
              New quotation
            </MenuItem>
          )}
          {tasks && (
            <MenuItem icon={<CheckSquare />} hint="Soon" onSelect={close}>
              New task
            </MenuItem>
          )}
          {/* Everyone may ask the design team (plan module `marketing`; without it the page shows the upgrade state). */}
          <MenuItem
            icon={<Palette />}
            hint="Design"
            onSelect={() => {
              close()
              navigate(`${MARKETING_PATHS.designRequests}?new=1`)
            }}
          >
            New design request
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/**
 * "Approvals" with the count of what waits for the caller. Mounted only while the menu is open: the inbox lists are
 * finance endpoints, so loading them on every page would run the (lazy) finance seed for every employee.
 */
function ApprovalsMenuItem({ onSelect }: { onSelect: () => void }) {
  const approvals = useApprovalsInbox()
  return (
    <MenuItem icon={<Inbox />} hint={approvals.count ? String(approvals.count) : undefined} onSelect={onSelect}>
      Approvals
    </MenuItem>
  )
}

function UserMenu() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const toast = useToast()
  const hr = planIncludes(useGateContext().entitlements, 'hr')
  // Spending self-service for every employee (plan module `accounting`; the Accounts & finance section is for finance roles).
  const accounting = planIncludes(useGateContext().entitlements, 'accounting')

  const roleMutation = useMutation({
    mutationFn: (role: Role) => switchRole(role),
    // Same company, another seeded user: sessionTransitions clears the cache and tenant state.
    onSuccess: (session) => {
      dispatch(signedIn(session))
      toast.info(`Viewing as ${session.user.role}`, session.user.name)
    },
    onError: (e: Error) => toast.error('Couldn’t switch role', e.message),
  })

  if (!user) return null

  return (
    <Menu
      className="w-64"
      trigger={(props) => (
        <button type="button" {...props} className="flex items-center gap-2.5 rounded-lg p-1 text-start hover:bg-hover">
          <Avatar name={user.name} size="md" />
          <span className="hidden leading-tight sm:block">
            <span className="block max-w-40 truncate text-[0.875rem] font-semibold">{user.name}</span>
            <span className="block max-w-40 truncate text-xs text-muted">{user.role}</span>
          </span>
          <ChevronDown className="hidden size-4 text-subtle sm:block" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 py-1.5">
            <p className="truncate text-[0.8125rem] font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <MenuSeparator />
          <MenuItem
            icon={<CircleUser />}
            onSelect={() => {
              close()
              navigate(PATHS.account)
            }}
          >
            My account
          </MenuItem>
          <MenuItem
            icon={<Palette />}
            onSelect={() => {
              close()
              navigate(MARKETING_PATHS.designRequests)
            }}
          >
            My design requests
          </MenuItem>
          {/* Self-service for every employee, whatever their hr scope (plan module `hr` only). */}
          {hr && (
            <>
              <MenuItem
                icon={<Clock />}
                onSelect={() => {
                  close()
                  navigate(`${PATHS.hrAttendance}?tab=me`)
                }}
              >
                Clock in / out
              </MenuItem>
              <MenuItem
                icon={<Plane />}
                onSelect={() => {
                  close()
                  navigate(`${PATHS.hrLeave}?tab=me&request=1`)
                }}
              >
                Request leave
              </MenuItem>
              <MenuItem
                icon={<IdCard />}
                onSelect={() => {
                  close()
                  navigate(PATHS.hrMe)
                }}
              >
                My HR
              </MenuItem>
            </>
          )}
          {accounting && (
            <>
              <MenuItem
                icon={<ClipboardList />}
                onSelect={() => {
                  close()
                  navigate(PATHS.financePurchaseOrderNew)
                }}
              >
                Request a purchase
              </MenuItem>
              <MenuItem
                icon={<HandCoins />}
                onSelect={() => {
                  close()
                  navigate(`${PATHS.financeExpenses}?tab=claims`)
                }}
              >
                My expense claims
              </MenuItem>
              <ApprovalsMenuItem
                onSelect={() => {
                  close()
                  navigate(PATHS.financeApprovals)
                }}
              />
            </>
          )}
          {/* Demo role switcher: mock API only (a real backend has no /auth/switch-role). */}
          {MOCK_API && (
            <>
              <MenuSeparator />
              <MenuLabel>Demo: view as role</MenuLabel>
              <div className="max-h-56 overflow-y-auto">
                {ROLES.map((r) => (
                  <MenuItem
                    key={r}
                    active={r === user.role}
                    icon={r === user.role ? <Check /> : <span className="block size-4" />}
                    onSelect={() => {
                      close()
                      if (r !== user.role) roleMutation.mutate(r)
                    }}
                  >
                    {r}
                  </MenuItem>
                ))}
              </div>
            </>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<LogOut />}
            onSelect={() => {
              dispatch(signedOut())
              navigate(PATHS.login, { replace: true })
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
