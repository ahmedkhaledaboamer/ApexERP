import { ChevronDown, Circle, CircleCheck, CircleDot, Flag, OctagonAlert } from 'lucide-react'
import type { TaskPriority, TaskStatus } from '@/modules/tasks/types'
import { TASK_STATUSES } from '@/modules/tasks/types'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Menu, MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { PRIORITY_TONE, STATUS_TONE } from './taskMeta'

const STATUS_ICON_CLASS: Record<TaskStatus, string> = {
  'To do': 'text-subtle',
  'In progress': 'text-accent-600 dark:text-accent-300',
  Blocked: 'text-warning-600 dark:text-warning-500',
  Done: 'text-success-600 dark:text-success-500',
}

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const cls = cn('size-4 shrink-0', STATUS_ICON_CLASS[status], className)
  if (status === 'Done') return <CircleCheck className={cls} aria-hidden />
  if (status === 'In progress') return <CircleDot className={cls} aria-hidden />
  if (status === 'Blocked') return <OctagonAlert className={cls} aria-hidden />
  return <Circle className={cls} aria-hidden />
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} variant="dot">
      {status}
    </Badge>
  )
}

/** Urgent red, High amber, Medium blue, Low grey. */
export function PriorityBadge({ priority, compact }: { priority: TaskPriority; compact?: boolean }) {
  if (compact) {
    return (
      <span title={`${priority} priority`} className="inline-flex">
        <Flag
          aria-label={`${priority} priority`}
          className={cn(
            'size-3.5 shrink-0',
            priority === 'Urgent' && 'fill-current text-danger-600 dark:text-danger-500',
            priority === 'High' && 'text-warning-600 dark:text-warning-500',
            priority === 'Medium' && 'text-accent-600 dark:text-accent-300',
            priority === 'Low' && 'text-subtle',
          )}
        />
      </span>
    )
  }
  return (
    <Badge tone={PRIORITY_TONE[priority]} icon={<Flag aria-hidden />}>
      {priority}
    </Badge>
  )
}

interface StatusMenuProps {
  status: TaskStatus
  onChange: (status: TaskStatus) => void
  disabled?: boolean
  /** `icon`: just the status icon (rows). `badge`: the status chip with a caret. */
  variant?: 'icon' | 'badge'
  title?: string
}

/** Inline status change. */
export function StatusMenu({ status, onChange, disabled, variant = 'icon', title }: StatusMenuProps) {
  if (disabled) {
    return variant === 'icon' ? (
      <span className="inline-flex size-7 items-center justify-center" title={status}>
        <StatusIcon status={status} />
        <span className="sr-only">{status}</span>
      </span>
    ) : (
      <TaskStatusBadge status={status} />
    )
  }
  return (
    <Menu
      align="start"
      className="w-44"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          onClick={(e) => {
            e.stopPropagation()
            props.onClick()
          }}
          aria-label={`Status: ${status}${title ? ` for ${title}` : ''}. Change status`}
          className={cn(
            'inline-flex shrink-0 items-center rounded-md transition-colors hover:bg-hover focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
            variant === 'icon' ? 'size-7 justify-center' : 'h-7 gap-1 px-1',
          )}
        >
          {variant === 'icon' ? (
            <StatusIcon status={status} />
          ) : (
            <>
              <TaskStatusBadge status={status} />
              <ChevronDown className="size-3.5 text-subtle" aria-hidden />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div onClick={(e) => e.stopPropagation()}>
          <MenuLabel>Set status</MenuLabel>
          {TASK_STATUSES.map((s) => (
            <MenuItem
              key={s}
              active={s === status}
              icon={<StatusIcon status={s} />}
              onSelect={() => {
                close()
                if (s !== status) onChange(s)
              }}
            >
              {s}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  )
}
