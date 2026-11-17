import { useEffect, useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { can } from '@/shared/lib/permissions'
import { LOGO_URL } from '@/shared/lib/constants'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { mobileNavClosed, navSectionOpened, navSectionToggled, sidebarToggled } from '@/store/uiSlice'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { followUpState } from '@/modules/leads/components/FollowUpLabel'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { NAV_SECTIONS, NAV_TOP, navMatch, type NavItem } from './navigation'

export function Sidebar() {
  const dispatch = useAppDispatch()
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed)
  const mobileOpen = useAppSelector((s) => s.ui.mobileNavOpen)
  const navOpen = useAppSelector((s) => s.ui.navOpen)
  const user = useCurrentUser()
  const location = useLocation()
  const badges = useBadges()

  // Close the mobile drawer after navigating, and open the section that owns the page.
  useEffect(() => {
    dispatch(mobileNavClosed())
    const match = navMatch(location.pathname)
    if (match?.section) dispatch(navSectionOpened(match.section.id))
  }, [location.pathname, dispatch])

  const visible = (item: NavItem) => !item.module || (!!user && can(user.role, item.module, 'view'))
  const mini = collapsed

  return (
    <>
      <div
        aria-hidden
        onClick={() => dispatch(mobileNavClosed())}
        className={cn(
          'fixed inset-0 z-30 bg-overlay/30 transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-72 flex-col border-e border-line bg-surface transition-[transform,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          mini && 'lg:w-[4.5rem]',
        )}
      >
        {/* Logo */}
        <div className={cn('flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5', mini && 'lg:justify-center lg:px-0')}>
          <img src={LOGO_URL} alt="" aria-hidden className="h-9 w-14 shrink-0 object-cover object-top" />
          <div className={cn('min-w-0 leading-tight', mini && 'lg:hidden')}>
            <p className="truncate text-[0.9375rem] font-bold tracking-tight">APEX AORA</p>
            <p className="truncate text-[0.625rem] font-medium tracking-[0.18em] text-muted uppercase">Innovations ERP</p>
          </div>
          <button
            type="button"
            onClick={() => dispatch(mobileNavClosed())}
            aria-label="Close navigation"
            className="ms-auto rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {NAV_TOP.filter(visible).map((item) => (
              <li key={item.to}>
                <NavRow item={item} mini={mini} badge={item.badge ? badges[item.badge] : undefined} />
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-1">
            {NAV_SECTIONS.map((section) => {
              const items = section.items.filter(visible)
              if (items.length === 0) return null
              const open = mini || !!navOpen[section.id]
              return (
                <div key={section.id}>
                  {!mini && (
                    <button
                      type="button"
                      onClick={() => dispatch(navSectionToggled(section.id))}
                      aria-expanded={open}
                      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[0.75rem] font-semibold tracking-[0.08em] text-ink-2 uppercase hover:bg-hover"
                    >
                      <span aria-hidden className={cn('size-1.5 rounded-full', section.dot)} />
                      <span className="flex-1 text-start">{section.label}</span>
                      {open ? <ChevronDown className="size-4 text-subtle" /> : <ChevronRight className="size-4 text-subtle" />}
                    </button>
                  )}
                  {mini && <div className="mx-auto my-2 h-px w-6 bg-line" aria-hidden />}
                  {open && (
                    <ul className={cn('space-y-1', !mini && 'mt-1 mb-2')}>
                      {items.map((item) => (
                        <li key={item.to}>
                          <NavRow item={item} mini={mini} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={() => dispatch(sidebarToggled())}
            className={cn(
              'hidden h-10 w-full items-center gap-3 rounded-lg px-3 text-[0.875rem] text-ink-2 hover:bg-hover lg:flex',
              mini && 'justify-center px-0',
            )}
          >
            {mini ? <PanelLeftOpen className="size-[1.125rem]" aria-hidden /> : <PanelLeftClose className="size-[1.125rem]" aria-hidden />}
            <span className={cn(mini && 'sr-only')}>{mini ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>
    </>
  )
}

function NavRow({ item, mini, badge }: { item: NavItem; mini: boolean; badge?: number }) {
  const Icon = item.icon
  const { pathname } = useLocation()
  // Same rule as the breadcrumb: exact path first, then the longest matching prefix, so record
  // pages (e.g. /services/S-101, /leads/L-1001) highlight their list without double-highlighting.
  const isActive = navMatch(pathname)?.item.to === item.to
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      aria-current={isActive ? 'page' : undefined}
      className={() =>
        cn(
          'group flex h-10 items-center gap-3 rounded-lg px-3 text-[0.875rem] transition-colors duration-100',
          mini && 'lg:justify-center lg:px-0',
          isActive
            ? 'bg-brand-50 font-semibold text-ink ring-1 ring-brand-300 ring-inset dark:bg-brand-500/10 dark:ring-brand-500/40'
            : 'text-ink-2 hover:bg-hover hover:text-ink',
        )
      }
    >
      {() => (
        <>
          <Icon
            aria-hidden
            className={cn('size-[1.125rem] shrink-0', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-muted group-hover:text-ink-2')}
          />
          <span className={cn('flex-1 truncate', mini && 'lg:sr-only')}>{item.label}</span>
          {!!badge && (
            <span
              className={cn(
                'num min-w-6 rounded-full bg-warning-100 px-1.5 text-center text-[0.6875rem] leading-5 font-semibold text-warning-700 dark:bg-warning-500/20 dark:text-warning-500',
                mini && 'lg:hidden',
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
  return mini ? (
    <Tooltip label={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

/** Live counts for sidebar badges. */
function useBadges(): Partial<Record<NonNullable<NavItem['badge']>, number>> {
  const user = useCurrentUser()
  const allowed = !!user && can(user.role, 'sales', 'view')
  const leads = useLeadsQuery()
  return useMemo(() => {
    if (!allowed || !leads.data) return {}
    const followups = leads.data.filter((l) => {
      const s = followUpState(l.nextFollowUpDate, l.status)
      return s === 'overdue' || s === 'today'
    }).length
    return { followups }
  }, [allowed, leads.data])
}
