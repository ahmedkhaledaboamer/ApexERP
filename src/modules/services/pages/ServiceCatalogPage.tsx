import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { Briefcase, CircleDollarSign, LayoutTemplate, Layers, MoreHorizontal, Pencil, Plus, Power, PowerOff, ShieldOff, X } from 'lucide-react'
import { PATHS, servicePath } from '@/app/paths'
import { PRICING_TYPES, type PricingType, type ServiceRow } from '@/modules/services/types'
import { useServicesQuery } from '@/modules/services/hooks/useServices'
import { categoryMeta } from '@/modules/services/categoryMeta'
import { useLookups, type LookupsApi } from '@/shared/hooks/useLookups'
import { cn, fmtCompactMoney } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { Can } from '@/shared/components/permissions/Can'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'
import { ActiveBadge, CategoryIcon, deliveryText, Price, PricingBadge, PRICING_TONE, useServicesAccess } from '@/modules/services/components/ServiceBits'
import { ServiceDrawer } from '@/modules/services/components/ServiceDrawer'
import { useServiceActivation } from '@/modules/services/components/useServiceActivation'
import { DOT } from '@/shared/components/ui/Badge'
import { useReadOnly } from '@/shared/lib/readOnly'
import { useNewParam } from '@/shared/hooks/useNewParam'

type DrawerState = { service: ServiceRow | null } | null

