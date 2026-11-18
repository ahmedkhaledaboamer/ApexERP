import { Link } from 'react-router-dom'
import { Building2, CalendarDays, FolderKanban, Target } from 'lucide-react'
import type { TaskLinkType, TaskLinkView } from '@/modules/tasks/types'
import { cn } from '@/shared/lib/utils'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { LINK_LABEL, linkHref } from './taskMeta'

export function LinkTypeIcon({ type, className }: { type: TaskLinkType | 'project'; className?: string }) {
  const cls = cn('size-3.5 shrink-0', className)
  if (type === 'lead') return <Target className={cls} aria-hidden />
  if (type === 'customer') return <Building2 className={cls} aria-hidden />
  if (type === 'project') return <FolderKanban className={cls} aria-hidden />
  return <CalendarDays className={cls} aria-hidden />
}

const CHIP =
  'inline-flex h-[1.375rem] max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap'

/**
 * Record chip: the task's one related link (lead / customer / event) or, as a separate chip, its
 * project. Opens the record; records you can't open (or events without the Events module) show as a disabled chip with the
 * reason in a tooltip.
 */
export function LinkChip({ link, className, maxWidthClass = 'max-w-48' }: { link: TaskLinkView | null; className?: string; maxWidthClass?: string }) {
  if (!link) return null
  const href = linkHref(link.type, link.id)
  const label = `${LINK_LABEL[link.type]}: ${link.label}`
  if (!link.available || !href) {
    const reason = `This ${link.type} isn’t available to you`
    return (
      <Tooltip label={reason}>
        <span
          tabIndex={0}
          aria-disabled="true"
          aria-label={`${label} (${reason})`}
          className={cn(CHIP, maxWidthClass, 'cursor-not-allowed bg-sunken text-subtle ring-line', className)}
        >
          <LinkTypeIcon type={link.type} />
          <span className="truncate">{link.label}</span>
        </span>
      </Tooltip>
    )
  }
  return (
    <Link
      to={href}
      onClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={cn(
        CHIP,
        maxWidthClass,
        'bg-surface text-ink-2 ring-line-strong transition-colors hover:bg-hover hover:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
        className,
      )}
    >
      <LinkTypeIcon type={link.type} className="text-muted" />
      <span className="truncate">{link.label}</span>
    </Link>
  )
}
