import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Cog, MinusCircle } from 'lucide-react'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { useToast } from '@/shared/components/ui/Toast'
import { useSetItemDone } from '../hooks'
import { ITEM_ACTION_LABEL, OWNER_ROLE_LABEL, type ItemAction, type JourneyItem, type JourneyStatus } from '../types'

/** Shared bits of HR › Onboarding & offboarding (journey page, detail, My HR portal card). */

export function journeyPath(id: string): string {
  return `/hr/journeys/${encodeURIComponent(id)}`
}

/** Where a link action is done. */
export function actionLink(action: ItemAction | null, employeeId: string): { to: string; label: string } | null {
  if (!action) return null
  const emp = (tab: string) => `/hr/employees/${encodeURIComponent(employeeId)}?tab=${tab}`
  switch (action.kind) {
    case 'assign_asset':
      return { to: '/hr/assets', label: ITEM_ACTION_LABEL.assign_asset }
    case 'enrol_course':
      return { to: '/hr/training', label: ITEM_ACTION_LABEL.enrol_course }
    case 'upload_document':
      return { to: emp('documents'), label: ITEM_ACTION_LABEL.upload_document }
    case 'sign_contract':
    case 'probation_review':
      return { to: emp('contract'), label: ITEM_ACTION_LABEL[action.kind] }
  }
}

export function JourneyStatusBadge({ status }: { status: JourneyStatus }) {
  return <Badge tone={status === 'completed' ? 'green' : status === 'cancelled' ? 'neutral' : 'blue'}>{status === 'active' ? 'In progress' : status === 'completed' ? 'Completed' : 'Cancelled'}</Badge>
}

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-xs text-muted">{pct}%</span>
    </span>
  )
}

function dueText(item: JourneyItem): string {
  if (item.status !== 'open' || item.daysLeft === null) return `Due ${fmtDate(item.dueDate)}`
  if (item.daysLeft < 0) return `${-item.daysLeft} day${item.daysLeft === -1 ? '' : 's'} overdue`
  if (item.daysLeft === 0) return 'Due today'
  if (item.daysLeft === 1) return 'Due tomorrow'
  return `Due ${fmtDate(item.dueDate)}`
}

/** One checklist line: tick (when allowed), title, owner, due, link action, system detail. */
export function ItemLine({ journeyId, employeeId, item, subtitle, actions }: { journeyId: string; employeeId: string; item: JourneyItem; subtitle?: string; actions?: React.ReactNode }) {
  const toast = useToast()
  const set = useSetItemDone()
  const done = item.status === 'done'
  const link = item.status === 'open' ? actionLink(item.action, employeeId) : null
  const icon = item.status === 'skipped' ? <MinusCircle className="size-4 text-muted" /> : done ? <CheckCircle2 className="size-4 text-success-600" /> : <Circle className="size-4 text-muted" />
  return (
    <li className="flex items-start gap-2.5 py-2 text-[0.8125rem]">
      {item.canComplete ? (
        <button
          type="button"
          className="mt-0.5 rounded-full"
          aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`}
          aria-pressed={done}
          disabled={set.isPending}
          onClick={() => set.mutate({ journeyId, itemId: item.id, done: !done }, { onError: (e) => toast.error('Not saved', e.message) })}
        >
          {icon}
        </button>
      ) : (
        <span className="mt-0.5" aria-label={item.system ? 'Automatic' : done ? 'Done' : 'To do'}>{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`font-medium ${done || item.status === 'skipped' ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</span>
        {item.system && <Badge className="ms-2" icon={<Cog className="size-3" />}>Automatic</Badge>}
        {item.required && item.status === 'open' && !item.system && <Badge tone="amber" className="ms-2">Required</Badge>}
        {item.blocking && item.status === 'open' && <Badge tone="red" className="ms-2">Blocking</Badge>}
        <span className="block text-xs text-muted">
          {[subtitle, item.assigneeName ?? (item.ownerRole === 'employee' || item.ownerRole === 'manager' ? OWNER_ROLE_LABEL[item.ownerRole] : 'HR team'), done && item.doneByName ? `done by ${item.doneByName}` : dueText(item), item.detail].filter(Boolean).join(' · ')}
        </span>
        {item.description && item.status === 'open' && <span className="block text-xs text-muted">{item.description}</span>}
      </span>
      {item.overdue && <Badge tone="red">Overdue</Badge>}
      {link && (
        <Link to={link.to} className="shrink-0 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
          {link.label}
        </Link>
      )}
      {actions}
    </li>
  )
}
