import { useMemo, useState } from 'react'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { addMonths, addYears, format, max as maxDate, parseISO } from 'date-fns'
import { Ban, BellRing, CircleDollarSign, FileSignature, MoreHorizontal, Pencil, Plus, Repeat, RotateCcw, ShieldOff, TimerOff, X } from 'lucide-react'
import type { Scope } from '@/shared/types'
import { customerPath } from '@/app/paths'
import { useContractsQuery, useUpdateContract } from '@/modules/crm/hooks/useCrm'
import type { ContractRow } from '@/modules/crm/types'
import { BILLINGS, BILLING_SUFFIX, CONTRACT_STATUSES, CONTRACT_STATUS_TONE } from '@/modules/crm/constants'
import { ContractStatusBadge, RenewsIn } from '@/modules/crm/components/CrmBadges'
import { ContractDrawer } from '@/modules/crm/components/ContractDrawer'
import { useCurrentUser } from '@/store/hooks'
import { can, SCOPE_LABELS, scopeOf } from '@/shared/lib/permissions'
import { cn, fmtCompactMoney, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

export default function ContractsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Contracts aren’t part of your role" body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`} />
      </PageBody>
    )
  }
  return <ContractsList scope={scope} canEdit={can(user.role, 'sales', 'edit')} />
}

type DrawerState = { contract: ContractRow | null } | null

function ContractsList({ scope, canEdit }: { scope: Scope; canEdit: boolean }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useContractsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [drawer, setDrawer] = useState<DrawerState>(null)
  const columns = useMemo(() => buildColumns(canEdit, (contract) => setDrawer({ contract })), [canEdit])

  const table = useDataTable({
    id: 'crm-contracts',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: contractSearch,
    defaultHidden: ['ownerName', 'startDate'],
    defaultSorting: [{ id: 'daysToRenewal', desc: false }],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search

  function showRenewals() {
    table.getColumn('status')?.setFilterValue(['Expiring'])
  }

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <FileSignature />
          </IconTile>
        }
        title="Contracts"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{query.data ? `${data.length} contracts` : 'Loading…'}</span>
            <span aria-hidden>·</span>
            <span>{SCOPE_LABELS[scope]}</span>
            {scope === 'view' && (
              <Badge tone="amber" icon={<ShieldOff />}>
                Read only
              </Badge>
            )}
          </span>
        }
        actions={
          canEdit && (
            <Button write size="sm" onClick={() => setDrawer({ contract: null })}>
              <Plus />
              New contract
            </Button>
          )
        }
      />
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} onRenewals={showRenewals} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(customerPath(row.customerId))}
          minWidth={1040}
          toolbar={
            <>
              <SearchInput
                aria-label="Search contracts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, customer, service…"
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
              title={data.length === 0 ? 'No contracts yet' : 'No contracts match'}
              body={data.length === 0 ? 'Record what customers signed to track renewals and recurring revenue.' : 'Try another search or clear the filters.'}
              action={
                data.length === 0 && canEdit ? (
                  <Button write size="sm" onClick={() => setDrawer({ contract: null })}>
                    <Plus />
                    New contract
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
      {canEdit && <ContractDrawer open={!!drawer} onClose={() => setDrawer(null)} contract={drawer?.contract} />}
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading, onRenewals }: { rows: ContractRow[] | undefined; loading: boolean; onRenewals: () => void }) {
  const { rules } = useAutomationRules()
  if (loading || !rows) {
    return (
      <section aria-label="Contract figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const live = rows.filter((r) => r.status === 'Active' || r.status === 'Expiring')
  const activeValue = live.reduce((s, r) => s + r.annualValue, 0)
  const mrr = rows.reduce((s, r) => s + r.mrr, 0)
  const renewing = rows.filter((r) => r.status === 'Expiring')
  const renewingValue = renewing.reduce((s, r) => s + r.annualValue, 0)
  const expired = rows.filter((r) => r.status === 'Expired').length

  return (
    <section aria-label="Contract figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active contract value" icon={<CircleDollarSign />} value={fmtCompactMoney(activeValue)} hint={`${live.length} live contracts, per year`} />
      <StatCard label="Monthly recurring" icon={<Repeat />} value={fmtCompactMoney(mrr)} hint={`${fmtCompactMoney(mrr * 12)} a year from retainers`} />
      <div
        role="button"
        tabIndex={0}
        onClick={onRenewals}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onRenewals()
          }
        }}
        title={`Show contracts renewing in ${rules.renewalAlertDays} days`}
        className="cursor-pointer rounded-card transition-shadow hover:shadow-soft focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
      >
        <StatCard
          label={`Renewals in ${rules.renewalAlertDays} days`}
          icon={<BellRing />}
          value={renewing.length}
          alert={renewing.length > 0}
          hint={renewing.length ? `${fmtCompactMoney(renewingValue)} a year at stake` : 'Nothing due soon'}
        />
      </div>
      <StatCard label="Expired" icon={<TimerOff />} value={expired} hint={expired ? 'Past renewal date, not renewed' : 'None lapsed'} />
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<ContractRow>; data: ContractRow[] }) {
  const count = (fn: (r: ContractRow) => boolean) => data.filter(fn).length
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
        CONTRACT_STATUSES.map((s) => ({
          value: s,
          label: s,
          icon: <span className={`size-2 rounded-full ${DOT[CONTRACT_STATUS_TONE[s]]}`} aria-hidden />,
          count: count((r) => r.status === s),
        })),
      )}
      {facet('billing', 'Billing', BILLINGS.map((b) => ({ value: b, label: b, count: count((r) => r.billing === b) })))}
      {facet(
        'ownerName',
        'Owner',
        owners.map((o) => ({ value: o, label: o, icon: <Avatar name={o} size="xs" />, count: count((r) => r.ownerName === o) })),
      )}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<ContractRow> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<ContractRow>()

