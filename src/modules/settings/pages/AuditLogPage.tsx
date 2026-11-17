import { useMemo, useState } from 'react'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { format, formatDistanceToNowStrict, subDays } from 'date-fns'
import { Download, History, X } from 'lucide-react'
import type { AuditEntry } from '@/modules/settings/types'
import type { AuditFilter } from '@/modules/settings/api/settingsApi'
import { useAuditLogQuery } from '@/modules/settings/hooks/useAuditLog'
import { AuditEntryDrawer } from '@/modules/settings/audit/AuditEntryDrawer'
import { downloadAuditExcel } from '@/modules/settings/audit/exportAudit'
import {
  ACTIONS,
  ACTION_LABEL,
  ACTION_TONE,
  entityLabel,
  entityType,
  entityTypeLabel,
  fieldLabel,
} from '@/modules/settings/audit/auditLabels'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput } from '@/shared/components/form/Field'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

type Range = '7d' | '30d' | '90d' | 'all' | 'custom'

const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

function rangeFilter(range: Range, from: string, to: string): AuditFilter {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0
  if (days) return { from: ymd(subDays(new Date(), days - 1)) }
  if (range === 'custom') return { ...(from && { from }), ...(to && { to }) }
  return {}
}

/** Who changed what, and when. Read-only for everyone who can open Settings. */
export default function AuditLogPage() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [exporting, setExporting] = useState(false)

  const filter = useMemo(() => rangeFilter(range, from, to), [range, from, to])
  const query = useAuditLogQuery(filter)
  const data = useMemo(() => query.data ?? [], [query.data])
  const columns = useMemo(() => buildColumns(), [])

  const table = useDataTable({
    id: 'settings-audit',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: auditSearch,
    defaultSorting: [{ id: 'at', desc: true }],
    getRowId: (r) => r.id,
  })

  const filtered = table.getState().columnFilters.length > 0 || !!search
  const rangeInvalid = range === 'custom' && !!from && !!to && from > to

  async function exportExcel() {
    const rows = table.getPrePaginationRowModel().rows.map((r) => r.original)
    if (!rows.length) return
    setExporting(true)
    try {
      const label = RANGES.find((r) => r.value === range)?.label ?? ''
      const span = range === 'custom' ? `${from ? fmtDate(from) : 'start'} – ${to ? fmtDate(to) : 'today'}` : label
      await downloadAuditExcel(rows, `${span} · ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · exported ${fmtDate(new Date().toISOString(), 'd MMM yyyy, HH:mm')}`)
      toast.success('Audit log exported', `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`)
    } catch (e) {
      toast.error('Export failed', e instanceof Error ? e.message : undefined)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Audit log</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            Every edit or deletion of sensitive data: who did what, and when. Entries can’t be changed or removed.
          </p>
        </div>
        <Button variant="secondary" loading={exporting} disabled={!query.data || table.getPrePaginationRowModel().rows.length === 0} onClick={exportExcel}>
          {!exporting && <Download />}
          Export to Excel
        </Button>
      </div>

      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={setSelected}
        minWidth={900}
        toolbar={
          <>
            <SearchInput
              aria-label="Search the audit log"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search summary, record, field…"
              className="w-full sm:w-60"
            />
            <label className="sr-only" htmlFor="audit-range">
              Date range
            </label>
            <select
              id="audit-range"
              value={range}
              onChange={(e) => setRange(e.target.value as Range)}
              className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem] text-ink shadow-xs focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
            >
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {range === 'custom' && (
              <span className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="From date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem] text-ink shadow-xs aria-invalid:border-danger-500"
                  aria-invalid={rangeInvalid || undefined}
                />
                <span className="text-xs text-muted">to</span>
                <input
                  type="date"
                  aria-label="To date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[0.8125rem] text-ink shadow-xs aria-invalid:border-danger-500"
                  aria-invalid={rangeInvalid || undefined}
                />
              </span>
            )}
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
            icon={<History aria-hidden />}
            title={rangeInvalid ? 'Check the dates' : data.length === 0 ? 'Nothing recorded in this period' : 'No entries match'}
            body={
              rangeInvalid
                ? 'The start date is after the end date.'
                : data.length === 0
                  ? 'Changes to users, settings and security show up here as they happen. Try a longer date range.'
                  : 'Try another search or clear the filters.'
            }
            action={
              !rangeInvalid && data.length === 0 && range !== 'all' ? (
                <Button variant="secondary" size="sm" onClick={() => setRange('all')}>
                  Show all time
                </Button>
              ) : undefined
            }
          />
        }
      />

      <AuditEntryDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<AuditEntry>; data: AuditEntry[] }) {
  const count = (fn: (r: AuditEntry) => boolean) => data.filter(fn).length
  const facet = (id: string, title: string, options: FacetOption[]) => {
    const column = table.getColumn(id)
    if (!column || options.length === 0) return null
    return (
      <FacetFilter
        title={title}
        options={options}
        selected={(column.getFilterValue() as string[] | undefined) ?? []}
        onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
      />
    )
  }
  const types = [...new Set(data.map((e) => entityType(e.entity)))].sort((a, b) => entityTypeLabel(a).localeCompare(entityTypeLabel(b)))
  const users = [...new Set(data.map((e) => e.userName))].sort()

  return (
    <>
      {facet(
        'entityType',
        'Entity',
        types.map((t) => ({ value: t, label: entityTypeLabel(t), count: count((e) => entityType(e.entity) === t) })),
      )}
      {facet('userName', 'User', users.map((u) => ({ value: u, label: u, icon: <Avatar name={u} size="xs" />, count: count((e) => e.userName === u) })))}
      {facet(
        'action',
        'Action',
        ACTIONS.filter((a) => data.some((e) => e.action === a)).map((a) => ({
          value: a,
          label: ACTION_LABEL[a],
          icon: <span className={`size-2 rounded-full ${DOT[ACTION_TONE[a]]}`} aria-hidden />,
          count: count((e) => e.action === a),
        })),
      )}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<AuditEntry> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<AuditEntry>()

function buildColumns() {
  return [
    col.accessor('at', {
      header: 'Time',
      enableHiding: false,
      meta: { width: 170 },
      cell: ({ getValue }) => (
        <span className="flex flex-col leading-tight">
          <span className="num whitespace-nowrap text-ink">{fmtDate(getValue(), 'd MMM yyyy, HH:mm')}</span>
          <span className="text-xs whitespace-nowrap text-muted">{formatDistanceToNowStrict(new Date(getValue()), { addSuffix: true })}</span>
        </span>
      ),
    }),
    col.accessor('userName', {
      header: 'User',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          <Avatar name={getValue()} size="xs" />
          {getValue()}
        </span>
      ),
    }),
    col.accessor('action', {
      header: 'Action',
      filterFn: inSet,
      cell: ({ getValue }) => <Badge tone={ACTION_TONE[getValue()]}>{ACTION_LABEL[getValue()] ?? getValue()}</Badge>,
    }),
    col.accessor((r) => entityType(r.entity), {
      id: 'entityType',
      header: 'Entity',
      filterFn: inSet,
      cell: ({ row }) => (
        <span className="flex flex-col leading-tight">
          <span className="whitespace-nowrap text-ink-2">{entityLabel(row.original.entity)}</span>
          <span className="font-mono text-xs text-muted">{row.original.entityId}</span>
        </span>
      ),
    }),
    col.accessor('summary', {
      header: 'Summary',
      enableSorting: false,
      meta: { cellClassName: 'max-w-[28rem]' },
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ink">{row.original.summary}</span>
          {row.original.changes.length > 0 && (
            <span className="num shrink-0 rounded bg-sunken px-1 text-[0.6875rem] text-muted" title="Field changes">
              {row.original.changes.length} field{row.original.changes.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
      ),
    }),
  ]
}

const auditSearch: FilterFn<AuditEntry> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const e = row.original
  return [
    e.summary,
    e.userName,
    e.entityId,
    entityLabel(e.entity),
    ACTION_LABEL[e.action],
    ...e.changes.flatMap((c) => [fieldLabel(c.field), c.from, c.to]),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q)
}
