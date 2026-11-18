import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AuditEntry } from '@/modules/settings/types'
import type { ProjectRow, ProjectStatus, TaskPriority, TaskStatus, TaskView } from '@/modules/tasks/types'
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE as ENUM_PROJECT_STATUS_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE as ENUM_TASK_STATUS_TONE,
} from '@/modules/tasks/enums'
import { cn } from '@/shared/lib/utils'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

/** GET /projects/:id: the documented `ProjectRow & { tasks }` plus the project's audit trail and the caller's rights. */
export type ProjectDetail = ProjectRow & {
  tasks: TaskView[]
  audit?: AuditEntry[]
  canManage?: boolean
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = { ...ENUM_PROJECT_STATUS_TONE, active: 'brand' }

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = ENUM_TASK_STATUS_TONE

export const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  low: 'neutral',
  medium: 'sky',
  high: 'amber',
  urgent: 'red',
}

/** SVG / chart colours per task status (SVG can't read Tailwind classes). */
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  todo: '#a1a1aa',
  in_progress: '#3b82f6',
  review: '#14b8a6',
  done: '#10b981',
  cancelled: '#d4d4d8',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={PROJECT_STATUS_TONE[status]} variant="dot">
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  )
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={TASK_STATUS_TONE[status]} variant="soft">
      {TASK_STATUS_LABEL[status]}
    </Badge>
  )
}

/** Thin progress bar with the % beside it. */
export function ProgressBar({ value, className, showLabel = true }: { value: number; className?: string; showLabel?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span
        className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${v}% done`}
      >
        <span className={cn('block h-full rounded-full', v >= 100 ? 'bg-success-500' : 'bg-brand-500')} style={{ width: `${v}%` }} />
      </span>
      {showLabel && <span className="num w-9 shrink-0 text-end text-xs text-ink-2">{v}%</span>}
    </span>
  )
}

export function fmtHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Opens a task in the global task drawer by setting `?task=<id>` on the current URL (other params kept). */
export function useOpenTask() {
  const [params, setParams] = useSearchParams()
  return useCallback(
    (id: string) => {
      const next = new URLSearchParams(params)
      next.set('task', id)
      setParams(next)
    },
    [params, setParams],
  )
}
