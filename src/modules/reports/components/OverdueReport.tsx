import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2 } from 'lucide-react'
import { leadPath } from '@/app/paths'
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskLinkType, type TaskPriority } from '@/modules/tasks/types'
import { cn, fmtDate } from '@/shared/lib/utils'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import type { OverdueFollowUp, OverdueTask, SalesReport } from '@/modules/reports/types'
import { ReportCard } from './ReportCard'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, SubHeading, TOOLTIP_STYLE } from './chartKit'

function Days({ n }: { n: number }) {
  return (
    <Badge tone={n > 7 ? 'red' : n > 2 ? 'amber' : 'neutral'} className="num">
      {n} {n === 1 ? 'day' : 'days'}
    </Badge>
  )
}

const TASK_PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: 'text-muted',
  medium: 'text-accent-700 dark:text-accent-300',
  high: 'text-warning-700 dark:text-warning-500',
  urgent: 'text-danger-600 dark:text-danger-500',
}

const LINK_TYPE_LABEL: Record<TaskLinkType | 'project', string> = {
  project: 'Project',
  lead: 'Lead',
  customer: 'Customer',
  event: 'Event',
}

function Owner({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar name={name} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  )
}

export function OverdueReport({ data }: { data: SalesReport }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  /** Opens the global task drawer over the report (`?task=<id>` on the current URL). */
  const openTask = (id: string) => {
    const q = new URLSearchParams(search)
    q.set('task', id)
    navigate(`${pathname}?${q.toString()}`)
  }
  const followUps = data.overdueFollowUps
  const tasks = data.overdueTasks

  const byOwner = useMemo(() => {
    const map = new Map<string, { name: string; followUps: number; tasks: number }>()
    for (const f of followUps) {
      const row = map.get(f.ownerId) ?? { name: f.ownerName, followUps: 0, tasks: 0 }
      row.followUps++
      map.set(f.ownerId, row)
    }
    for (const t of tasks) {
      const row = map.get(t.ownerId) ?? { name: t.ownerName, followUps: 0, tasks: 0 }
      row.tasks++
      map.set(t.ownerId, row)
    }
    return [...map.values()].sort((a, b) => b.followUps + b.tasks - (a.followUps + a.tasks))
  }, [followUps, tasks])

  const fuColumns = useMemo<ColumnDef<OverdueFollowUp>[]>(
    () => [
      {
        accessorKey: 'company',
        header: 'Lead',
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.company}</span>
            {row.original.nextStep && <span className="block truncate text-xs text-muted">{row.original.nextStep}</span>}
          </span>
        ),
      },
      { accessorKey: 'status', header: 'Status', meta: { width: 140 }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'ownerName', header: 'Owner', meta: { width: 180 }, cell: ({ getValue }) => <Owner name={getValue<string>()} /> },
      { accessorKey: 'dueDate', header: 'Due', meta: { width: 120 }, cell: ({ getValue }) => <span className="num text-ink-2">{fmtDate(getValue<string>())}</span> },
      { accessorKey: 'daysOverdue', header: 'Overdue', meta: { width: 100, align: 'end' }, cell: ({ getValue }) => <Days n={getValue<number>()} /> },
    ],
    [],
  )
  const taskColumns = useMemo<ColumnDef<OverdueTask>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Task',
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{row.original.title}</span>
            <span className="block truncate text-xs text-muted">{TASK_STATUS_LABEL[row.original.status]}</span>
          </span>
        ),
      },
      {
        id: 'link',
        accessorFn: (t) => t.linkLabel ?? '',
        header: 'Linked to',
        meta: { width: 220 },
        cell: ({ row }) =>
          row.original.linkType && row.original.linkLabel ? (
            <span className="block min-w-0">
              <span className={cn('block truncate', row.original.linkAvailable ? 'text-ink' : 'text-muted')}>{row.original.linkLabel}</span>
              <span className="block text-xs text-muted">{LINK_TYPE_LABEL[row.original.linkType]}</span>
            </span>
          ) : (
            <span className="text-muted">Personal</span>
          ),
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        meta: { width: 100 },
        cell: ({ row }) => (
          <span className={cn('text-[0.8125rem] font-medium', TASK_PRIORITY_STYLES[row.original.priority])}>{TASK_PRIORITY_LABEL[row.original.priority]}</span>
        ),
      },
      { accessorKey: 'ownerName', header: 'Owner', meta: { width: 180 }, cell: ({ getValue }) => <Owner name={getValue<string>()} /> },
      { accessorKey: 'dueDate', header: 'Due', meta: { width: 120 }, cell: ({ getValue }) => <span className="num text-ink-2">{fmtDate(getValue<string>())}</span> },
      { accessorKey: 'daysOverdue', header: 'Overdue', meta: { width: 100, align: 'end' }, cell: ({ getValue }) => <Days n={getValue<number>()} /> },
    ],
    [],
  )
  const fuTable = useDataTable({ id: 'reports-overdue-followups', data: followUps, columns: fuColumns, defaultPageSize: 10, defaultSorting: [{ id: 'daysOverdue', desc: true }] })
  const taskTable = useDataTable({ id: 'reports-overdue-tasks', data: tasks, columns: taskColumns, defaultPageSize: 10, defaultSorting: [{ id: 'daysOverdue', desc: true }] })

  const allClear = followUps.length === 0 && tasks.length === 0

  return (
    <ReportCard
      id="overdue"
      chart={
        allClear ? (
          <EmptyState icon={<CheckCircle2 aria-hidden />} title="Nothing overdue" body="Every follow-up date and task in your scope is on time." />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
            <dl className="grid grid-cols-2 gap-3 self-start lg:grid-cols-1">
              <div className="rounded-lg bg-sunken/70 px-4 py-3">
                <dt className="text-xs text-muted">Overdue follow-ups</dt>
                <dd className="num mt-1 text-[1.5rem] font-bold text-danger-600">{followUps.length}</dd>
              </div>
              <div className="rounded-lg bg-sunken/70 px-4 py-3">
                <dt className="text-xs text-muted">Overdue tasks</dt>
                <dd className="num mt-1 text-[1.5rem] font-bold text-danger-600">{tasks.length}</dd>
              </div>
            </dl>
            <div>
              <SubHeading hint="As of today">Overdue items per owner</SubHeading>
              <LegendRow className="mb-2">
                <Legend color={C.brand} label="Follow-ups" />
                <Legend color={C.blue} label="Tasks" />
              </LegendRow>
              <div dir="ltr" style={{ height: Math.max(140, byOwner.length * 40 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byOwner} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                    <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fill: 'var(--color-ink-2)' }} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="followUps" name="Follow-ups" fill={C.brand} radius={[0, 4, 4, 0]} maxBarSize={12} />
                    <Bar dataKey="tasks" name="Tasks" fill={C.blue} radius={[0, 4, 4, 0]} maxBarSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )
      }
    >
      <div className="space-y-2">
        <SubHeading hint={`${followUps.length} open leads past their follow-up date`}>Overdue follow-ups</SubHeading>
        <DataTable
          table={fuTable}
          minWidth={760}
          onRowClick={(r) => navigate(leadPath(r.leadId))}
          empty={<EmptyState title="No overdue follow-ups" body="Every open lead has a follow-up date in the future." className="py-10" />}
        />
      </div>
      <div className="space-y-2">
        <SubHeading hint={`${tasks.length} tasks not done by their due date`}>Overdue tasks</SubHeading>
        <DataTable
          table={taskTable}
          minWidth={960}
          onRowClick={(r) => openTask(r.taskId)}
          empty={<EmptyState title="No overdue tasks" body="All open tasks are due today or later." className="py-10" />}
        />
      </div>
    </ReportCard>
  )
}
