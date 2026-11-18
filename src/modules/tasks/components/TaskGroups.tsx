import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TaskStatus, TaskView } from '@/modules/tasks/types'
import { cn } from '@/shared/lib/utils'
import { TaskRow } from './TaskRow'
import { currentDay, DUE_GROUPS, dueGroupOf, type DueGroup } from './taskMeta'

const GROUP_TONE: Partial<Record<DueGroup, string>> = {
  overdue: 'text-danger-600 dark:text-danger-500',
  today: 'text-brand-700 dark:text-brand-300',
}

/** Tasks bucketed into Overdue / Today / This week / Later / No date (+ Completed), each collapsible. */
export function TaskGroups({
  tasks,
  onOpen,
  onStatus,
  canEdit,
  hideLink,
  showOwner,
  collapsedByDefault = ['done'],
}: {
  tasks: TaskView[]
  onOpen: (id: string) => void
  onStatus: (task: TaskView, status: TaskStatus) => void
  canEdit: boolean
  hideLink?: boolean
  showOwner?: boolean
  collapsedByDefault?: DueGroup[]
}) {
  const [collapsed, setCollapsed] = useState<Set<DueGroup>>(() => new Set(collapsedByDefault))
  // The company's calendar (timezone + week start from the regional settings).
  const day = currentDay()
  const groups = DUE_GROUPS.map((g) => ({ ...g, items: tasks.filter((t) => dueGroupOf(t, day) === g.id) })).filter((g) => g.items.length > 0)

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const open = !collapsed.has(g.id)
        const panelId = `task-group-${g.id}`
        return (
          <section key={g.id} aria-labelledby={`${panelId}-h`}>
            <h3 id={`${panelId}-h`}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s)
                    if (n.has(g.id)) n.delete(g.id)
                    else n.add(g.id)
                    return n
                  })
                }
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start hover:bg-hover"
              >
                <ChevronDown className={cn('size-4 text-subtle transition-transform', !open && '-rotate-90 rtl:rotate-90')} aria-hidden />
                <span className={cn('text-[0.8125rem] font-semibold', GROUP_TONE[g.id] ?? 'text-ink')}>{g.label}</span>
                <span className="num rounded-full border border-line-strong bg-surface px-2 text-xs leading-5 text-muted">{g.items.length}</span>
              </button>
            </h3>
            {open && (
              <ul id={panelId} className="mt-1 space-y-0.5">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={onOpen} onStatus={onStatus} canEdit={canEdit} hideLink={hideLink} showOwner={showOwner} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
