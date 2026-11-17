import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Moon, Search, Sun, Users } from 'lucide-react'
import { leadPath } from '@/app/paths'
import { can } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { commandPaletteSet, themeToggled } from '@/store/uiSlice'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Kbd } from '@/shared/components/ui/Kbd'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { ALL_NAV_ITEMS } from './navigation'

interface Command {
  id: string
  group: string
  label: string
  hint?: ReactNode
  icon: ReactNode
  run: () => void
}

/** ⌘K / Ctrl+K anywhere. Open state lives in Redux (ui.commandPaletteOpen). */
export function CommandPalette() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((s) => s.ui.commandPaletteOpen)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        dispatch(commandPaletteSet(!open))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, open])

  if (!open) return null
  return createPortal(<Palette onClose={() => dispatch(commandPaletteSet(false))} />, document.body)
}

function Palette({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const theme = useAppSelector((s) => s.ui.theme)
  const canLeads = !!user && can(user.role, 'sales', 'view')
  const leads = useLeadsQuery()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to)
      onClose()
    }
    const q = query.trim().toLowerCase()
    const match = (s: string) => !q || s.toLowerCase().includes(q)

    const pages: Command[] = ALL_NAV_ITEMS
      .filter((i) => (!i.module || (user && can(user.role, i.module, 'view'))) && match(i.label))
      .map((i) => ({
        id: `page-${i.label}`,
        group: 'Go to',
        label: i.label,
        icon: <i.icon />,
        run: go(i.to),
      }))

    const leadHits: Command[] =
      canLeads && q
        ? (leads.data ?? [])
            .filter((l) => match(l.company) || match(l.contactName) || match(l.industry))
            .slice(0, 6)
            .map((l) => ({
              id: `lead-${l.id}`,
              group: 'Leads',
              label: l.company,
              hint: <StatusBadge status={l.status} />,
              icon: <Avatar name={l.company} size="xs" square />,
              run: go(leadPath(l.id)),
            }))
        : []

    const actions: Command[] = [
      ...(canLeads && q
        ? [
            {
              id: 'search-leads',
              group: 'Actions',
              label: `Search all leads for “${query.trim()}”`,
              icon: <Users />,
              run: go(`/leads?q=${encodeURIComponent(query.trim())}`),
            },
          ]
        : []),
      ...(match('theme dark light mode')
        ? [
            {
              id: 'theme',
              group: 'Actions',
              label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
              icon: theme === 'dark' ? <Sun /> : <Moon />,
              run: () => {
                dispatch(themeToggled())
                onClose()
              },
            },
          ]
        : []),
    ]
    return [...leadHits, ...pages, ...actions]
  }, [query, leads.data, canLeads, user, theme, navigate, onClose, dispatch])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, commands.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commands[active]?.run()
    }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-overlay/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 text-subtle" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={canLeads ? 'Search leads, pages, actions…' : 'Search pages and actions…'}
            aria-label="Command"
            aria-controls="command-list"
            aria-activedescendant={commands[active] ? `cmd-${commands[active].id}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle focus-visible:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-[0.8125rem] text-muted">
              {leads.isFetching ? 'Searching…' : 'Nothing matches that.'}
            </p>
          ) : (
            commands.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              return (
                <div key={c.id}>
                  {header && <p className="px-2.5 pt-2 pb-1 text-[0.6875rem] font-medium text-subtle">{header}</p>}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={c.run}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] [&_svg]:size-4',
                      i === active ? 'bg-hover text-ink' : 'text-ink-2',
                    )}
                  >
                    <span className="flex w-5 justify-center text-muted">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint}
                    {i === active && <CornerDownLeft className="size-3.5 text-subtle" aria-hidden />}
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-sunken/60 px-4 py-2 text-[0.6875rem] text-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> to open
          </span>
        </div>
      </div>
    </div>
  )
}
