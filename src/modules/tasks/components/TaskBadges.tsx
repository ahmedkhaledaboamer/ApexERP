import { ChevronDown, Circle, CircleCheck, CircleDot, CircleSlash, Eye, Flag, OctagonAlert } from 'lucide-react'
import type { TaskPriority, TaskStatus } from '@/modules/tasks/types'
import { TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Menu, MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { PRIORITY_TONE, STATUS_TONE } from './taskMeta'

const STATUS_ICON_CLASS: Record<TaskStatus, string> = {
  todo: 'text-subtle',
  in_progress: 'text-accent-600 dark:text-accent-300',
  review: 'text-teal-600 dark:text-teal-400',
  done: 'text-success-600 dark:text-success-500',
  cancelled: 'text-subtle',
}

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const cls = cn('size-4 shrink-0', STATUS_ICON_CLASS[status], className)
  if (status === 'done') return <CircleCheck className={cls} aria-hidden />
  if (status === 'in_progress') return <CircleDot className={cls} aria-hidden />
  if (status === 'review') return <Eye className={cls} aria-hidden />
  if (status === 'cancelled') return <CircleSlash className={cls} aria-hidden />
  return <Circle className={cls} aria-hidden />
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} variant="dot">
      {TASK_STATUS_LABEL[status]}
    </Badge>
  )
}

/** The blocked flag (tasks.blocked_at): an amber badge; the reason shows as its tooltip. */
export function BlockedBadge({ reason, compact }: { reason?: string | null; compact?: boolean }) {
  return (
    <span title={reason ? `Blocked: ${reason}` : 'Blocked'} className="inline-flex" data-blocked="true">
      <Badge tone="amber" icon={<OctagonAlert aria-hidden />} className={compact ? 'px-1.5' : undefined}>
        Blocked
      </Badge>
    </span>
  )
}

/** Urgent red, High amber, Medium blue, Low grey. */
export function PriorityBadge({ priority, compact }: { priority: TaskPriority; compact?: boolean }) {
  const label = TASK_PRIORITY_LABEL[priority]
  if (compact) {
    return (
      <span title={`${label} priority`} className="inline-flex">
        <Flag
          aria-label={`${label} priority`}
          className={cn(
            'size-3.5 shrink-0',
            priority === 'urgent' && 'fill-current text-danger-600 dark:text-danger-500',
            priority === 'high' && 'text-warning-600 dark:text-warning-500',
            priority === 'medium' && 'text-accent-600 dark:text-accent-300',
            priority === 'low' && 'text-subtle',
          )}
        />
      </span>
    )
  }
  return (
    <Badge tone={PRIORITY_TONE[priority]} icon={<Flag aria-hidden />}>
      {label}
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
      <span className="inline-flex size-7 items-center justify-center" title={TASK_STATUS_LABEL[status]}>
        <StatusIcon status={status} />
        <span className="sr-only">{TASK_STATUS_LABEL[status]}</span>
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
          aria-label={`Status: ${TASK_STATUS_LABEL[status]}${title ? ` for ${title}` : ''}. Change status`}
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
              {TASK_STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  )
}
