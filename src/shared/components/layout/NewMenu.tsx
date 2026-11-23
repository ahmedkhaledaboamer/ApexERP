import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Kbd } from '@/shared/components/ui/Kbd'
import { Menu } from '@/shared/components/ui/Menu'
import { CREATE_AREAS, areaLabel, commonCreateActions, searchCreateActions, type CreateAction } from './createActions'
import { useCreateActions, useRunCreateAction } from './useCreateActions'

/**
 * Header "+ New": every record the user can create (createActions.ts), grouped by area in sidebar order with a
 * "Common" group for the role on top. Type to filter, ↑ ↓ to move, Enter opens the highlighted (first) match,
 * Escape closes (Menu's layer stack). `write`: the button is disabled while the workspace is read-only.
 */
export function NewMenu() {
  return (
    <Menu
      className="w-[min(40rem,calc(100vw-2rem))] p-0 max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:w-auto"
      trigger={(props) => (
        <Button size="md" write {...props}>
          <Plus />
          <span className="hidden sm:inline">New</span>
        </Button>
      )}
    >
      {(close) => <NewMenuPanel close={close} />}
    </Menu>
  )
}

interface Section {
  key: string
  label: string
  items: CreateAction[]
}

function NewMenuPanel({ close }: { close: () => void }) {
  const user = useCurrentUser()
  const available = useCreateActions()
  const run = useRunCreateAction()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) {
      const hits = searchCreateActions(available, query)
      return hits.length ? [{ key: 'results', label: 'Results', items: hits }] : []
    }
    const common = commonCreateActions(user?.role, available)
    return [
      ...(common.length ? [{ key: 'common', label: 'Common', items: common }] : []),
      ...CREATE_AREAS.map((a) => ({ key: a.id, label: a.label, items: available.filter((x) => x.area === a.id) })).filter((s) => s.items.length),
    ]
  }, [available, query, user?.role])
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function open(a: CreateAction) {
    close()
    run(a)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const a = flat[active]
      if (a) open(a)
    }
  }

  const searching = !!query.trim()
  let index = -1
  return (
    <div className="flex max-h-[min(80vh,40rem)] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 shrink-0 text-subtle" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Create…"
          aria-label="Search what to create"
          aria-controls="new-menu-list"
          aria-activedescendant={flat[active] ? `new-${flat[active].id}-${active}` : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle focus-visible:outline-none"
        />
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
      </div>
      <div ref={listRef} id="new-menu-list" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {flat.length === 0 ? (
          <p className="px-3 py-8 text-center text-[0.8125rem] text-muted">{searching ? 'Nothing to create matches that.' : 'Nothing you can create here.'}</p>
        ) : (
          sections.map((s) => (
            <div key={s.key} role="group" aria-label={s.label} className="pb-1">
              <p className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium text-subtle">{s.label}</p>
              <div className="grid grid-cols-1 gap-x-1 sm:grid-cols-2">
                {s.items.map((a) => {
                  index++
                  const i = index
                  const Icon = a.icon
                  return (
                    <button
                      key={`${s.key}-${a.id}`}
                      id={`new-${a.id}-${i}`}
                      type="button"
                      role="menuitem"
                      data-index={i}
                      data-create={a.id}
                      onMouseMove={() => setActive(i)}
                      onClick={() => open(a)}
                      className={cn(
                        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] text-ink transition-colors [&_svg]:size-4',
                        i === active ? 'bg-hover' : 'hover:bg-hover',
                      )}
                    >
                      <Icon className="shrink-0 text-muted" aria-hidden />
                      <span className="flex-1 truncate">{a.label}</span>
                      {searching && (
                        <span className="hidden shrink-0 text-xs text-subtle sm:inline" aria-hidden>
                          {areaLabel(a.area)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="hidden items-center gap-3 border-t border-line bg-sunken/60 px-3 py-2 text-[0.6875rem] text-muted sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> to open
        </span>
        <span className="ms-auto flex items-center gap-1">
          Also in <Kbd>Ctrl K</Kbd>
        </span>
      </div>
    </div>
  )
}
