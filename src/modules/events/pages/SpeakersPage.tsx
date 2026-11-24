import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { Mic2, Plus } from 'lucide-react'
import type { Speaker } from '@/modules/events/libraryTypes'
import { useLibraryAccess, useSpeakersQuery } from '@/modules/events/hooks/useEventLibrary'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, Tags } from '@/modules/events/components/library/LibraryBits'
import { SpeakerDrawer } from '@/modules/events/components/library/SpeakerDrawer'
import { PATHS, speakerPath } from '@/app/paths'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

/** `/events/speakers`: the company's speaker directory. Marketing full manages it; marketing view and event teams read it. */
export default function SpeakersPage() {
  const navigate = useNavigate()
  const { canManage } = useLibraryAccess()
  const query = useSpeakersQuery()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canManage })
  const data = useMemo(() => query.data ?? [], [query.data])
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({ id: 'event-speakers', data, columns, globalFilter: search, globalFilterFn: speakerSearch, defaultHidden: ['fee'], getRowId: (r) => r.id })

  return (
    <>
      <PageHeader
        icon={<IconTile><Mic2 /></IconTile>}
        title="Speakers"
        description={
          <>
            {query.data ? `${query.data.length} speaker${query.data.length === 1 ? '' : 's'} in the directory · ` : ''}
            Events pick their speakers from here.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
        actions={
          canManage && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New speaker
            </Button>
          )
        }
      />
      <PageBody>
        {query.error ? (
          <LibraryError error={query.error} onRetry={() => query.refetch()} what="Speakers" />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => navigate(speakerPath(row.id))}
            toolbar={
              <>
                <SearchInput aria-label="Search speakers" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, topic…" className="w-full sm:w-64" />
                <div className="ms-auto">
                  <ColumnPicker table={table} />
                </div>
              </>
            }
            empty={<EmptyState icon={<Mic2 />} title={data.length ? 'No speakers match' : 'No speakers yet'} body={data.length ? 'Try another search.' : 'Add speakers here or from an event’s agenda.'} />}
          />
        )}
      </PageBody>
      {canManage && <SpeakerDrawer open={creating} onClose={() => setCreating(false)} speaker={null} onSaved={(s) => navigate(speakerPath(s.id))} />}
    </>
  )
}

const col = createColumnHelper<Speaker>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Speaker',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            {s.photoUrl ? <img src={s.photoUrl} alt="" className="size-7 rounded-full object-cover" /> : <Avatar name={s.name} size="sm" />}
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{s.name}</span>
              <span className="block truncate text-xs text-muted">{[s.title, s.company].filter(Boolean).join(' · ') || '—'}</span>
            </span>
          </span>
        )
      },
    }),
    col.accessor('kind', { header: 'Kind', cell: ({ row }) => <Badge tone={row.original.kind === 'internal' ? 'brand' : 'neutral'}>{row.original.kind === 'internal' ? 'Internal' : 'External'}</Badge> }),
    col.accessor((r) => r.topics.join(', '), { id: 'topics', header: 'Topics', enableSorting: false, cell: ({ row }) => <Tags tags={row.original.topics} /> }),
    col.accessor('eventCount', { header: 'Events', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span> }),
    col.accessor((r) => r.rating ?? -1, { id: 'rating', header: 'Rating', cell: ({ row }) => <Rating value={row.original.rating} count={row.original.ratingCount} /> }),
    col.accessor((r) => r.fee ?? -1, { id: 'fee', header: 'Fee', meta: { align: 'end' }, cell: ({ row }) => <span className="num text-ink-2">{row.original.fee === null ? '—' : moneyIn(row.original.fee, row.original.feeCurrency)}</span> }),
  ]
}

const speakerSearch: FilterFn<Speaker> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const s = row.original
  return [s.name, s.title, s.company, s.email, ...s.topics].join(' ').toLowerCase().includes(q)
}
