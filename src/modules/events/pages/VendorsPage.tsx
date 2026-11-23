import { useMemo, useState } from 'react'
import { displayMobile } from '@/shared/lib/phone'
import { Link, useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { Plus, Store, X } from 'lucide-react'
import type { Vendor } from '@/modules/events/libraryTypes'
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, VENDOR_STATUSES, VENDOR_STATUS_LABEL } from '@/modules/events/libraryTypes'
import { useLibraryAccess, useVendorsQuery } from '@/modules/events/hooks/useEventLibrary'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, VendorStatusBadge } from '@/modules/events/components/library/LibraryBits'
import { VendorDrawer } from '@/modules/events/components/library/VendorDrawer'
import { PATHS, vendorPath } from '@/app/paths'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

/** `/events/vendors`: event suppliers with spend (from budget lines), ratings and status. Marketing full manages them. */
export default function VendorsPage() {
  const navigate = useNavigate()
  const { canManage } = useLibraryAccess()
  const query = useVendorsQuery()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canManage })
  const data = useMemo(() => query.data ?? [], [query.data])
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({ id: 'event-vendors', data, columns, globalFilter: search, globalFilterFn: vendorSearch, getRowId: (r) => r.id })
  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <>
      <PageHeader
        icon={<IconTile><Store /></IconTile>}
        title="Vendors"
        description={
          <>
            Booth builders, printers, caterers and other suppliers. Spend comes from the events’ budget lines.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
        actions={
          canManage && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New vendor
            </Button>
          )
        }
      />
      <PageBody>
        {query.error ? (
          <LibraryError error={query.error} onRetry={() => query.refetch()} what="Vendors" />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => navigate(vendorPath(row.id))}
            toolbar={
              <>
                <SearchInput aria-label="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact…" className="w-full sm:w-64" />
                <Facets table={table} data={data} />
                {filtered && (
                  <Button variant="ghost" size="sm" onClick={() => { table.resetColumnFilters(); setSearch('') }}>
                    Reset
                    <X />
                  </Button>
                )}
                <div className="ms-auto">
                  <ColumnPicker table={table} />
                </div>
              </>
            }
            empty={<EmptyState icon={<Store />} title={data.length ? 'No vendors match' : 'No vendors yet'} body={data.length ? 'Try another search or clear the filters.' : 'Add the suppliers you work with at events.'} />}
          />
        )}
      </PageBody>
      {canManage && <VendorDrawer open={creating} onClose={() => setCreating(false)} vendor={null} onSaved={(v) => navigate(vendorPath(v.id))} />}
    </>
  )
}

function Facets({ table, data }: { table: Table<Vendor>; data: Vendor[] }) {
  const status = table.getColumn('status')
  const category = table.getColumn('category')
  return (
    <>
      {category && (
        <FacetFilter
          title="Category"
          options={VENDOR_CATEGORIES.map((c) => ({ value: c, label: VENDOR_CATEGORY_LABEL[c], count: data.filter((v) => v.category === c).length }))}
          selected={(category.getFilterValue() as string[] | undefined) ?? []}
          onChange={(v) => category.setFilterValue(v.length ? v : undefined)}
        />
      )}
      {status && (
        <FacetFilter
          title="Status"
          options={VENDOR_STATUSES.map((s) => ({ value: s, label: VENDOR_STATUS_LABEL[s], count: data.filter((v) => v.status === s).length }))}
          selected={(status.getFilterValue() as string[] | undefined) ?? []}
          onChange={(v) => status.setFilterValue(v.length ? v : undefined)}
        />
      )}
    </>
  )
}

const inSet: FilterFn<Vendor> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))
const col = createColumnHelper<Vendor>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Vendor',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{row.original.name}</span>
          <span className="block truncate text-xs text-muted">{[row.original.contactName, displayMobile(row.original.mobile)].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    }),
    col.accessor('category', { header: 'Category', filterFn: inSet, cell: ({ getValue }) => <Badge tone="neutral">{VENDOR_CATEGORY_LABEL[getValue()]}</Badge> }),
    col.accessor('status', { header: 'Status', filterFn: inSet, cell: ({ getValue }) => <VendorStatusBadge status={getValue()} /> }),
    col.accessor('totalActual', { header: 'Spend', meta: { align: 'end' }, cell: ({ row }) => <span className="num text-ink-2">{moneyIn(row.original.totalActual, row.original.currency)}</span> }),
    col.accessor('eventCount', { header: 'Events', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span> }),
    col.accessor((r) => r.rating ?? -1, { id: 'rating', header: 'Rating', cell: ({ row }) => <Rating value={row.original.rating} count={row.original.reviewCount} /> }),
  ]
}

const vendorSearch: FilterFn<Vendor> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const v = row.original
  return [v.name, v.contactName, v.email, v.mobile, VENDOR_CATEGORY_LABEL[v.category]].join(' ').toLowerCase().includes(q)
}