function buildColumns(canEdit: boolean, onEdit: (c: ContractRow) => void) {
  const columns = [
    col.accessor('title', {
      header: 'Contract',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => (
        <div className={cn('min-w-0', row.original.status === 'Cancelled' && 'opacity-70')}>
          <p className="truncate font-medium text-ink">{row.original.title}</p>
          <p className="truncate text-xs text-muted" title={row.original.serviceNames.join(', ')}>
            <span className="font-mono">{row.original.id}</span> · {row.original.serviceNames.join(', ')}
          </p>
        </div>
      ),
    }),
    col.accessor('customerName', {
      header: 'Customer',
      cell: ({ row }) => (
        <Link
          to={customerPath(row.original.customerId)}
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 items-center gap-2 text-ink-2 hover:text-ink hover:underline"
        >
          <Avatar name={row.original.customerName} size="xs" square />
          <span className="truncate">{row.original.customerName}</span>
        </Link>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => CONTRACT_STATUSES.indexOf(a.original.status) - CONTRACT_STATUSES.indexOf(b.original.status),
      cell: ({ getValue }) => <ContractStatusBadge status={getValue()} />,
    }),
    col.accessor('billing', {
      header: 'Billing',
      filterFn: inSet,
      cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue()}</span>,
    }),
    col.accessor('value', {
      header: 'Value',
      meta: { align: 'end' },
      sortingFn: (a, b) => a.original.annualValue - b.original.annualValue,
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-ink">
          {fmtMoney(row.original.value)}
          <span className="text-muted">{BILLING_SUFFIX[row.original.billing]}</span>
        </span>
      ),
    }),
    col.accessor('daysToRenewal', {
      header: 'Renews in',
      cell: ({ row }) => {
        const k = row.original
        const soon = k.status === 'Expiring'
        return (
          <span
            className={cn(
              'inline-flex flex-col rounded-md px-2 py-0.5 leading-tight',
              soon && 'bg-warning-50 ring-1 ring-warning-100 ring-inset dark:bg-warning-500/10 dark:ring-warning-500/20',
            )}
          >
            <RenewsIn days={k.daysToRenewal} cancelled={k.status === 'Cancelled'} className="text-[0.8125rem]" />
            <span className="num text-xs text-muted">{fmtDate(k.renewalDate)}</span>
          </span>
        )
      },
    }),
    col.accessor('startDate', {
      header: 'Start date',
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span>,
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
  ]
  if (!canEdit) return columns
  return [
    ...columns,
    col.display({
      id: 'actions',
      enableHiding: false,
      meta: { width: 48, align: 'end' },
      cell: ({ row }) => <RowActions contract={row.original} onEdit={() => onEdit(row.original)} />,
    }),
  ]
}

/** Next term's renewal date, counted from the current one (or today if it has lapsed). */
function nextTerm(k: ContractRow): string {
  const from = maxDate([parseISO(k.renewalDate), new Date()])
  return format(k.billing === 'Monthly' ? addMonths(from, 1) : addYears(from, 1), 'yyyy-MM-dd')
}

function RowActions({ contract: k, onEdit }: { contract: ContractRow; onEdit: () => void }) {
  const update = useUpdateContract()
  const toast = useToast()
  const cancelled = k.status === 'Cancelled'

  function patch(input: Parameters<typeof update.mutate>[0]['input'], done: string) {
    update.mutate(
      { id: k.id, input },
      {
        onSuccess: () => toast.success(done, k.title),
        onError: (e) => toast.error('Contract not updated', e.message),
      },
    )
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Menu
        className="w-52"
        trigger={(props) => (
          <Button write variant="ghost" size="xs" iconOnly aria-label={`Actions for ${k.title}`} loading={update.isPending} {...props}>
            {!update.isPending && <MoreHorizontal />}
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<Pencil />}
              onSelect={() => {
                close()
                onEdit()
              }}
            >
              Edit
            </MenuItem>
            {!cancelled && (
              <MenuItem
                icon={<Repeat />}
                hint={k.billing === 'Monthly' ? '+1 mo' : '+1 yr'}
                onSelect={() => {
                  close()
                  const next = nextTerm(k)
                  patch({ renewalDate: next }, `Renewed to ${fmtDate(next)}`)
                }}
              >
                Renew for a term
              </MenuItem>
            )}
            <MenuSeparator />
            {cancelled ? (
              <MenuItem
                icon={<RotateCcw />}
                onSelect={() => {
                  close()
                  patch({ status: 'Active' }, 'Contract reinstated')
                }}
              >
                Reinstate
              </MenuItem>
            ) : (
              <MenuItem
                danger
                icon={<Ban />}
                onSelect={() => {
                  close()
                  patch({ status: 'Cancelled' }, 'Contract cancelled')
                }}
              >
                Cancel contract
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </span>
  )
}

const contractSearch: FilterFn<ContractRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const k = row.original
  return [k.title, k.id, k.customerName, k.ownerName, k.billing, ...k.serviceNames].join(' ').toLowerCase().includes(q)
}
