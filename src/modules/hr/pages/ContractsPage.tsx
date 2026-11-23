import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { FileSignature, Plus } from 'lucide-react'
import type { EmployeeContract } from '@/modules/hr/peopleTypes'
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, CONTRACT_TYPES, CONTRACT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { useContractsQuery, useHrScope } from '@/modules/hr/hooks/useHrPeople'
import { ContractStatusBadge, HrError, Money } from '@/modules/hr/components/PeopleBits'
import { ContractDrawer } from '@/modules/hr/components/ContractDrawer'
import { employeePath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

/** `/hr/contracts`: every contract (with history) in the caller's HR scope; filters by type, status and "ending soon". */
export default function ContractsPage() {
  const navigate = useNavigate()
  const { canManage } = useHrScope()
  const query = useContractsQuery()
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [ending, setEnding] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canManage })
  const all = useMemo(() => query.data ?? [], [query.data])
  const data = useMemo(
    () =>
      all
        .filter((c) => !types.length || types.includes(c.type))
        .filter((c) => !statuses.length || statuses.includes(c.status))
        .filter((c) => !ending.length || (c.daysToEnd !== null && c.daysToEnd >= 0 && c.daysToEnd <= Math.max(...ending.map(Number)))),
    [all, types, statuses, ending],
  )
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({ id: 'hr-contracts', data, columns, globalFilter: search, globalFilterFn: contractSearch, getRowId: (r) => r.id })
  const endingSoon = all.filter((c) => c.daysToEnd !== null && c.daysToEnd >= 0 && c.daysToEnd <= 60).length

  return (
    <>
      <PageHeader
        icon={<IconTile><FileSignature /></IconTile>}
        title="Employee Contracts"
        description={query.data ? `${all.filter((c) => c.status === 'active').length} active · ${endingSoon} ending within 60 days` : 'Contracts per employee, with history.'}
        actions={canManage && <Button write onClick={() => setCreating(true)}><Plus />New contract</Button>}
      />
      <PageBody>
        {query.error ? (
          <HrError error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => navigate(employeePath(row.employeeId, 'contract'))}
            toolbar={
              <>
                <SearchInput aria-label="Search contracts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…" className="w-full sm:w-56" />
                <FacetFilter title="Type" options={CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_LABEL[t], count: all.filter((c) => c.type === t).length }))} selected={types} onChange={setTypes} />
                <FacetFilter title="Status" options={CONTRACT_STATUSES.map((s) => ({ value: s, label: CONTRACT_STATUS_LABEL[s], count: all.filter((c) => c.status === s).length }))} selected={statuses} onChange={setStatuses} />
                <FacetFilter title="Ending soon" options={[{ value: '30', label: 'Within 30 days' }, { value: '60', label: 'Within 60 days' }, { value: '90', label: 'Within 90 days' }]} selected={ending} onChange={setEnding} />
                <div className="ms-auto"><ColumnPicker table={table} /></div>
              </>
            }
            empty={<EmptyState icon={<FileSignature />} title={all.length ? 'No contracts match' : 'No contracts yet'} body={all.length ? 'Try another filter.' : 'Add the first contract.'} />}
          />
        )}
      </PageBody>
      {canManage && <ContractDrawer open={creating} onClose={() => setCreating(false)} mode="create" contract={null} />}
    </>
  )
}

const col = createColumnHelper<EmployeeContract>()

function buildColumns() {
  return [
    col.accessor('employeeName', {
      header: 'Employee',
      enableHiding: false,
      cell: ({ row }) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.original.employeeName}</span>
          <span className="num block text-xs text-muted">{row.original.employeeNo}</span>
        </span>
      ),
    }),
    col.accessor('type', { header: 'Type', cell: ({ getValue }) => CONTRACT_TYPE_LABEL[getValue()] }),
    col.accessor('status', {
      header: 'Status',
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          <ContractStatusBadge status={row.original.status} />
          {row.original.inProbation && <Badge tone="sky">Probation</Badge>}
        </span>
      ),
    }),
    col.accessor('startDate', { header: 'Start', cell: ({ getValue }) => <span className="num">{fmtDate(getValue())}</span> }),
    col.accessor((r) => r.endDate ?? '', {
      id: 'endDate',
      header: 'End',
      cell: ({ row }) => (
        <span className="num">
          {row.original.endDate ? fmtDate(row.original.endDate) : <span className="text-muted">Open-ended</span>}
          {row.original.daysToEnd !== null && row.original.daysToEnd <= 60 && <Badge tone="amber" className="ms-1.5">{row.original.daysToEnd}d</Badge>}
        </span>
      ),
    }),
    col.accessor((r) => r.totalSalary ?? -1, { id: 'total', header: 'Total / month', meta: { align: 'end' }, cell: ({ row }) => <Money value={row.original.totalSalary} currency={row.original.currency} /> }),
    col.accessor('noticeDays', { header: 'Notice', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue()} d</span> }),
  ]
}

const contractSearch: FilterFn<EmployeeContract> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  return [row.original.employeeName, row.original.employeeNo].join(' ').toLowerCase().includes(q)
}
