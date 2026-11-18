import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { List, X } from 'lucide-react'
import type { TaskStatus, TaskView } from '@/modules/tasks/types'
import { TASK_LINK_TYPES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { useTasksQuery } from '@/modules/tasks/hooks/useTasks'
import { projectPath } from '@/app/paths'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'
import { BlockedBadge, PriorityBadge, StatusMenu } from '@/modules/tasks/components/TaskBadges'
import { LinkChip, LinkTypeIcon } from '@/modules/tasks/components/LinkChip'
import { TaskPageFrame } from '@/modules/tasks/components/TaskPageFrame'
import { dueLabel, LINK_LABEL, PRIORITY_RANK, PRIORITY_TONE, STATUS_TONE } from '@/modules/tasks/components/taskMeta'
import { useOpenTask, useTaskPermissions, useTaskStatusChange } from '@/modules/tasks/components/useTaskActions'

/** Every task in scope as a table: sort, facet, search. */
export default function TaskListPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const { canEdit } = useTaskPermissions()
  const query = useTasksQuery({ includeDone: true })
  const data = useMemo(() => query.data ?? [], [query.data])
  const openTask = useOpenTask()
  const status = useTaskStatusChange()
  const columns = useMemo(() => buildColumns(canEdit, status.change), [canEdit, status.change])

  const table = useDataTable({
    id: 'tasks-list',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: taskSearch,
    defaultHidden: [],
    defaultSorting: [{ id: 'dueDate', desc: false }],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('q', value)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <TaskPageFrame title="Task list" icon={<List />} description={query.data ? <span className="num">{`${data.length} tasks`}</span> : 'Loading…'}>
      <PageBody>
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => openTask(row.id)}
          minWidth={1080}
          toolbar={
            <>
              <SearchInput
                aria-label="Search tasks"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, owner, link…"
                className="w-full sm:w-64"
              />
              <Facets table={table} data={data} />
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    table.resetColumnFilters()
                    setSearch('')
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
              <div className="ms-auto">
                <ColumnPicker table={table} />
              </div>
            </>
          }
          empty={
            <EmptyState
              title={data.length === 0 ? 'No tasks yet' : 'No tasks match'}
              body={data.length === 0 ? 'Tasks you own, follow or can see in your scope show up here.' : 'Try another search or clear the filters.'}
            />
          }
        />
      </PageBody>
      {status.dialog}
    </TaskPageFrame>
  )
}

const taskSearch: FilterFn<TaskView> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const t = row.original
  return [t.id, t.title, t.ownerName, t.linkView?.label ?? '', t.projectName ?? '', t.description].some((s) => s.toLowerCase().includes(q))
}

const inSet: FilterFn<TaskView> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))

function Facets({ table, data }: { table: Table<TaskView>; data: TaskView[] }) {
  const count = (fn: (r: TaskView) => boolean) => data.filter(fn).length
  const facet = (id: string, title: string, options: FacetOption[]) => {
    const column = table.getColumn(id)
    if (!column) return null
    return (
      <FacetFilter
        title={title}
        options={options}
        selected={(column.getFilterValue() as string[] | undefined) ?? []}
        onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
      />
    )
  }
  const owners = [...new Set(data.map((r) => r.ownerName))].sort()
  return (
    <>
      {facet(
        'status',
        'Status',
        TASK_STATUSES.map((s) => ({
          value: s,
          label: TASK_STATUS_LABEL[s],
          icon: <span className={cn('size-2 rounded-full', DOT[STATUS_TONE[s]])} aria-hidden />,
          count: count((r) => r.status === s),
        })),
      )}
      {facet(
        'priority',
        'Priority',
        TASK_PRIORITIES.map((p) => ({
          value: p,
          label: TASK_PRIORITY_LABEL[p],
          icon: <span className={cn('size-2 rounded-full', DOT[PRIORITY_TONE[p]])} aria-hidden />,
          count: count((r) => r.priority === p),
        })),
      )}
      {facet(
        'ownerName',
        'Owner',
        owners.map((o) => ({ value: o, label: o, icon: <Avatar name={o} size="xs" />, count: count((r) => r.ownerName === o) })),
      )}
      {facet('linkType', 'Linked to', [
        ...TASK_LINK_TYPES.map((t) => ({
          value: t,
          label: LINK_LABEL[t],
          icon: <LinkTypeIcon type={t} />,
          count: count((r) => r.link?.type === t),
        })),
        { value: 'none', label: 'Not linked', count: count((r) => !r.link) },
      ])}
    </>
  )
}

