import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  FileText,
  CheckSquare,
  Building2,
} from 'lucide-react'
import type { Role } from '@/shared/types'
import { PATHS } from '@/app/paths'
import { switchRole } from '@/modules/auth/api/authApi'
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

function Breadcrumbs() {
  const { pathname } = useLocation()
  const match = navMatch(pathname)
  const crumbs: { label: string; to?: string }[] = []
  if (match?.section) crumbs.push({ label: match.section.label })
  if (match) {
    const exact = match.item.to === pathname
    crumbs.push({ label: match.item.label, to: exact ? undefined : match.item.to })
    if (!exact) crumbs.push({ label: decodeURIComponent(pathname.slice(match.item.to.length + 1)) })
  }
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
      <ol className="flex items-center gap-1.5 text-[0.9375rem]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />}
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
  const user = useCurrentUser()
  const canLead = !!user && can(user.role, 'sales', 'create')
  return (
    <Menu
      className="w-56"
      trigger={(props) => (
        <Button size="md" {...props}>
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
          <MenuItem icon={<Building2 />} hint="Soon" onSelect={close}>
            New customer
          </MenuItem>
          <MenuItem icon={<FileText />} hint="Soon" onSelect={close}>
            New quotation
          </MenuItem>
          <MenuItem icon={<CheckSquare />} hint="Soon" onSelect={close}>
            New task
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

function UserMenu() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useCurrentUser()
  const toast = useToast()

  const roleMutation = useMutation({
    mutationFn: (role: Role) => switchRole(role),
    onSuccess: (session) => {
      queryClient.removeQueries()
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
          <MenuSeparator />
          <MenuItem
            icon={<LogOut />}
            onSelect={() => {
              queryClient.clear()
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
