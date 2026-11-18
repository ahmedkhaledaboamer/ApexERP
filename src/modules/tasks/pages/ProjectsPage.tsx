import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { AlarmClock, FolderKanban, Hourglass, PauseCircle, PlayCircle, Plus, ShieldOff, X } from 'lucide-react'
import type { Scope } from '@/shared/types'
import { customerPath, projectPath, servicePath } from '@/app/paths'
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectRow } from '@/modules/tasks/types'
import { useProjectsQuery } from '@/modules/tasks/hooks/useTasks'
import { NewProjectDrawer } from '@/modules/tasks/projects/NewProjectDrawer'
import { fmtHours, PROJECT_STATUS_TONE, ProgressBar, ProjectStatusBadge } from '@/modules/tasks/projects/projectUi'
import { useCurrentUser } from '@/store/hooks'
import { SCOPE_LABELS, scopeOf } from '@/shared/lib/permissions'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Can } from '@/shared/components/permissions/Can'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

/** Task Management › Projects: delivery projects in the caller's tasks scope. */
export default function ProjectsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Projects aren’t part of your role" body={`${user.role} has no access to Task Management. Ask a Company Admin if you need it.`} />
      </PageBody>
    )
  }
  return <ProjectsList scope={scope} />
}

function ProjectsList({ scope }: { scope: Scope }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useProjectsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [creating, setCreating] = useState(false)
  // Own-scope roles work inside projects; team and full scope create them (matches POST /projects).
  const canCreate = scope === 'full' || scope === 'team'
  const columns = useMemo(() => buildColumns(), [])

  const table = useDataTable({
    id: 'tasks-projects',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: projectSearch,
    defaultHidden: ['overdueCount'],
    defaultSorting: [{ id: 'endDate', desc: false }],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search
  const newButton = canCreate && (
    <Can module="tasks" action="create">
      <Button write size="sm" onClick={() => setCreating(true)}>
        <Plus />
        New project
      </Button>
    </Can>
  )

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <FolderKanban />
          </IconTile>
        }
        title="Projects"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{query.data ? `${data.length} project${data.length === 1 ? '' : 's'}` : 'Loading…'}</span>
            <span aria-hidden>·</span>
            <span>{SCOPE_LABELS[scope]}</span>
            {!canCreate && (
              <Badge tone="amber" icon={<ShieldOff />}>
                Projects you work on
              </Badge>
            )}
          </span>
        }
        actions={newButton}
      />
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} onFilter={(s) => table.getColumn('status')?.setFilterValue([s])} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(projectPath(row.id))}
          minWidth={1180}
          toolbar={
            <>
              <SearchInput
                aria-label="Search projects"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, customer, service…"
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
              icon={<FolderKanban aria-hidden />}
              title={data.length === 0 ? 'No projects yet' : 'No projects match'}
              body={
                data.length === 0
                  ? canCreate
                    ? 'Projects are created when a deal is Won, or start one by hand.'
                    : 'Projects you have tasks in, or that you manage, show up here.'
                  : 'Try another search or clear the filters.'
              }
              action={data.length === 0 ? newButton || undefined : undefined}
            />
          }
        />
      </PageBody>
      {canCreate && <NewProjectDrawer open={creating} onClose={() => setCreating(false)} />}
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading, onFilter }: { rows: ProjectRow[] | undefined; loading: boolean; onFilter: (status: string) => void }) {
  if (loading || !rows) {
    return (
      <section aria-label="Project figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const active = rows.filter((r) => r.status === 'active')
  const onHold = rows.filter((r) => r.status === 'on_hold')
  const live = rows.filter((r) => r.status !== 'cancelled')
  const overdue = live.reduce((s, r) => s + r.overdueCount, 0)
  const overdueProjects = live.filter((r) => r.overdueCount > 0).length
  const logged = live.reduce((s, r) => s + r.loggedHours, 0)
  const estimated = live.reduce((s, r) => s + r.estimatedHours, 0)
  const pct = estimated ? Math.round((logged / estimated) * 100) : 0

  const clickable = (status: keyof typeof PROJECT_STATUS_LABEL, card: ReactNode) => (
    <button
      type="button"
      onClick={() => onFilter(status)}
      title={`Show ${PROJECT_STATUS_LABEL[status].toLowerCase()} projects`}
      className="block rounded-card text-start transition-shadow hover:shadow-soft focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
    >
      {card}
    </button>
  )

  return (
    <section aria-label="Project figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {clickable('active', <StatCard label="Active" icon={<PlayCircle />} value={active.length} hint={`${rows.filter((r) => r.status === 'planned').length} planned`} />)}
      {clickable('on_hold', <StatCard label="On hold" icon={<PauseCircle />} value={onHold.length} hint={onHold.length ? 'Waiting on something' : 'Nothing paused'} />)}
      <StatCard
        label="Overdue tasks"
        icon={<AlarmClock />}
        value={overdue}
        alert={overdue > 0}
        hint={overdue ? `across ${overdueProjects} project${overdueProjects === 1 ? '' : 's'}` : 'Everything on schedule'}
      />
      <StatCard label="Hours logged" icon={<Hourglass />} value={fmtHours(logged)} hint={`of ${fmtHours(estimated)} estimated (${pct}%)`} progress={pct} />
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<ProjectRow>; data: ProjectRow[] }) {
  const count = (fn: (r: ProjectRow) => boolean) => data.filter(fn).length
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
  const managers = [...new Set(data.map((r) => r.managerName))].sort()
  const customers = [...new Set(data.map((r) => r.customerName))].sort()
  return (
    <>
      {facet(
        'status',
        'Status',
        PROJECT_STATUSES.map((s) => ({
          value: s,
          label: PROJECT_STATUS_LABEL[s],
          icon: <span className={`size-2 rounded-full ${DOT[PROJECT_STATUS_TONE[s]]}`} aria-hidden />,
          count: count((r) => r.status === s),
        })),
      )}
      {facet(
        'managerName',
        'Manager',
        managers.map((m) => ({ value: m, label: m, icon: <Avatar name={m} size="xs" />, count: count((r) => r.managerName === m) })),
      )}
      {facet(
        'customerName',
        'Customer',
        customers.map((c) => ({ value: c, label: c, icon: <Avatar name={c} size="xs" square />, count: count((r) => r.customerName === c) })),
      )}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<ProjectRow> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<ProjectRow>()
const stop = (e: MouseEvent) => e.stopPropagation()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Project',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => {
        const p = row.original
        return (
          <div className={cn('min-w-0', p.status === 'cancelled' && 'opacity-70')}>
            <p className="truncate font-medium text-ink">{p.name}</p>
            <p className="truncate text-xs text-muted">
              <span className="font-mono">{p.id}</span> · {p.taskCount} task{p.taskCount === 1 ? '' : 's'}
              {p.createdFrom === 'won' && ' · from Won deal'}
            </p>
          </div>
        )
      },
    }),
    col.accessor('customerName', {
      header: 'Customer',
      filterFn: inSet,
      cell: ({ row }) => (
        <Link to={customerPath(row.original.customerId)} onClick={stop} className="flex min-w-0 items-center gap-2 text-ink-2 hover:text-ink hover:underline">
          <Avatar name={row.original.customerName} size="xs" square />
          <span className="truncate">{row.original.customerName}</span>
        </Link>
      ),
    }),
    col.accessor('serviceName', {
      header: 'Service',
      cell: ({ row }) => (
        <Link to={servicePath(row.original.serviceId)} onClick={stop} className="block truncate text-ink-2 hover:text-ink hover:underline" title={row.original.serviceName}>
          {row.original.serviceName}
        </Link>
      ),
    }),
    col.accessor('managerName', {
      header: 'Manager',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-ink-2" title={getValue()}>
          <Avatar name={getValue()} size="xs" />
          <span className="truncate">{getValue()}</span>
        </span>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => PROJECT_STATUSES.indexOf(a.original.status) - PROJECT_STATUSES.indexOf(b.original.status),
      cell: ({ getValue }) => <ProjectStatusBadge status={getValue()} />,
    }),
    col.accessor('endDate', {
      header: 'Start – end',
      cell: ({ row }) => {
        const p = row.original
        const late = p.status !== 'completed' && p.status !== 'cancelled' && p.endDate < new Date().toISOString().slice(0, 10)
        return (
          <span className="num flex flex-col text-xs leading-tight whitespace-nowrap">
            <span className="text-ink-2">{fmtDate(p.startDate, 'd MMM yy')}</span>
            <span className={late ? 'font-medium text-danger-600' : 'text-muted'}>→ {fmtDate(p.endDate, 'd MMM yy')}</span>
          </span>
        )
      },
    }),
    col.accessor('progress', {
      header: 'Progress',
      meta: { width: 150 },
      cell: ({ row }) => (
        <span className="block" title={`${row.original.doneCount} of ${row.original.taskCount} tasks done`}>
          <ProgressBar value={row.original.progress} />
        </span>
      ),
    }),
    col.accessor('loggedHours', {
      header: 'Hours',
      meta: { align: 'end' },
      cell: ({ row }) => {
        const p = row.original
        const over = p.estimatedHours > 0 && p.loggedHours > p.estimatedHours
        return (
          <span className="num whitespace-nowrap text-xs">
            <span className={over ? 'font-medium text-danger-600' : 'text-ink'}>{p.loggedHours}</span>
            <span className="text-muted"> / {fmtHours(p.estimatedHours)}</span>
          </span>
        )
      },
    }),
    col.accessor('overdueCount', {
      header: 'Overdue',
      meta: { align: 'end' },
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge tone="red" icon={<AlarmClock />}>
            {getValue()}
          </Badge>
        ) : (
          <span className="text-xs text-subtle">—</span>
        ),
    }),
  ]
}

const projectSearch: FilterFn<ProjectRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const p = row.original
  return [p.name, p.id, p.customerName, p.serviceName, p.managerName, PROJECT_STATUS_LABEL[p.status]].join(' ').toLowerCase().includes(q)
}
