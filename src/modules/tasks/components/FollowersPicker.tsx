import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { User } from '@/shared/types'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Menu } from '@/shared/components/ui/Menu'
import { SearchInput } from '@/shared/components/form/Field'

/** Multi-select of people as removable chips plus an "Add" popover with search. */
export function FollowersPicker({
  value,
  onChange,
  users,
  allUsers,
  excludeId,
  disabled,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  /** Pickable (active) users. */
  users: User[]
  /** Everyone, to name followers who were deactivated. */
  allUsers: User[]
  excludeId?: string
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? id
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    return users.filter((u) => u.id !== excludeId && !value.includes(u.id) && (!s || u.name.toLowerCase().includes(s)))
  }, [users, value, excludeId, q])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.length === 0 && <span className="text-[0.8125rem] text-subtle">No followers</span>}
      {value.map((id) => (
        <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface ps-0.5 pe-1.5 text-xs text-ink-2">
          <Avatar name={nameOf(id)} size="sm" />
          {nameOf(id)}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${nameOf(id)}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
              className="rounded-full p-0.5 text-subtle hover:bg-hover hover:text-ink"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <Menu
          align="start"
          className="w-64"
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2 text-xs text-muted hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3.5" aria-hidden />
              Add follower
            </button>
          )}
        >
          {(close) => (
            <>
              <SearchInput
                aria-label="Search people"
                placeholder="Search people"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Enter picks the first match instead of submitting the surrounding form.
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (options[0]) {
                    onChange([...value, options[0].id])
                    setQ('')
                    close()
                  }
                }}
                className="mb-1"
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto">
                {options.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted">No one else to add</p>
                ) : (
                  options.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChange([...value, u.id])
                        setQ('')
                        close()
                      }}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] hover:bg-hover"
                    >
                      <Avatar name={u.name} size="xs" />
                      <span className="flex-1 truncate">{u.name}</span>
                      <span className="truncate text-xs text-subtle">{u.title}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </Menu>
      )}
    </div>
  )
}
