import { useMemo, useState } from 'react'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { ArrowRightLeft, Crown, MoreHorizontal, UserPlus, Users } from 'lucide-react'
import type { User } from '@/shared/types'
import type { DepartmentDetail, DepartmentMember } from '@/modules/departments/types'
import { useSetMemberManager, useUpdateDepartment } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { RoleBadge } from '@/modules/departments/components/DepartmentBits'
import { AddMembersDialog } from '@/modules/departments/components/AddMembersDialog'
import { MoveMembersDialog } from '@/modules/departments/components/MoveMembersDialog'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, SelectInput } from '@/shared/components/form/Field'
import { DataTable, selectColumn, useDataTable } from '@/shared/components/data-table'

interface MembersTabProps {
  dept: DepartmentDetail
  /** Full scope (and `can.edit`): add, move, make head. */
  canMove: boolean
  /** Full scope or this department's head (`can.manageMembers`): change direct managers. */
  canManage: boolean
}

/** Members: everyone whose department is this one (same field as Settings › Users & roles). */
export function DepartmentMembersTab({ dept, canMove, canManage }: MembersTabProps) {
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState<string[] | null>(null)
  const [pendingManager, setPendingManager] = useState<string | null>(null)
  const usersQuery = useUsersQuery()
  const setManager = useSetMemberManager(dept.id)
  const update = useUpdateDepartment()
  const toast = useToast()

  const people = useMemo(() => (usersQuery.data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [usersQuery.data])

  function changeManager(m: DepartmentMember, managerId: string | null) {
    setPendingManager(m.id)
    setManager.mutate(
      { userId: m.id, managerId },
      {
        onSuccess: (res) => toast.success('Direct manager changed', `${res.name} → ${res.managerName ?? 'no manager'}`),
        onError: (e) => toast.error('Couldn’t change the manager', e.message),
        onSettled: () => setPendingManager(null),
      },
    )
  }

  function makeHead(m: DepartmentMember) {
    update.mutate(
      { id: dept.id, input: { headId: m.id } },
      {
        onSuccess: () => toast.success('Head changed', `${m.name} now heads ${dept.name}`),
        onError: (e) => toast.error('Couldn’t change the head', e.message),
      },
    )
  }

  const columns = useMemo(
    () => buildColumns({ dept, canMove, canManage, people, pendingManager, onManager: changeManager, onMakeHead: makeHead, onMove: (id) => setMoving([id]) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dept, canMove, canManage, people, pendingManager],
  )

  const table = useDataTable({
    id: 'department-members',
    data: dept.members,
    columns,
    globalFilter: search,
    globalFilterFn: memberSearch,
    enableRowSelection: canMove,
    defaultPageSize: 25,
    getRowId: (m) => m.id,
  })

  const addButton = canMove && dept.active && (
    <Button size="sm" onClick={() => setAdding(true)}>
      <UserPlus />
      Add members
    </Button>
  )

  return (
    <>
      <DataTable
        table={table}
        minWidth={760}
        toolbar={
          <>
            <SearchInput aria-label="Search members" placeholder="Search name, title, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" />
            <span className="num text-xs text-muted">{dept.members.filter((m) => m.active).length} active</span>
            <div className="ms-auto flex items-center gap-2">{addButton}</div>
          </>
        }
        bulkActions={
          canMove
            ? (selected) => (
                <Button variant="secondary" size="sm" disabled={!selected.some((m) => m.active)} onClick={() => setMoving(selected.filter((m) => m.active).map((m) => m.id))}>
                  <ArrowRightLeft />
                  Move to another department…
                </Button>
              )
            : undefined
        }
        empty={
          <EmptyState
            icon={<Users />}
            title={dept.members.length ? 'No members match' : 'No members yet'}
            body={
              dept.members.length
                ? 'Try another search.'
                : canMove
                  ? 'Add people to this department. They move out of their current one.'
                  : 'Nobody is in this department yet.'
            }
            action={dept.members.length ? undefined : addButton || undefined}
          />
        }
      />
      {canMove && <AddMembersDialog open={adding} onClose={() => setAdding(false)} to={dept} />}
      {canMove && moving && (
        <MoveMembersDialog
          open
          onClose={() => setMoving(null)}
          from={dept}
          preselectedIds={moving}
          onMoved={() => table.resetRowSelection()}
        />
      )}
    </>
  )
}

/* ---------------- Columns ---------------- */

const memberSearch: FilterFn<DepartmentMember> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const m = row.original
  return [m.name, m.title, m.email, m.role, m.managerName].filter(Boolean).join(' ').toLowerCase().includes(q)
}

const col = createColumnHelper<DepartmentMember>()

interface ColumnDeps {
  dept: DepartmentDetail
  canMove: boolean
  canManage: boolean
  people: User[]
  pendingManager: string | null
  onManager: (m: DepartmentMember, managerId: string | null) => void
  onMakeHead: (m: DepartmentMember) => void
  onMove: (id: string) => void
}

function buildColumns({ dept, canMove, canManage, people, pendingManager, onManager, onMakeHead, onMove }: ColumnDeps) {
  const here = people.filter((u) => u.departmentId === dept.id)
  const others = people.filter((u) => u.departmentId !== dept.id)
  const columns = [
    col.accessor('name', {
      header: 'Member',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => {
        const m = row.original
        return (
          <div className={cn('flex min-w-0 items-center gap-3', !m.active && 'opacity-60')}>
            <Avatar name={m.name} size="md" />
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-ink">{m.name}</span>
                {m.isHead && (
                  <Badge tone="amber" icon={<Crown />}>
                    Head
                  </Badge>
                )}
                {!m.active && <Badge tone="neutral">Deactivated</Badge>}
              </p>
              <p className="truncate text-xs text-muted">{m.email}</p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('title', {
      header: 'Title',
      cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() || <span className="text-subtle">—</span>}</span>,
    }),
    col.accessor('role', {
      header: 'Role',
      cell: ({ getValue }) => <RoleBadge role={getValue()} />,
    }),
    col.accessor((m) => m.managerName ?? '', {
      id: 'manager',
      header: 'Direct manager',
      meta: { label: 'Direct manager', width: 220 },
      cell: ({ row }) => {
        const m = row.original
        if (!canManage || !m.active) {
          return m.managerName ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={m.managerName} size="xs" />
              <span className="truncate text-ink-2">{m.managerName}</span>
            </span>
          ) : (
            <span className="text-subtle">—</span>
          )
        }
        const value = m.managerId ?? ''
        const known = !value || people.some((u) => u.id === value)
        return (
          <span onClick={(e) => e.stopPropagation()} className="block min-w-40">
            <SelectInput
              aria-label={`Direct manager of ${m.name}`}
              value={value}
              disabled={pendingManager === m.id}
              onChange={(e) => onManager(m, e.target.value || null)}
              className="h-8"
            >
              <option value="">No manager</option>
              {!known && <option value={value}>{m.managerName ?? 'Inactive user'}</option>}
              <optgroup label={`In ${dept.name}`}>
                {here
                  .filter((u) => u.id !== m.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Other departments">
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            </SelectInput>
          </span>
        )
      },
    }),
  ]
  if (!canMove) return columns
  return [
    selectColumn<DepartmentMember>(),
    ...columns,
    col.display({
      id: 'actions',
      enableHiding: false,
      meta: { width: 48, align: 'end' },
      cell: ({ row }) => {
        const m = row.original
        return (
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <Menu
              className="w-60"
              trigger={(props) => (
                <Button variant="ghost" size="xs" iconOnly aria-label={`Actions for ${m.name}`} {...props}>
                  <MoreHorizontal />
                </Button>
              )}
            >
              {(close) => (
                <>
                  {!m.isHead && m.active && dept.active && (
                    <MenuItem
                      icon={<Crown />}
                      onSelect={() => {
                        close()
                        onMakeHead(m)
                      }}
                    >
                      Make head of {dept.name}
                    </MenuItem>
                  )}
                  {m.active ? (
                    <MenuItem
                      icon={<ArrowRightLeft />}
                      onSelect={() => {
                        close()
                        onMove(m.id)
                      }}
                    >
                      Move to another department…
                    </MenuItem>
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-muted">Deactivated users are moved from Settings › Users &amp; roles.</p>
                  )}
                </>
              )}
            </Menu>
          </span>
        )
      },
    }),
  ]
}
