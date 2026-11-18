import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { CalendarClock, CheckCircle2, ExternalLink, FileText, MoreHorizontal, Percent, Plus, Trophy, Wallet, X } from 'lucide-react'
import type { Quotation } from '@/modules/quotations/types'
import { newQuotationPath, quotationPath } from '@/app/paths'
import { useQuotationsQuery } from '@/modules/quotations/hooks/useQuotations'
import { AWAITING_STATUSES, daysUntil, OPEN_STATUSES, QUOTATION_STATUSES } from '@/modules/quotations/lib/totals'
import { QUOTATION_STATUS_LABEL, QUOTATION_STATUS_TONE, QuotationStatusBadge } from '@/modules/quotations/components/QuotationStatusBadge'
import { ValidUntil } from '@/modules/quotations/components/ValidUntil'
import { can, scopeOf, SCOPE_LABELS } from '@/shared/lib/permissions'
import { fmtCompactMoney, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { useOpenWonDialog } from '@/modules/won/hooks'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'
import { useReadOnly } from '@/shared/lib/readOnly'

export default function QuotationsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState
          title="Quotations aren’t part of your role"
          body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`}
        />
      </PageBody>
    )
  }
  return (
    <QuotationsList scopeLabel={SCOPE_LABELS[scope]} canCreate={can(user.role, 'sales', 'create')} canEdit={can(user.role, 'sales', 'edit')} />
  )
}

function QuotationsList({ scopeLabel, canCreate, canEdit }: { scopeLabel: string; canCreate: boolean; canEdit: boolean }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useQuotationsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const openWon = useOpenWonDialog()
  const columns = useMemo(
    () => buildColumns(canEdit ? { onOpen: (q) => navigate(quotationPath(q.id)), onWin: (q) => openWon(q.leadId, q.id) } : null),
    [canEdit, navigate, openWon],
  )

  const table = useDataTable({
    id: 'quotations',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: quotationSearch,
    defaultSorting: [{ id: 'number', desc: true }],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <>
      <PageHeader
        title="Quotations"
        description={
          <span className="flex flex-wrap items-center gap-2">
            Proposals built from the service catalog and sent from the system.
            <Badge variant="outline">{scopeLabel}</Badge>
          </span>
        }
        actions={
          canCreate && (
            <Button write onClick={() => navigate(newQuotationPath())}>
              <Plus />
              New quotation
            </Button>
          )
        }
      />
      <PageBody className="space-y-6">
        <Kpis data={data} loading={query.isPending} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(quotationPath(row.id))}
          toolbar={
            <>
              <SearchInput
                aria-label="Search quotations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number, company, title…"
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
              icon={<FileText aria-hidden />}
              title={data.length === 0 ? 'No quotations yet' : 'No quotations match'}
              body={
                data.length === 0
                  ? 'Build a quotation from the service catalog for a lead in Meeting or Proposal.'
                  : 'Try another search or clear the filters.'
              }
              action={
                data.length === 0 && canCreate ? (
                  <Button write size="sm" onClick={() => navigate(newQuotationPath())}>
                    <Plus />
                    New quotation
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ data, loading }: { data: Quotation[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </div>
    )
  }
  const now = new Date()
  const thisMonth = (iso: string | null) => {
    if (!iso) return false
    const d = new Date(iso)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }
  const sum = (list: Quotation[]) => list.reduce((s, q) => s + q.totals.total, 0)

  const open = data.filter((q) => OPEN_STATUSES.includes(q.status))
  const accepted = data.filter((q) => q.status === 'accepted')
  const acceptedMonth = accepted.filter((q) => thisMonth(q.decidedAt))
  const decided = data.filter((q) => q.status === 'accepted' || q.status === 'rejected' || q.status === 'expired')
  const rate = decided.length ? (accepted.length / decided.length) * 100 : 0
  const expiring = data.filter((q) => AWAITING_STATUSES.includes(q.status) && daysUntil(q.validUntil) <= 7)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Open value"
        value={fmtCompactMoney(sum(open))}
        hint={`${open.length} draft, sent or viewed`}
        icon={<Wallet aria-hidden />}
      />
      <StatCard
        label="Accepted this month"
        value={fmtCompactMoney(sum(acceptedMonth))}
        hint={`${acceptedMonth.length} ${acceptedMonth.length === 1 ? 'quotation' : 'quotations'}`}
        icon={<CheckCircle2 aria-hidden />}
      />
      <StatCard
        label="Acceptance rate"
        value={decided.length ? `${rate.toFixed(0)}%` : '—'}
        hint={decided.length ? `${accepted.length} of ${decided.length} decided` : 'No answers yet'}
        icon={<Percent aria-hidden />}
        progress={decided.length ? rate : undefined}
      />
      <StatCard
        label="Expiring in 7 days"
        value={expiring.length}
        hint={expiring.length ? `${fmtMoney(sum(expiring))} awaiting an answer` : 'Nothing about to lapse'}
        alert={expiring.length > 0}
        icon={<CalendarClock aria-hidden />}
      />
    </div>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<Quotation>; data: Quotation[] }) {
  const count = (fn: (q: Quotation) => boolean) => data.filter(fn).length
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
  const owners = [...new Set(data.map((q) => q.ownerName))].sort()

  return (
    <>
      {facet(
        'status',
        'Status',
        QUOTATION_STATUSES.map((s) => ({
          value: s,
          label: QUOTATION_STATUS_LABEL[s],
          icon: <span className={`size-2 rounded-full ${DOT[QUOTATION_STATUS_TONE[s]]}`} aria-hidden />,
          count: count((q) => q.status === s),
        })),
      )}
      {facet(
        'ownerName',
        'Owner',
        owners.map((o) => ({ value: o, label: o, icon: <Avatar name={o} size="xs" />, count: count((q) => q.ownerName === o) })),
      )}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<Quotation> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<Quotation>()

interface RowHandlers {
  onOpen: (q: Quotation) => void
  onWin: (q: Quotation) => void
}

function buildColumns(handlers: RowHandlers | null) {
  const columns = [
    col.accessor('number', {
      header: 'Number',
      enableHiding: false,
      meta: { width: 140 },
      cell: ({ getValue }) => <span className="font-mono text-xs whitespace-nowrap text-ink-2">{getValue()}</span>,
    }),
    col.accessor('company', {
      header: 'Company',
      enableHiding: false,
      meta: { width: 320 },
      cell: ({ row }) => {
        const q = row.original
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={q.company} size="sm" square />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{q.company}</p>
              <p className="truncate text-xs text-muted">{q.title}</p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => QUOTATION_STATUSES.indexOf(a.original.status) - QUOTATION_STATUSES.indexOf(b.original.status),
      cell: ({ getValue }) => <QuotationStatusBadge status={getValue()} />,
    }),
    col.accessor((q) => q.totals.total, {
      id: 'total',
      header: 'Total',
      meta: { align: 'end', label: 'Total' },
      cell: ({ getValue }) => <span className="num font-medium whitespace-nowrap text-ink">{fmtMoney(getValue())}</span>,
    }),
    col.accessor('validUntil', {
      header: 'Valid until',
      cell: ({ row }) => <ValidUntil date={row.original.validUntil} status={row.original.status} />,
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          <Avatar name={getValue()} size="xs" />
          {getValue()}
        </span>
      ),
    }),
    col.accessor('createdAt', {
      header: 'Created',
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span>,
    }),
  ]
  if (!handlers) return columns
  return [
    ...columns,
    col.display({
      id: 'actions',
      enableHiding: false,
      meta: { width: 48, align: 'end' },
      cell: ({ row }) => <RowActions quotation={row.original} {...handlers} />,
    }),
  ]
}

/** Row menu: open, and "Win deal" on an accepted quotation whose lead isn't a customer yet. */
function RowActions({ quotation: q, onOpen, onWin }: { quotation: Quotation } & RowHandlers) {
  const readOnly = useReadOnly()
  const canWin = !readOnly && q.status === 'accepted' && !q.customerId
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Menu
        className="w-48"
        trigger={(props) => (
          <Button variant="ghost" size="xs" iconOnly aria-label={`Actions for ${q.number}`} {...props}>
            <MoreHorizontal />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<ExternalLink />}
              onSelect={() => {
                close()
                onOpen(q)
              }}
            >
              Open
            </MenuItem>
            {canWin && (
              <MenuItem
                icon={<Trophy />}
                onSelect={() => {
                  close()
                  onWin(q)
                }}
              >
                Win deal
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </span>
  )
}

const quotationSearch: FilterFn<Quotation> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const r = row.original
  return [r.number, r.company, r.title, r.contactName, r.contactEmail, r.ownerName].join(' ').toLowerCase().includes(q)
}
