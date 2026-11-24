import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { AlertTriangle, ExternalLink, ListChecks, MoreHorizontal, Network, Pencil, Plus, Power, PowerOff, ShieldOff, UserX, Users, X } from 'lucide-react'
import { departmentPath, PATHS } from '@/app/paths'
import type { DepartmentRow } from '@/modules/departments/types'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { DepartmentActiveBadge, DepartmentIcon, plural, treeOrder, useDepartmentsAccess } from '@/modules/departments/components/DepartmentBits'
import { DepartmentDrawer } from '@/modules/departments/components/DepartmentDrawer'
import { MoveMembersDialog } from '@/modules/departments/components/MoveMembersDialog'
import { useDepartmentActivation } from '@/modules/departments/components/useDepartmentActivation'
import { cn } from '@/shared/lib/utils'
import { Avatar, AvatarGroup } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { Can } from '@/shared/components/permissions/Can'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

/** A list row plus its place in the tree and member names (for the avatar group). */
type Row = DepartmentRow & { order: number; level: number; memberNames: string[] }

type DrawerState = { department: DepartmentRow | null } | null

/** Departments: the company structure as a list, with heads, members, tasks and goals. */
export default function DepartmentsPage() {
  const navigate = useNavigate()
  const { isFull, scope } = useDepartmentsAccess()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useDepartmentsQuery(true)
  const usersQuery = useUsersQuery()
  const [drawer, setDrawer] = useState<DrawerState>(null)
  const [moving, setMoving] = useState<DepartmentRow | null>(null)
  const activation = useDepartmentActivation()
  useNewParam(() => setDrawer({ department: null }), { when: isFull })

  const data = useMemo<Row[]>(() => {
    const rows = query.data ?? []
    const order = treeOrder(rows)
    const names = new Map<string, string[]>()
    for (const u of usersQuery.data ?? []) {
      if (u.active === false) continue
      names.set(u.departmentId, [...(names.get(u.departmentId) ?? []), u.name])
    }
    return rows.map((r) => ({
      ...r,
      order: order.get(r.id)?.order ?? 0,
      level: order.get(r.id)?.depth ?? 0,
      // Head first, then A–Z.
      memberNames: (names.get(r.id) ?? []).sort((a, b) => Number(b === r.headName) - Number(a === r.headName) || a.localeCompare(b)),
    }))
  }, [query.data, usersQuery.data])

  const columns = useMemo(
    () =>
      buildColumns({
        isFull,
        pendingId: activation.pendingId,
        onOpen: (d) => navigate(departmentPath(d.id)),
        onEdit: (d) => setDrawer({ department: d }),
        onMove: (d) => setMoving(d),
        onSetActive: activation.setActive,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isFull, activation.pendingId],
  )

  const table = useDataTable({
    id: 'departments-list',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: departmentSearch,
    defaultHidden: ['costCenter', 'head'],
    defaultSorting: [{ id: 'name', desc: false }],
    getRowId: (r) => r.id,
  })

  // Start on active departments; the Status facet shows how to see the rest.
  const preset = useRef(false)
  useEffect(() => {
    if (preset.current) return
    preset.current = true
    table.getColumn('active')?.setFilterValue(['active'])
  }, [table])

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filters = table.getState().columnFilters
  const onlyDefault = filters.length === 1 && filters[0].id === 'active' && String(filters[0].value) === 'active'
  const filtered = (filters.length > 0 && !onlyDefault) || !!search
  const newButton = isFull ? (
    <Can module="departments" action="edit">
      <Button write size="sm" onClick={() => setDrawer({ department: null })}>
        <Plus />
        New department
      </Button>
    </Can>
  ) : null

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Network />
          </IconTile>
        }
        title="Departments"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Who belongs where, who leads each team, and what they’re working on.</span>
            {scope === 'team' && (
              <Badge tone="blue" icon={<Users />}>
                Your team only
              </Badge>
            )}
            {scope === 'view' && (
              <Badge tone="amber" icon={<ShieldOff />}>
                View only
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            <Link
              to={PATHS.orgChart}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[0.8125rem] font-medium text-ink shadow-xs hover:bg-hover [&_svg]:size-4"
            >
              <Network aria-hidden />
              Company structure
            </Link>
            {newButton}
          </>
        }
      />
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(departmentPath(row.id))}
          minWidth={1080}
          toolbar={
            <>
              <SearchInput
                aria-label="Search departments"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, head, parent, cost center…"
                className="w-full sm:w-72"
              />
              <Facets table={table} data={data} />
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    table.setColumnFilters([{ id: 'active', value: ['active'] }])
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
              icon={<Network />}
              title={data.length === 0 ? 'No departments yet' : 'No departments match'}
              body={
                data.length === 0
                  ? scope === 'full'
                    ? 'Add the first department, then move people into it.'
                    : 'You’re not in a department you can see yet. Ask an admin to add you to one.'
                  : 'Try another search, or clear the filters to include inactive departments.'
              }
              action={
                data.length === 0 ? (
                  newButton
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      table.resetColumnFilters()
                      setSearch('')
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          }
        />
      </PageBody>
      {isFull && <DepartmentDrawer open={!!drawer} onClose={() => setDrawer(null)} department={drawer?.department} openAfterCreate={!drawer?.department} />}
      {isFull && moving && <MoveMembersDialog open onClose={() => setMoving(null)} from={moving} />}
      {isFull && activation.modal}
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading }: { rows: DepartmentRow[] | undefined; loading: boolean }) {
  if (loading || !rows) {
    return (
      <section aria-label="Department figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const active = rows.filter((r) => r.active)
  const people = active.reduce((s, r) => s + r.memberCount, 0)
  const headless = active.filter((r) => !r.headId).length
  const open = active.reduce((s, r) => s + r.openTasks, 0)
  const overdue = active.reduce((s, r) => s + r.overdueTasks, 0)
  return (
    <section aria-label="Department figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Departments" icon={<Network />} value={active.length} hint={rows.length > active.length ? `${rows.length - active.length} inactive` : 'All active'} />
      <StatCard label="People" icon={<Users />} value={people} hint="Active members across departments" />
      <StatCard label="Without a head" icon={<UserX />} value={headless} alert={headless > 0} hint={headless ? 'Pick a head on the department page' : 'Every department has a head'} />
      <StatCard
        label="Open tasks"
        icon={<ListChecks />}
        value={
          <span className="flex items-baseline gap-2">
            {open}
            {overdue > 0 && <span className="text-base font-semibold text-danger-600 dark:text-danger-500">{overdue} overdue</span>}
          </span>
        }
        hint="Lead tasks owned by members"
      />
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<Row>; data: Row[] }) {
  const count = (fn: (r: Row) => boolean) => data.filter(fn).length
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
  const parents = [...new Map(data.filter((r) => r.parentId).map((r) => [r.parentId as string, r.parentName ?? r.parentId ?? ''])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )
  const dot = (tone: keyof typeof DOT) => <span className={cn('size-2 rounded-full', DOT[tone])} aria-hidden />
  return (
    <>
      {facet('parent', 'Parent', [
        { value: '__top', label: 'Top level', count: count((r) => !r.parentId) },
        ...parents.map(([id, name]) => ({ value: id, label: name, count: count((r) => r.parentId === id) })),
      ])}
      {facet('head', 'Head', [
        { value: 'yes', label: 'Has a head', icon: dot('green'), count: count((r) => !!r.headId) },
        { value: 'no', label: 'No head', icon: dot('amber'), count: count((r) => !r.headId) },
      ])}
      {facet('active', 'Status', [
        { value: 'active', label: 'Active', icon: dot('green'), count: count((r) => r.active) },
        { value: 'inactive', label: 'Inactive', icon: dot('neutral'), count: count((r) => !r.active) },
      ])}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<Row> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))

const departmentSearch: FilterFn<Row> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const d = row.original
  return [d.name, d.headName, d.parentName, d.costCenter, ...d.memberNames].filter(Boolean).join(' ').toLowerCase().includes(q)
}

const col = createColumnHelper<Row>()

interface ColumnDeps {
  isFull: boolean
  pendingId: string | null
  onOpen: (d: Row) => void
  onEdit: (d: Row) => void
  onMove: (d: Row) => void
  onSetActive: (d: Row, active: boolean) => void
}

function buildColumns({ isFull, pendingId, onOpen, onEdit, onMove, onSetActive }: ColumnDeps) {
  const columns = [
    col.accessor('name', {
      header: 'Department',
      enableHiding: false,
      meta: { width: 300 },
      // A–Z keeps the tree: children right under their parent.
      sortingFn: (a, b) => a.original.order - b.original.order,
      cell: ({ row }) => {
        const d = row.original
        return (
          <div className={cn('flex min-w-0 items-center gap-2', !d.active && 'opacity-60')} style={{ paddingInlineStart: `${Math.min(d.level, 6) * 1.25}rem` }}>
            {d.level > 0 && (
              <span aria-hidden className="shrink-0 font-mono text-xs text-subtle">
                └
              </span>
            )}
            <DepartmentIcon size="sm" muted={!d.active} />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{d.name}</p>
              <p className="truncate text-xs text-muted">
                {d.parentName ? `${d.parentName} › ${d.name}` : 'Top level'}
                {d.childCount > 0 && ` · ${plural(d.childCount, 'sub-department')}`}
              </p>
            </div>
          </div>
        )
      },
    }),
    col.accessor((r) => r.headName ?? '', {
      id: 'headName',
      header: 'Head',
      meta: { label: 'Head', width: 200 },
      cell: ({ row }) =>
        row.original.headName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.headName} size="sm" />
            <span className="truncate text-ink-2">{row.original.headName}</span>
          </span>
        ) : row.original.active ? (
          <Badge tone="amber" variant="dot">
            No head
          </Badge>
        ) : (
          <span className="text-subtle">—</span>
        ),
    }),
    col.accessor((r) => (r.parentId ? r.parentId : '__top'), {
      id: 'parent',
      header: 'Parent',
      filterFn: inSet,
      sortingFn: (a, b) => (a.original.parentName ?? '').localeCompare(b.original.parentName ?? ''),
      meta: { label: 'Parent' },
      cell: ({ row }) => <span className="whitespace-nowrap text-ink-2">{row.original.parentName ?? <span className="text-subtle">Top level</span>}</span>,
    }),
    col.accessor('memberCount', {
      header: 'Members',
      meta: { width: 150 },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {row.original.memberNames.length > 0 && <AvatarGroup names={row.original.memberNames} max={3} size="xs" />}
          <span className={cn('num', row.original.memberCount ? 'text-ink' : 'text-subtle')}>{row.original.memberCount}</span>
        </span>
      ),
    }),
    col.accessor('openTasks', {
      header: 'Open tasks',
      meta: { align: 'end' },
      cell: ({ row }) => (
        <span className="num inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={row.original.openTasks ? 'text-ink' : 'text-subtle'}>{row.original.openTasks}</span>
          {row.original.overdueTasks > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-danger-600 dark:text-danger-500" title={`${row.original.overdueTasks} overdue`}>
              <AlertTriangle className="size-3" aria-hidden />
              {row.original.overdueTasks} overdue
            </span>
          )}
        </span>
      ),
    }),
    col.accessor('openGoals', {
      header: 'Goals open',
      meta: { align: 'end' },
      cell: ({ getValue }) => <span className={cn('num', getValue() ? 'text-ink' : 'text-subtle')}>{getValue()}</span>,
    }),
    col.accessor('costCenter', {
      header: 'Cost center',
      cell: ({ getValue }) => (getValue() ? <span className="font-mono text-xs text-ink-2">{getValue()}</span> : <span className="text-subtle">—</span>),
    }),
    col.accessor((r) => (!r.headId ? 'no' : 'yes'), {
      id: 'head',
      header: 'Has head',
      filterFn: inSet,
      enableHiding: false,
      meta: { label: 'Has head' },
    }),
    col.accessor((r) => (r.active ? 'active' : 'inactive'), {
      id: 'active',
      header: 'Status',
      filterFn: inSet,
      meta: { label: 'Status', width: 100 },
      cell: ({ row }) => <DepartmentActiveBadge active={row.original.active} />,
    }),
  ]
  if (!isFull) return columns
  return [
    ...columns,
    col.display({
      id: 'actions',
      enableHiding: false,
      meta: { width: 48, align: 'end' },
      cell: ({ row }) => {
        const d = row.original
        return (
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <Menu
              className="w-52"
              trigger={(props) => (
                <Button write variant="ghost" size="xs" iconOnly aria-label={`Actions for ${d.name}`} loading={pendingId === d.id} {...props}>
                  {pendingId !== d.id && <MoreHorizontal />}
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<ExternalLink />}
                    onSelect={() => {
                      close()
                      onOpen(d)
                    }}
                  >
                    Open
                  </MenuItem>
                  <MenuItem
                    icon={<Pencil />}
                    onSelect={() => {
                      close()
                      onEdit(d)
                    }}
                  >
                    Edit
                  </MenuItem>
                  {d.active && (
                    <MenuItem
                      icon={<Users />}
                      onSelect={() => {
                        close()
                        onMove(d)
                      }}
                    >
                      Move members…
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem
                    icon={d.active ? <PowerOff /> : <Power />}
                    danger={d.active}
                    onSelect={() => {
                      close()
                      onSetActive(d, !d.active)
                    }}
                  >
                    {d.active ? 'Deactivate' : 'Reactivate'}
                  </MenuItem>
                </>
              )}
            </Menu>
          </span>
        )
      },
    }),
  ]
}
