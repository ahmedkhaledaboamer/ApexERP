import { useMemo, useState } from 'react'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  Crown,
  MoreHorizontal,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRoundCheck,
  UserX,
  Users,
  X,
} from 'lucide-react'
import type { SettingsUserRow } from '@/modules/settings/users/types'
import { useSettingsUsersQuery } from '@/modules/settings/hooks/useSettingsUsers'
import { UserDrawer } from '@/modules/settings/users/UserDrawer'
import { UserStatusModal } from '@/modules/settings/users/UserStatusModal'
import { headsIndex } from '@/modules/settings/users/departmentHeads'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { ROLE_TONE, RoleBadge } from '@/modules/settings/users/RoleAccess'
import { can } from '@/shared/lib/permissions'
import { ROLES } from '@/shared/lib/constants'
import { formatUaeMobile } from '@/shared/lib/phone'
import { fmtDate } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

type DrawerState = { open: false } | { open: true; user: SettingsUserRow | null }

export default function UsersPage() {
  const me = useCurrentUser()
  const canEdit = !!me && can(me.role, 'settings', 'edit')
  const query = useSettingsUsersQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<DrawerState>({ open: false })
  const [statusFor, setStatusFor] = useState<SettingsUserRow | null>(null)
  const departments = useDepartmentsQuery(true)
  const headOf = useMemo(() => headsIndex(departments.data ?? []), [departments.data])

  const columns = useMemo(
    () =>
      buildColumns({
        canEdit,
        meId: me?.id ?? '',
        onEdit: (u) => setDrawer({ open: true, user: u }),
        onToggle: (u) => setStatusFor(u),
        headOf,
      }),
    [canEdit, me?.id, headOf],
  )

  const table = useDataTable({
    id: 'settings-users',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: userSearch,
    defaultSorting: [{ id: 'name', desc: false }],
    getRowId: (r) => r.id,
  })

  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Users & roles</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            Who can sign in and what each role sees. Users are deactivated, never deleted, so their history keeps its owner.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setDrawer({ open: true, user: null })}>
            <UserPlus />
            Add user
          </Button>
        )}
      </div>

      <Kpis rows={query.data} loading={query.isPending} />

      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(row) => setDrawer({ open: true, user: row })}
        minWidth={1180}
        toolbar={
          <>
            <SearchInput
              aria-label="Search users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, mobile…"
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
            icon={<Users aria-hidden />}
            title={data.length === 0 ? 'No users yet' : 'No users match'}
            body={data.length === 0 ? 'Add the first person who should sign in.' : 'Try another search or clear the filters.'}
          />
        }
      />

      <UserDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false })}
        user={drawer.open ? drawer.user : null}
        allUsers={data}
        currentUserId={me?.id ?? ''}
        readOnly={!canEdit}
      />
      <UserStatusModal user={statusFor} onClose={() => setStatusFor(null)} />
    </div>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading }: { rows: SettingsUserRow[] | undefined; loading: boolean }) {
  if (loading || !rows) {
    return (
      <section aria-label="User figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const active = rows.filter((r) => r.active)
  const deactivated = rows.length - active.length
  const admins = active.filter((r) => r.role === 'System Admin').length
  const withTwoFactor = active.filter((r) => r.twoFactorEnabled).length
  const pct = active.length ? Math.round((withTwoFactor / active.length) * 100) : 0

  return (
    <section aria-label="User figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active users" icon={<UserRoundCheck />} value={active.length} hint={`${rows.length} accounts in total`} />
      <StatCard label="Deactivated" icon={<UserX />} value={deactivated} hint={deactivated ? 'Kept for history; can’t sign in' : 'Everyone can sign in'} />
      <StatCard
        label="System Admins"
        icon={<ShieldAlert />}
        value={admins}
        alert={admins < 2}
        hint={admins < 2 ? 'Add a second admin as a backup' : 'Full access to everything'}
      />
      <StatCard label="2FA enabled" icon={<ShieldCheck />} value={`${pct}%`} progress={pct} hint={`${withTwoFactor} of ${active.length} active users`} />
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<SettingsUserRow>; data: SettingsUserRow[] }) {
  const count = (fn: (r: SettingsUserRow) => boolean) => data.filter(fn).length
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
  const departments = [...new Set(data.map((r) => r.departmentName))].sort()

  return (
    <>
      {facet(
        'role',
        'Role',
        ROLES.filter((r) => data.some((u) => u.role === r)).map((r) => ({
          value: r,
          label: r,
          icon: <span className={`size-2 rounded-full ${DOT[ROLE_TONE[r]]}`} aria-hidden />,
          count: count((u) => u.role === r),
        })),
      )}
      {facet('departmentName', 'Department', departments.map((d) => ({ value: d, label: d, count: count((u) => u.departmentName === d) })))}
      {facet('status', 'Status', [
        { value: 'Active', label: 'Active', icon: <span className={`size-2 rounded-full ${DOT.green}`} aria-hidden />, count: count((u) => u.active) },
        { value: 'Deactivated', label: 'Deactivated', icon: <span className={`size-2 rounded-full ${DOT.neutral}`} aria-hidden />, count: count((u) => !u.active) },
      ])}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<SettingsUserRow> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<SettingsUserRow>()

function buildColumns({
  canEdit,
  meId,
  onEdit,
  onToggle,
  headOf,
}: {
  canEdit: boolean
  meId: string
  onEdit: (u: SettingsUserRow) => void
  onToggle: (u: SettingsUserRow) => void
  /** userId → active departments they head. */
  headOf: Map<string, { id: string; name: string }[]>
}) {
  return [
    col.accessor('name', {
      header: 'User',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => {
        const u = row.original
        return (
          <div className={`flex min-w-0 items-center gap-2.5 ${u.active ? '' : 'opacity-60'}`}>
            <Avatar name={u.name} size="sm" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                <span className="truncate">{u.name}</span>
                {u.id === meId && <span className="shrink-0 rounded bg-sunken px-1 text-[0.6875rem] font-medium text-muted">You</span>}
              </p>
              <p className="truncate text-xs text-muted">{u.email}</p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('role', {
      header: 'Role',
      filterFn: inSet,
      sortingFn: (a, b) => ROLES.indexOf(a.original.role) - ROLES.indexOf(b.original.role),
      cell: ({ getValue }) => <RoleBadge role={getValue()} />,
    }),
    col.accessor('departmentName', {
      header: 'Department',
      filterFn: inSet,
      cell: ({ row, getValue }) => {
        const headed = headOf.get(row.original.id) ?? []
        return (
          <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-ink-2">
            {getValue()}
            {headed.map((d) => (
              <Badge key={d.id} tone="brand" icon={<Crown aria-hidden />}>
                Head of {d.name}
              </Badge>
            ))}
          </span>
        )
      },
    }),
    col.accessor('managerName', {
      header: 'Manager',
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
            <Avatar name={getValue()} size="xs" />
            {getValue()}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('mobile', {
      header: 'Mobile',
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-ink-2">{formatUaeMobile(getValue())}</span>,
    }),
    col.accessor((r) => (r.active ? 'Active' : 'Deactivated'), {
      id: 'status',
      header: 'Status',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <Badge tone={getValue() === 'Active' ? 'green' : 'neutral'} variant="dot">
          {getValue()}
        </Badge>
      ),
    }),
    col.accessor('twoFactorEnabled', {
      header: '2FA',
      meta: { label: 'Two-factor' },
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge tone="green" icon={<ShieldCheck />}>
            On
          </Badge>
        ) : (
          <Badge variant="outline">Off</Badge>
        ),
    }),
    col.accessor('lastLoginAt', {
      header: 'Last sign-in',
      sortUndefined: 'last',
      sortingFn: (a, b) => (a.original.lastLoginAt ?? '').localeCompare(b.original.lastLoginAt ?? ''),
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? (
          <span className="whitespace-nowrap text-ink-2" title={fmtDate(v, 'd MMM yyyy, HH:mm')}>
            {formatDistanceToNowStrict(new Date(v), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-muted">Never</span>
        )
      },
    }),
    col.display({
      id: 'actions',
      enableHiding: false,
      meta: { width: 52, align: 'end' },
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const u = row.original
        if (!canEdit) return null
        const self = u.id === meId
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              trigger={(props) => (
                <Button variant="ghost" size="xs" iconOnly aria-label={`Actions for ${u.name}`} {...props}>
                  <MoreHorizontal />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<Pencil />}
                    onSelect={() => {
                      close()
                      onEdit(u)
                    }}
                  >
                    Edit
                  </MenuItem>
                  {!self && <MenuSeparator />}
                  {!self &&
                    (u.active ? (
                      <MenuItem
                        danger
                        icon={<UserMinus />}
                        onSelect={() => {
                          close()
                          onToggle(u)
                        }}
                      >
                        Deactivate
                      </MenuItem>
                    ) : (
                      <MenuItem
                        icon={<UserCheck />}
                        onSelect={() => {
                          close()
                          onToggle(u)
                        }}
                      >
                        Reactivate
                      </MenuItem>
                    ))}
                </>
              )}
            </Menu>
          </div>
        )
      },
    }),
  ]
}

const userSearch: FilterFn<SettingsUserRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const u = row.original
  const digits = q.replace(/\D/g, '')
  const hay = [u.name, u.email, u.title, u.role, u.departmentName, u.managerName].join(' ').toLowerCase()
  return hay.includes(q) || (digits.length >= 3 && u.mobile.replace(/\D/g, '').includes(digits))
}
