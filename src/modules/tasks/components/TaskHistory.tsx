import { formatDistanceToNowStrict } from 'date-fns'
import { ArrowRightLeft, CalendarClock, CirclePlus, Clock, Flag, Link2, MessageSquare, Paperclip, Pencil, UserRound, Users } from 'lucide-react'
import type { User } from '@/shared/types'
import type { TaskEvent, TaskEventKind } from '@/modules/tasks/types'
import { fmtDate } from '@/shared/lib/utils'

const ICON: Record<TaskEventKind, typeof Clock> = {
  created: CirclePlus,
  status: ArrowRightLeft,
  owner: UserRound,
  due: CalendarClock,
  priority: Flag,
  edited: Pencil,
  comment: MessageSquare,
  attachment: Paperclip,
  follower: Users,
  hours: Clock,
  link: Link2,
}

/** Activity history, newest first. */
export function TaskHistory({ events, allUsers }: { events: TaskEvent[]; allUsers: User[] }) {
  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? 'Someone'
  const list = [...events].reverse()
  if (!list.length) return <p className="text-[0.8125rem] text-muted">No activity yet.</p>
  return (
    <ol className="relative space-y-3 before:absolute before:start-[0.6875rem] before:top-1 before:bottom-1 before:w-[0.0625rem] before:bg-line">
      {list.map((e) => {
        const Icon = ICON[e.kind] ?? Clock
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted">
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[0.8125rem] break-words text-ink-2">
                <span className="font-medium text-ink">{nameOf(e.userId)}</span> · {e.summary}
              </p>
              <time dateTime={e.at} title={fmtDate(e.at, 'd MMM yyyy, HH:mm')} className="text-xs text-subtle">
                {formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
