import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { BellRing, Building2, CircleDollarSign, Crown, Globe, ShieldOff, X } from 'lucide-react'
import type { Scope } from '@/shared/types'
import { customerPath, PATHS } from '@/app/paths'
import { useCustomersQuery } from '@/modules/crm/hooks/useCrm'
import type { CustomerRow } from '@/modules/crm/types'
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_TONE } from '@/modules/crm/constants'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { useLookups } from '@/shared/hooks/useLookups'
import type { LookupsApi } from '@/shared/hooks/useLookups'
import { CustomerStatusBadge, RenewsIn } from '@/modules/crm/components/CrmBadges'
import { useCurrentUser } from '@/store/hooks'
import { SCOPE_LABELS, scopeOf } from '@/shared/lib/permissions'
import { fmtCompactMoney, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

export default function CustomersPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Customers aren’t part of your role" body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`} />
      </PageBody>
    )
  }
  return <CustomersList scope={scope} />
}

function CustomersList({ scope }: { scope: Scope }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useCustomersQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const lookups = useLookups()
  const columns = useMemo(() => buildColumns(lookups), [lookups])

  const table = useDataTable({
    id: 'crm-customers',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: customerSearch,
    defaultHidden: ['emirate', 'createdAt'],
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
        icon={
          <IconTile>
            <Building2 />
          </IconTile>
        }
        title="Customers"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{query.data ? `${query.data.length} customers` : 'Loading…'}</span>
            <span aria-hidden>·</span>
            <span>{SCOPE_LABELS[scope]}</span>
            {scope === 'view' && (
              <Badge tone="amber" icon={<ShieldOff />}>
                Read only
              </Badge>
            )}
          </span>
        }
      />
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(customerPath(row.id))}
          toolbar={
            <>
              <SearchInput
                aria-label="Search customers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, industry, website…"
                className="w-full sm:w-64"
              />
              <Facets table={table} data={data} lookups={lookups} />
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
              title={data.length === 0 ? 'No customers yet' : 'No customers match'}
              body={
                data.length === 0
                  ? 'When a lead is marked Won it moves here automatically, with its contacts and history.'
                  : 'Try another search or clear the filters.'
              }
            />
          }
        />
      </PageBody>
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading }: { rows: CustomerRow[] | undefined; loading: boolean }) {
  const { rules } = useAutomationRules()
  if (loading || !rows) {
    return (
      <section aria-label="Customer figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const vip = rows.filter((r) => r.status === 'VIP').length
  const value = rows.reduce((s, r) => s + r.activeContractValue, 0)
  const contracts = rows.reduce((s, r) => s + r.activeContracts, 0)
  const renewing = rows.filter((r) => r.daysToRenewal !== null && r.daysToRenewal <= rules.renewalAlertDays).length
  const paused = rows.filter((r) => r.status === 'Paused').length

  return (
    <section aria-label="Customer figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Customers" icon={<Building2 />} value={rows.length} hint={paused ? `${paused} paused` : 'All active or VIP'} />
      <StatCard label="VIP accounts" icon={<Crown />} value={vip} hint={rows.length ? `${Math.round((vip / rows.length) * 100)}% of customers` : '—'} />
      <StatCard
        label="Active contract value"
        icon={<CircleDollarSign />}
        value={fmtCompactMoney(value)}
        hint={`${contracts} live contract${contracts === 1 ? '' : 's'}, per year`}
        to={PATHS.contracts}
      />
      <StatCard
        label={`Renewals in ${rules.renewalAlertDays} days`}
        icon={<BellRing />}
        value={renewing}
        alert={renewing > 0}
        hint={renewing ? 'Customers to call about renewal' : 'Nothing due soon'}
        to={PATHS.contracts}
      />
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data, lookups }: { table: Table<CustomerRow>; data: CustomerRow[]; lookups: LookupsApi }) {
  const count = (fn: (r: CustomerRow) => boolean) => data.filter(fn).length
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
  const industries = [...new Set(data.map((r) => r.industry))].sort()

  return (
    <>
      {facet(
        'status',
        'Status',
        CUSTOMER_STATUSES.map((s) => ({
          value: s,
          label: s,
          icon: <span className={`size-2 rounded-full ${DOT[CUSTOMER_STATUS_TONE[s]]}`} aria-hidden />,
          count: count((r) => r.status === s),
        })),
      )}
      {facet(
        'ownerName',
        'Owner',
        owners.map((o) => ({ value: o, label: o, icon: <Avatar name={o} size="xs" />, count: count((r) => r.ownerName === o) })),
      )}
      {facet('industry', 'Industry', industries.map((i) => ({ value: i, label: lookups.industryLabel(i), count: count((r) => r.industry === i) })))}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<CustomerRow> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<CustomerRow>()

function buildColumns(lookups: LookupsApi) {
  return [
    col.accessor('name', {
      header: 'Customer',
      enableHiding: false,
      meta: { width: 300 },
      cell: ({ row }) => {
        const c = row.original
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={c.name} size="sm" square />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{c.name}</p>
              <p className="flex items-center gap-1 truncate text-xs text-muted">
                {c.website ? (
                  <>
                    <Globe className="size-3 shrink-0" aria-hidden />
                    {c.website.replace(/^https?:\/\//, '')}
                  </>
                ) : (
                  <span className="font-mono">{c.id}</span>
                )}
              </p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => CUSTOMER_STATUSES.indexOf(a.original.status) - CUSTOMER_STATUSES.indexOf(b.original.status),
      cell: ({ getValue }) => <CustomerStatusBadge status={getValue()} />,
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
    col.accessor('industry', {
      header: 'Industry',
      filterFn: inSet,
      cell: ({ getValue }) => <Badge>{lookups.industryLabel(getValue())}</Badge>,
    }),
    col.accessor('emirate', {
      header: 'Emirate / region',
      cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() || '—'}</span>,
    }),
    col.accessor('contactsCount', {
      header: 'Contacts',
      meta: { align: 'end' },
      cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span>,
    }),
    col.accessor('activeContractValue', {
      header: 'Active contracts',
      meta: { align: 'end', label: 'Active contract value' },
      cell: ({ row }) =>
        row.original.activeContracts ? (
          <span className="num whitespace-nowrap text-ink">
            {fmtMoney(row.original.activeContractValue)}
            <span className="ms-1 text-xs text-muted">· {row.original.activeContracts}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('daysToRenewal', {
      header: 'Next renewal',
      sortUndefined: 'last',
      sortingFn: (a, b) => (a.original.daysToRenewal ?? 1e9) - (b.original.daysToRenewal ?? 1e9),
      cell: ({ row }) =>
        row.original.nextRenewal ? (
          <span className="flex flex-col leading-tight">
            <RenewsIn days={row.original.daysToRenewal} className="text-[0.8125rem]" />
            <span className="num text-xs text-muted">{fmtDate(row.original.nextRenewal)}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('createdAt', {
      header: 'Customer since',
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span>,
    }),
  ]
}

const customerSearch: FilterFn<CustomerRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const c = row.original
  return [c.name, c.id, c.industry, c.subIndustry, c.website, c.emirate, c.address, c.ownerName].join(' ').toLowerCase().includes(q)
}