/** Services > Service catalog: every service, active and inactive, with usage and template coverage. */
export default function ServiceCatalogPage() {
  const navigate = useNavigate()
  const lookups = useLookups()
  const readOnly = useReadOnly()
  const { canEdit } = useServicesAccess()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useServicesQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [drawer, setDrawer] = useState<DrawerState>(null)
  useNewParam(() => setDrawer({ service: null }), { when: canEdit })
  const activation = useServiceActivation()

  const columns = useMemo(
    () =>
      buildColumns({
        lookups,
        canEdit,
        pendingId: activation.pendingId,
        readOnly,
        onEdit: (service) => setDrawer({ service }),
        onSetActive: activation.setActive,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups, canEdit, activation.pendingId, readOnly],
  )
  const globalFilterFn = useMemo(() => serviceSearch(lookups), [lookups])

  const table = useDataTable({
    id: 'services-catalog',
    data,
    columns,
    globalFilter: search,
    globalFilterFn,
    defaultHidden: ['deliveryDays'],
    defaultSorting: [{ id: 'name', desc: false }],
    getRowId: (r) => r.id,
  })

  // Start on active services; the Active facet shows how to see the rest.
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

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Briefcase />
          </IconTile>
        }
        title="Service catalog"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{query.data ? `${data.length} services` : 'Loading…'}</span>
            <span aria-hidden>·</span>
            <span>Quotations, leads and packages are built from these.</span>
            {!canEdit && (
              <Badge tone="amber" icon={<ShieldOff />}>
                View only
              </Badge>
            )}
          </span>
        }
        actions={
          <Can module="services" action="edit">
            <Button write size="sm" onClick={() => setDrawer({ service: null })}>
              <Plus />
              New service
            </Button>
          </Can>
        }
      />
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} onWithoutTemplate={() => navigate(`${PATHS.serviceTemplates}?show=missing`)} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(servicePath(row.id))}
          minWidth={1120}
          toolbar={
            <>
              <SearchInput
                aria-label="Search services"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, description, industry…"
                className="w-full sm:w-64"
              />
              <Facets table={table} data={data} lookups={lookups} />
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
              icon={<Briefcase />}
              title={data.length === 0 ? 'No services yet' : 'No services match'}
              body={
                data.length === 0
                  ? 'Add the services you sell. Quotations and packages are built from the catalog.'
                  : 'Try another search, or clear the filters to include inactive services.'
              }
              action={
                data.length === 0 ? (
                  <Can module="services" action="edit">
                    <Button write size="sm" onClick={() => setDrawer({ service: null })}>
                      <Plus />
                      New service
                    </Button>
                  </Can>
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
      {canEdit && <ServiceDrawer open={!!drawer} onClose={() => setDrawer(null)} service={drawer?.service} openAfterCreate={!drawer?.service} />}
      {canEdit && activation.modal}
    </>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ rows, loading, onWithoutTemplate }: { rows: ServiceRow[] | undefined; loading: boolean; onWithoutTemplate: () => void }) {
  if (loading || !rows) {
    return (
      <section aria-label="Catalog figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const active = rows.filter((r) => r.active)
  const categories = new Set(active.map((r) => r.category))
  const avg = (t: PricingType) => {
    const list = active.filter((r) => r.pricingType === t)
    return list.length ? list.reduce((s, r) => s + r.price, 0) / list.length : null
  }
  const avgFixed = avg('Fixed')
  const avgMonthly = avg('Monthly')
  const avgHourly = avg('Hourly')
  const noTemplate = active.filter((r) => r.templateTasks === 0).length

  return (
    <section aria-label="Catalog figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active services" icon={<Briefcase />} value={active.length} hint={`${rows.length - active.length} inactive`} />
      <StatCard label="Categories" icon={<Layers />} value={categories.size} hint="In use by active services" />
      <StatCard
        label="Average project price"
        icon={<CircleDollarSign />}
        value={avgFixed === null ? '—' : fmtCompactMoney(avgFixed)}
        hint={[avgMonthly !== null && `${fmtCompactMoney(avgMonthly)} / month`, avgHourly !== null && `${fmtCompactMoney(avgHourly)} / hour`].filter(Boolean).join(' · ') || 'Fixed-price services'}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={onWithoutTemplate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onWithoutTemplate()
          }
        }}
        title="Open project templates"
        className="cursor-pointer rounded-card transition-shadow hover:shadow-soft focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
      >
        <StatCard
          label="Without a project template"
          icon={<LayoutTemplate />}
          value={noTemplate}
          alert={noTemplate > 0}
          hint={noTemplate ? 'Won deals can’t create their project yet' : 'Every active service is covered'}
        />
      </div>
    </section>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data, lookups }: { table: Table<ServiceRow>; data: ServiceRow[]; lookups: LookupsApi }) {
  const count = (fn: (r: ServiceRow) => boolean) => data.filter(fn).length
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
  // Categories and industries in use, plus every active lookup item.
  const categoryKeys = [...new Set([...lookups.serviceCategories.map((c) => c.key), ...data.map((r) => r.category)])]
  const industryKeys = [...new Set([...lookups.industries.map((i) => i.key), ...data.flatMap((r) => r.industries)])]
  return (
    <>
      {facet(
        'category',
        'Category',
        categoryKeys.map((k) => {
          const Icon = categoryMeta(k).icon
          return { value: k, label: lookups.serviceCategoryLabel(k), icon: <Icon className="text-muted" aria-hidden />, count: count((r) => r.category === k) }
        }),
      )}
      {facet(
        'industries',
        'Industry',
        industryKeys.map((k) => ({ value: k, label: lookups.industryLabel(k), count: count((r) => r.industries.includes(k)) })),
      )}
      {facet(
        'pricingType',
        'Pricing',
        PRICING_TYPES.map((t) => ({
          value: t,
          label: t,
          icon: <span className={cn('size-2 rounded-full', DOT[PRICING_TONE[t]])} aria-hidden />,
          count: count((r) => r.pricingType === t),
        })),
      )}
      {facet('active', 'Status', [
        { value: 'active', label: 'Active', icon: <span className={cn('size-2 rounded-full', DOT.green)} aria-hidden />, count: count((r) => r.active) },
        { value: 'inactive', label: 'Inactive', icon: <span className={cn('size-2 rounded-full', DOT.neutral)} aria-hidden />, count: count((r) => !r.active) },
      ])}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<ServiceRow> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))
const anyOf: FilterFn<ServiceRow> = (row, id, values: string[] | undefined) =>
  !values?.length || (row.getValue(id) as string[]).some((k) => values.includes(k))

const col = createColumnHelper<ServiceRow>()

interface ColumnDeps {
  lookups: LookupsApi
  canEdit: boolean
  pendingId: string | null
  readOnly: boolean
  onEdit: (s: ServiceRow) => void
  onSetActive: (s: ServiceRow, active: boolean) => void
}

function buildColumns({ lookups, canEdit, pendingId, readOnly, onEdit, onSetActive }: ColumnDeps) {
  const columns = [
    col.accessor('name', {
      header: 'Service',
      enableHiding: false,
      meta: { width: 320 },
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className={cn('flex min-w-0 items-center gap-3', !s.active && 'opacity-60')}>
            <CategoryIcon category={s.category} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{s.name}</p>
              <p className="truncate text-xs text-muted" title={s.description}>
                {s.description || <span className="font-mono">{s.id}</span>}
              </p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('category', {
      header: 'Category',
      filterFn: inSet,
      sortingFn: (a, b) => lookups.serviceCategoryLabel(a.original.category).localeCompare(lookups.serviceCategoryLabel(b.original.category)),
      cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{lookups.serviceCategoryLabel(getValue())}</span>,
    }),
    col.accessor('pricingType', {
      header: 'Pricing',
      filterFn: inSet,
      cell: ({ getValue }) => <PricingBadge type={getValue()} />,
    }),
    col.accessor('price', {
      header: 'Price',
      meta: { align: 'end' },
      cell: ({ row }) => <Price value={row.original.price} currency={row.original.currency} type={row.original.pricingType} />,
    }),
    col.accessor('deliveryDays', {
      header: 'Delivery',
      meta: { align: 'end' },
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-ink-2">{deliveryText(getValue())}</span>,
    }),
    col.accessor('industries', {
      header: 'Industries',
      filterFn: anyOf,
      enableSorting: false,
      meta: { width: 220 },
      cell: ({ getValue }) => <IndustryChips keys={getValue()} lookups={lookups} />,
    }),
    col.accessor((r) => r.usage.leadsRecommending + r.usage.quotations + r.usage.customers, {
      id: 'usage',
      header: () => <span title="Leads recommending it / quotations / customers">Leads / Quotes / Cust.</span>,
      meta: { label: 'Usage' },
      cell: ({ row }) => <UsageCounts row={row.original} />,
    }),
    col.accessor('templateTasks', {
      header: 'Template',
      meta: { align: 'end' },
      cell: ({ row }) =>
        row.original.templateTasks ? (
          <span className="num whitespace-nowrap text-ink-2">
            {row.original.templateTasks} tasks <span className="text-muted">· {row.original.templateHours} h</span>
          </span>
        ) : (
          <Badge tone="amber" variant="dot">
            None
          </Badge>
        ),
    }),
    col.accessor((r) => (r.active ? 'active' : 'inactive'), {
      id: 'active',
      header: 'Active',
      filterFn: inSet,
      meta: { label: 'Active', width: 84 },
      cell: ({ row }) =>
        canEdit ? (
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <Switch
              checked={row.original.active}
              disabled={readOnly || pendingId === row.original.id}
              onChange={(v) => onSetActive(row.original, v)}
              label={`${row.original.name} active`}
            />
          </span>
        ) : (
          <ActiveBadge active={row.original.active} />
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
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Menu
            className="w-48"
            trigger={(props) => (
              <Button write variant="ghost" size="xs" iconOnly aria-label={`Actions for ${row.original.name}`} {...props}>
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
                    onEdit(row.original)
                  }}
                >
                  Edit
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={row.original.active ? <PowerOff /> : <Power />}
                  danger={row.original.active}
                  onSelect={() => {
                    close()
                    onSetActive(row.original, !row.original.active)
                  }}
                >
                  {row.original.active ? 'Deactivate' : 'Reactivate'}
                </MenuItem>
              </>
            )}
          </Menu>
        </span>
      ),
    }),
  ]
}

function IndustryChips({ keys, lookups }: { keys: string[]; lookups: LookupsApi }) {
  if (!keys.length) return <span className="text-xs text-muted">Any industry</span>
  const shown = keys.slice(0, 2)
  const rest = keys.slice(2)
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((k) => (
        <Badge key={k} variant="outline" className="min-w-0">
          {lookups.industryLabel(k)}
        </Badge>
      ))}
      {rest.length > 0 && (
        <span className="num shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted" title={rest.map((k) => lookups.industryLabel(k)).join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  )
}

function UsageCounts({ row }: { row: ServiceRow }) {
  const items: [number, string][] = [
    [row.usage.leadsRecommending, 'leads recommending it'],
    [row.usage.quotations, 'quotations'],
    [row.usage.customers, 'customers'],
  ]
  return (
    <span className="num flex items-center gap-1 whitespace-nowrap text-xs" aria-label={items.map(([n, l]) => `${n} ${l}`).join(', ')}>
      {items.map(([n, l], i) => (
        <span key={l} className="flex items-center gap-1" title={`${n} ${l}`}>
          {i > 0 && <span className="text-subtle">/</span>}
          <span className={n ? 'font-medium text-ink' : 'text-subtle'}>{n}</span>
        </span>
      ))}
    </span>
  )
}

function serviceSearch(lookups: LookupsApi): FilterFn<ServiceRow> {
  return (row, _columnId, value: string) => {
    const q = value.trim().toLowerCase()
    if (!q) return true
    const s = row.original
    return [s.name, s.id, s.description, lookups.serviceCategoryLabel(s.category), s.pricingType, ...s.industries.map((k) => lookups.industryLabel(k))]
      .join(' ')
      .toLowerCase()
      .includes(q)
  }
}
