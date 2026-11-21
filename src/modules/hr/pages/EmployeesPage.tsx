import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Download, FileSpreadsheet, Plus, Users } from 'lucide-react'
import type { EmploymentStatus } from '@/modules/hr/types'
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import type { EmployeeExportRow, EmployeeRow } from '@/modules/hr/peopleTypes'
import { useEmployeesQuery, useHrScope } from '@/modules/hr/hooks/useHrPeople'
import { exportEmployees } from '@/modules/hr/api/hrPeopleApi'
import { DocAlertBadge, EmploymentStatusBadge, HrError } from '@/modules/hr/components/PeopleBits'
import { EmployeeDrawer } from '@/modules/hr/components/EmployeeDrawer'
import { employeePath } from '@/app/paths'
import { buildCsv, csvFileName, downloadCsv, type CsvColumn } from '@/modules/platform/csv'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { fmtDate } from '@/shared/lib/utils'
import { countryLabel } from '@/shared/lib/country'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

/** `/hr/employees`: HR full sees everyone (and manages); a department head their team; an employee themself. */
export default function EmployeesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { scope, canManage } = useHrScope()
  const query = useEmployeesQuery()
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [depts, setDepts] = useState<string[]>([])
  const [alertsOnly, setAlertsOnly] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const all = useMemo(() => query.data ?? [], [query.data])
  const data = useMemo(
    () =>
      all
        .filter((e) => !statuses.length || statuses.includes(e.status))
        .filter((e) => !depts.length || depts.includes(e.departmentName ?? '—'))
        .filter((e) => !alertsOnly.length || (e.docAlert !== null && alertsOnly.includes(e.docAlert))),
    [all, statuses, depts, alertsOnly],
  )
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({ id: 'hr-employees', data, columns, globalFilter: search, globalFilterFn: employeeSearch, defaultHidden: ['nationality', 'employmentType'], getRowId: (r) => r.id })
  const alerts = all.filter((e) => e.docAlert).length

  async function runExport(kind: 'csv' | 'xlsx') {
    setExporting(kind)
    try {
      const keep = new Set(table.getFilteredRowModel().rows.map((r) => r.original.employeeNo))
      const rows = (await exportEmployees()).filter((r) => keep.has(r.employeeNo))
      if (kind === 'csv') downloadCsv(csvFileName('employees'), buildCsv(rows, CSV_COLUMNS))
      else
        await downloadExcel(
          `employees-${format(new Date(), 'yyyy-MM-dd')}`,
          [{ name: 'Employees', title: 'Employees', columns: CSV_COLUMNS.map((c) => ({ header: c.header, width: 18 })), rows: rows.map((r) => CSV_COLUMNS.map((c) => c.value(r) as string)) }],
          `${rows.length} employees · document numbers and bank details are never exported · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`,
        )
      toast.success('Export ready', `${rows.length} employee${rows.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : 'Try again in a moment.')
    } finally {
      setExporting(null)
    }
  }

  const deptOptions = [...new Set(all.map((e) => e.departmentName ?? '—'))].sort().map((v) => ({ value: v, label: v, count: all.filter((e) => (e.departmentName ?? '—') === v).length }))

  return (
    <>
      <PageHeader
        icon={<IconTile><Users /></IconTile>}
        title="Employees"
        description={
          query.data
            ? `${all.length} ${scope === 'own' ? 'record' : 'employees'}${scope === 'team' ? ' in your team' : ''}${alerts ? ` · ${alerts} with document alerts` : ''}`
            : 'Employee records, documents and offboarding.'
        }
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => runExport('csv')} loading={exporting === 'csv'} disabled={!data.length}>
                <Download />
                CSV
              </Button>
              <Button variant="secondary" onClick={() => runExport('xlsx')} loading={exporting === 'xlsx'} disabled={!data.length}>
                <FileSpreadsheet />
                Excel
              </Button>
              <Button write onClick={() => setCreating(true)}>
                <Plus />
                New employee
              </Button>
            </>
          )
        }
      />
      <PageBody>
        {query.error ? (
          <HrError error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => navigate(employeePath(row.id))}
            toolbar={
              <>
                <SearchInput aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, title…" className="w-full sm:w-64" />
                <FacetFilter title="Status" options={EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABEL[s], count: all.filter((e) => e.status === s).length }))} selected={statuses} onChange={setStatuses} />
                <FacetFilter title="Department" options={deptOptions} selected={depts} onChange={setDepts} />
                <FacetFilter title="Documents" options={[{ value: 'expiring', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }]} selected={alertsOnly} onChange={setAlertsOnly} />
                <div className="ms-auto">
                  <ColumnPicker table={table} />
                </div>
              </>
            }
            empty={<EmptyState icon={<Users />} title={all.length ? 'No employees match' : 'No employees yet'} body={all.length ? 'Try another search or filter.' : 'Add the first employee record.'} />}
          />
        )}
      </PageBody>
      {canManage && <EmployeeDrawer open={creating} onClose={() => setCreating(false)} employee={null} onSaved={(e) => navigate(employeePath(e.id))} />}
    </>
  )
}

const col = createColumnHelper<EmployeeRow>()

function buildColumns() {
  return [
    col.accessor('fullName', {
      header: 'Employee',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => {
        const e = row.original
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar name={e.fullName} size="sm" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-ink">{e.fullName}</span>
                <DocAlertBadge alert={e.docAlert} count={e.docAlertCount} />
              </span>
              <span className="block truncate text-xs text-muted">{e.email || (e.hasLogin ? '' : 'No login')}</span>
            </span>
          </span>
        )
      },
    }),
    col.accessor('employeeNo', { header: 'Employee no.', cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span> }),
    col.accessor('jobTitle', { header: 'Job title' }),
    col.accessor((r) => r.departmentName ?? '', { id: 'department', header: 'Department', cell: ({ getValue }) => getValue() || <span className="text-muted">—</span> }),
    col.accessor((r) => r.managerName ?? '', { id: 'manager', header: 'Manager', cell: ({ getValue }) => getValue() || <span className="text-muted">—</span> }),
    col.accessor((r) => countryLabel(r.nationality), { id: 'nationality', header: 'Nationality' }),
    col.accessor('hireDate', { header: 'Hire date', cell: ({ getValue }) => <span className="num">{fmtDate(getValue())}</span> }),
    col.accessor('status', { header: 'Status', cell: ({ getValue }) => <EmploymentStatusBadge status={getValue() as EmploymentStatus} /> }),
    col.accessor('employmentType', { header: 'Type', cell: ({ getValue }) => <Badge tone="neutral">{EMPLOYMENT_TYPE_LABEL[getValue()]}</Badge> }),
  ]
}

const employeeSearch: FilterFn<EmployeeRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const e = row.original
  return [e.fullName, e.employeeNo, e.jobTitle, e.email, e.departmentName ?? '', e.managerName ?? ''].join(' ').toLowerCase().includes(q)
}

const CSV_COLUMNS: CsvColumn<EmployeeExportRow>[] = [
  { header: 'Employee no.', value: (r) => r.employeeNo },
  { header: 'Name', value: (r) => r.fullName },
  { header: 'Job title', value: (r) => r.jobTitle },
  { header: 'Department', value: (r) => r.department },
  { header: 'Manager', value: (r) => r.manager },
  { header: 'Nationality', value: (r) => r.nationality },
  { header: 'Hire date', value: (r) => r.hireDate },
  { header: 'Status', value: (r) => r.status },
  { header: 'Type', value: (r) => r.employmentType },
  { header: 'Email', value: (r) => r.email },
  { header: 'Mobile', value: (r) => r.mobile },
  { header: 'Documents', value: (r) => r.documents },
]