const col = createColumnHelper<TaskView>()

function buildColumns(canEdit: boolean, onStatus: (t: TaskView, s: TaskStatus) => void) {
  return [
    col.accessor('title', {
      header: 'Task',
      enableHiding: false,
      meta: { width: 320 },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className={cn('truncate font-medium', row.original.status === 'done' || row.original.status === 'cancelled' ? 'text-muted line-through' : 'text-ink')}>
            {row.original.title}
          </p>
          <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted">
            {row.original.id}
            {row.original.blocked && <BlockedBadge reason={row.original.blockedReason} compact />}
            {row.original.subtaskProgress.total > 0 && (
              <span className="num font-sans" title="Sub-tasks done">
                {row.original.subtaskProgress.done}/{row.original.subtaskProgress.total}
              </span>
            )}
          </p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => TASK_STATUSES.indexOf(a.original.status) - TASK_STATUSES.indexOf(b.original.status),
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <StatusMenu status={row.original.status} variant="badge" disabled={!canEdit || !row.original.canEdit} title={row.original.title} onChange={(s) => onStatus(row.original, s)} />
        </div>
      ),
    }),
    col.accessor('priority', {
      header: 'Priority',
      filterFn: inSet,
      sortingFn: (a, b) => PRIORITY_RANK[a.original.priority] - PRIORITY_RANK[b.original.priority],
      cell: ({ getValue }) => <PriorityBadge priority={getValue()} />,
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <span className="flex min-w-0 items-center gap-2 text-ink-2">
          <Avatar name={getValue()} size="xs" />
          <span className="truncate">{getValue()}</span>
        </span>
      ),
    }),
    col.accessor((r) => r.dueDate ?? '', {
      id: 'dueDate',
      header: 'Due',
      // No date sorts last in ascending order.
      sortingFn: (a, b) => (a.original.dueDate ?? '9999').localeCompare(b.original.dueDate ?? '9999'),
      cell: ({ row }) => (
        <span
          className={cn(
            'num whitespace-nowrap',
            row.original.overdue ? 'font-medium text-danger-600 dark:text-danger-500' : row.original.dueDate ? 'text-ink-2' : 'text-subtle',
          )}
        >
          {dueLabel(row.original.dueDate)}
        </span>
      ),
    }),
    col.accessor((r) => r.link?.type ?? 'none', {
      id: 'linkType',
      header: 'Linked to',
      filterFn: inSet,
      sortingFn: (a, b) => (a.original.linkView?.label ?? '').localeCompare(b.original.linkView?.label ?? ''),
      cell: ({ row }) => (row.original.linkView ? <LinkChip link={row.original.linkView} /> : <span className="text-subtle">—</span>),
    }),
    col.accessor((r) => r.projectName ?? '', {
      id: 'projectName',
      header: 'Project',
      meta: { label: 'Project' },
      cell: ({ row }) =>
        row.original.projectId && row.original.projectName ? (
          <Link
            to={projectPath(row.original.projectId)}
            onClick={(e) => e.stopPropagation()}
            className="block max-w-56 truncate text-ink-2 hover:text-ink hover:underline"
          >
            {row.original.projectName}
          </Link>
        ) : (
          <span className="text-subtle">—</span>
        ),
    }),
    col.accessor((r) => r.loggedHours, {
      id: 'hours',
      header: 'Hours',
      meta: { align: 'end', label: 'Hours (logged / estimated)' },
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-ink-2">
          {row.original.loggedHours}
          <span className="text-muted"> / {row.original.estimatedHours || '—'} h</span>
        </span>
      ),
    }),
  ]
}
