import { MessageSquare, Paperclip } from 'lucide-react'
import type { TaskStatus, TaskView } from '@/modules/tasks/types'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { PriorityBadge, StatusMenu } from './TaskBadges'
import { LinkChip } from './LinkChip'
import { dueLabel } from './taskMeta'

interface TaskRowProps {
  task: TaskView
  onOpen: (id: string) => void
  onStatus: (task: TaskView, status: TaskStatus) => void
  canEdit: boolean
  /** Hide the link chip (e.g. on the lead page, where every task links to that lead). */
  hideLink?: boolean
  showOwner?: boolean
}

/** Linear-style task row: status menu, title, priority, link, due, owner. Wraps on phones. */
export function TaskRow({ task, onOpen, onStatus, canEdit, hideLink, showOwner = true }: TaskRowProps) {
  const done = task.status === 'Done'
  return (
    <li className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1.5 hover:bg-hover sm:flex-nowrap">
      <StatusMenu status={task.status} onChange={(s) => onStatus(task, s)} disabled={!canEdit || !task.canEdit} title={task.title} />
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className={cn(
          'min-w-0 flex-1 basis-40 truncate rounded text-start text-[0.8125rem] focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
          done ? 'text-muted line-through' : 'text-ink hover:underline',
        )}
      >
        {task.title}
      </button>
      <div className="ms-9 flex min-w-0 shrink-0 items-center gap-2 sm:ms-0">
        {(task.comments.length > 0 || task.attachments.length > 0) && (
          <span className="hidden items-center gap-2 text-xs text-subtle md:flex">
            {task.comments.length > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`${task.comments.length} comments`}>
                <MessageSquare className="size-3.5" aria-hidden />
                <span className="num">{task.comments.length}</span>
              </span>
            )}
            {task.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`${task.attachments.length} attachments`}>
                <Paperclip className="size-3.5" aria-hidden />
                <span className="num">{task.attachments.length}</span>
              </span>
            )}
          </span>
        )}
        {!hideLink && <LinkChip link={task.linkView} maxWidthClass="max-w-40" />}
        <PriorityBadge priority={task.priority} compact />
        <span
          className={cn(
            'num w-20 text-end text-xs whitespace-nowrap',
            task.overdue ? 'font-medium text-danger-600 dark:text-danger-500' : task.dueDate ? 'text-muted' : 'text-subtle',
          )}
        >
          {dueLabel(task.dueDate)}
        </span>
        {showOwner && (
          <Tooltip label={task.ownerName}>
            <span tabIndex={-1}>
              <Avatar name={task.ownerName} size="xs" />
              <span className="sr-only">Owner: {task.ownerName}</span>
            </span>
          </Tooltip>
        )}
      </div>
    </li>
  )
}
