import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { MapPinned, Plus } from 'lucide-react'
import type { Venue } from '@/modules/events/libraryTypes'
import { VENUE_TYPE_LABEL } from '@/modules/events/libraryTypes'
import { useLibraryAccess, useVenuesQuery } from '@/modules/events/hooks/useEventLibrary'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, VenueStatusBadge } from '@/modules/events/components/library/LibraryBits'
import { VenueDrawer } from '@/modules/events/components/library/VenueDrawer'
import { PATHS, venuePath } from '@/app/paths'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, useDataTable } from '@/shared/components/data-table'

/** `/events/venues`: the company's venues. Marketing full manages them; marketing view and event teams read them. */
export default function VenuesPage() {
  const navigate = useNavigate()
  const { canManage } = useLibraryAccess()
  const query = useVenuesQuery()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const data = useMemo(() => (query.data ?? []).filter((v) => showArchived || v.status === 'active'), [query.data, showArchived])
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({ id: 'event-venues', data, columns, globalFilter: search, globalFilterFn: venueSearch, defaultHidden: ['dayRate'], getRowId: (r) => r.id })

  return (
    <>
      <PageHeader
        icon={<IconTile><MapPinned /></IconTile>}
        title="Venues"
        description={
          <>
            Where events happen: rooms, capacity, contacts and rates. Picking a venue on an event fills its location.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
        actions={
          canManage && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New venue
            </Button>
          )
        }
      />
      <PageBody>
        {query.error ? (
          <LibraryError error={query.error} onRetry={() => query.refetch()} what="Venues" />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => navigate(venuePath(row.id))}
            toolbar={
              <>
                <SearchInput aria-label="Search venues" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, city, amenity…" className="w-full sm:w-64" />
                <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                  <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />
                  Show archived
                </label>
                <div className="ms-auto">
                  <ColumnPicker table={table} />
                </div>
              </>
            }
            empty={<EmptyState icon={<MapPinned />} title={query.data?.length ? 'No venues match' : 'No venues yet'} body={query.data?.length ? 'Try another search.' : 'Add the halls, hotels and platforms you use.'} />}
          />
        )}
      </PageBody>
      {canManage && <VenueDrawer open={creating} onClose={() => setCreating(false)} venue={null} onSaved={(v) => navigate(venuePath(v.id))} />}
    </>
  )
}

const col = createColumnHelper<Venue>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Venue',
      enableHiding: false,
      meta: { width: 300 },
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{row.original.name}</span>
            <VenueStatusBadge status={row.original.status} />
          </span>
          <span className="block truncate text-xs text-muted">{[row.original.city, row.original.country].filter(Boolean).join(', ') || '—'}</span>
        </span>
      ),
    }),
    col.accessor('type', { header: 'Type', cell: ({ getValue }) => <Badge tone="neutral">{VENUE_TYPE_LABEL[getValue()]}</Badge> }),
    col.accessor((r) => r.capacity ?? -1, {
      id: 'capacity',
      header: 'Capacity',
      meta: { align: 'end' },
      cell: ({ row }) => (
        <span className="num text-ink-2">
          {row.original.capacity ?? '—'}
          {row.original.rooms.length > 0 && <span className="ms-1 text-xs text-muted">· {row.original.rooms.length} room{row.original.rooms.length === 1 ? '' : 's'}</span>}
        </span>
      ),
    }),
    col.accessor('eventCount', { header: 'Events', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span> }),
    col.accessor((r) => r.rating ?? -1, { id: 'rating', header: 'Rating', cell: ({ row }) => <Rating value={row.original.rating} /> }),
    col.accessor((r) => r.dayRate ?? -1, { id: 'dayRate', header: 'Day rate', meta: { align: 'end' }, cell: ({ row }) => <span className="num text-ink-2">{moneyIn(row.original.dayRate, row.original.currency)}</span> }),
  ]
}

const venueSearch: FilterFn<Venue> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const v = row.original
  return [v.name, v.city, v.address, v.contactName, VENUE_TYPE_LABEL[v.type], ...v.amenities, ...v.rooms.map((r) => r.name)].join(' ').toLowerCase().includes(q)
}
