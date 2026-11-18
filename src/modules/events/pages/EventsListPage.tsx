import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { CalendarCheck2, CircleDollarSign, Ticket, UserPlus, X } from 'lucide-react'
import type { EventRow } from '@/modules/events/types'
import { EVENT_STATUSES, EVENT_STATUS_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { useEventsQuery } from '@/modules/events/hooks/useEvents'
import { EVENT_STATUS_TONE, EVENT_TYPE_ICON, EventStatusBadge, EventTypeBadge, eventWhen, moneyIn } from '@/modules/events/components/eventMeta'
import { EventsFrame } from '@/modules/events/components/EventsFrame'
import { eventPath } from '@/app/paths'
import { scopeOf } from '@/shared/lib/permissions'
import { useRegion } from '@/modules/tenancy/hooks'
import { companyDay } from '@/shared/lib/companyDay'
import { useCurrentUser } from '@/store/hooks'
import { AvatarGroup } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

/** Events list: every event the caller can see (marketing scope + the events they're on). */
export default function EventsListPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useEventsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({
    id: 'events-list',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: eventSearch,
    defaultHidden: ['budget'],
    getRowId: (r) => r.id,
  })
  if (!user) return null
  const scope = scopeOf(user.role, 'marketing')
  const membersOnly = scope !== 'full' && scope !== 'view'

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search
  const description = query.data
    ? `${query.data.length} event${query.data.length === 1 ? '' : 's'}${membersOnly ? ' · the events you’re on' : scope === 'view' ? ' · read only, except events you’re on' : ''}`
    : 'Loading…'

  if (membersOnly && query.data && query.data.length === 0) {
    return (
      <EventsFrame description="Exhibitions, conferences, meetings and webinars">
        <PageBody>
          <EmptyState
            icon={<Ticket />}
            title="No events for you yet"
            body={`${user.role} sees only the events they’re on the team of. Ask a marketing manager or the event owner to add you to an event’s team.`}
          />
        </PageBody>
      </EventsFrame>
    )
  }

  return (
    <EventsFrame description={description}>
      <PageBody className="space-y-5">
        <Kpis rows={query.data} loading={query.isPending} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(eventPath(row.id))}
          toolbar={
            <>
              <SearchInput
                aria-label="Search events"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, location, owner…"
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
              icon={<Ticket />}
              title={data.length === 0 ? 'No events yet' : 'No events match'}
              body={data.length === 0 ? 'Create an event to register attendees: each one becomes a lead with the source Event.' : 'Try another search or clear the filters.'}
            />
          }
        />
      </PageBody>
    </EventsFrame>
  )
}

function Kpis({ rows, loading }: { rows: EventRow[] | undefined; loading: boolean }) {
  const region = useRegion()
  const today = companyDay({ timezone: region.timezone, weekStartsOn: region.weekStartsOn }).today
  if (loading || !rows) {
    return (
      <section aria-label="Event figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </section>
    )
  }
  const live = rows.filter((r) => r.status !== 'cancelled')
  const upcoming = live.filter((r) => r.endDate >= today && r.status !== 'completed')
  const attendees = live.reduce((s, r) => s + r.attendeeCount, 0)
  const leads = live.reduce((s, r) => s + r.leadsCreated, 0)
  const budget = live.filter((r) => r.startDate.slice(0, 4) === today.slice(0, 4)).reduce((s, r) => s + (r.budget ?? 0), 0)
  return (
    <section aria-label="Event figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Upcoming events" icon={<CalendarCheck2 />} value={upcoming.length} hint={upcoming[0] ? `Next: ${upcoming[upcoming.length - 1].name}` : 'Nothing planned'} />
      <StatCard label="Attendees" icon={<Ticket />} value={attendees} hint="Registered across all events" />
      <StatCard label="Leads from events" icon={<UserPlus />} value={leads} hint="New leads with the source Event" />
      <StatCard label={`Budget ${today.slice(0, 4)}`} icon={<CircleDollarSign />} value={moneyIn(budget, region.currency)} hint="Events starting this year" />
    </section>
  )
}

function Facets({ table, data }: { table: Table<EventRow>; data: EventRow[] }) {
  const count = (fn: (r: EventRow) => boolean) => data.filter(fn).length
  const status = table.getColumn('status')
  const type = table.getColumn('type')
  return (
    <>
      {status && (
        <FacetFilter
          title="Status"
          options={EVENT_STATUSES.map((s) => ({
            value: s,
            label: EVENT_STATUS_LABEL[s],
            icon: <span className={`size-2 rounded-full ${DOT[EVENT_STATUS_TONE[s]]}`} aria-hidden />,
            count: count((r) => r.status === s),
          }))}
          selected={(status.getFilterValue() as string[] | undefined) ?? []}
          onChange={(v) => status.setFilterValue(v.length ? v : undefined)}
        />
      )}
      {type && (
        <FacetFilter
          title="Type"
          options={EVENT_TYPES.map((t) => {
            const Icon = EVENT_TYPE_ICON[t]
            return { value: t, label: EVENT_TYPE_LABEL[t], icon: <Icon className="size-3.5" aria-hidden />, count: count((r) => r.type === t) }
          })}
          selected={(type.getFilterValue() as string[] | undefined) ?? []}
          onChange={(v) => type.setFilterValue(v.length ? v : undefined)}
        />
      )}
    </>
  )
}

const inSet: FilterFn<EventRow> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<EventRow>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Event',
      enableHiding: false,
      meta: { width: 320 },
      cell: ({ row }) => {
        const e = row.original
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{e.name}</p>
            <p className="truncate text-xs text-muted">{e.location || (e.onlineUrl ? 'Online' : '—')}</p>
          </div>
        )
      },
    }),
    col.accessor('startDate', {
      header: 'When',
      cell: ({ row }) => <span className="num whitespace-nowrap text-ink-2">{eventWhen(row.original)}</span>,
    }),
    col.accessor('type', { header: 'Type', filterFn: inSet, cell: ({ getValue }) => <EventTypeBadge type={getValue()} /> }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => EVENT_STATUSES.indexOf(a.original.status) - EVENT_STATUSES.indexOf(b.original.status),
      cell: ({ getValue }) => <EventStatusBadge status={getValue()} />,
    }),
    col.accessor('ownerName', {
      header: 'Team',
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <AvatarGroup names={row.original.team.map((t) => t.name)} size="xs" />
          {row.original.registrationOpen && <Badge tone="green">Registration open</Badge>}
        </span>
      ),
    }),
    col.accessor('attendeeCount', {
      header: 'Attendees',
      meta: { align: 'end' },
      cell: ({ row }) => (
        <span className="num text-ink-2">
          {row.original.attendeeCount}
          {row.original.checkedInCount > 0 && <span className="ms-1 text-xs text-muted">· {row.original.checkedInCount} in</span>}
        </span>
      ),
    }),
    col.accessor('leadsCreated', { header: 'New leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-ink-2">{getValue()}</span> }),
    col.accessor('budget', {
      header: 'Budget',
      meta: { align: 'end' },
      cell: ({ row }) => <span className="num whitespace-nowrap text-ink-2">{moneyIn(row.original.budget, row.original.currency)}</span>,
    }),
  ]
}

const eventSearch: FilterFn<EventRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const e = row.original
  return [e.name, e.id, e.location, e.ownerName, EVENT_TYPE_LABEL[e.type], ...e.team.map((t) => t.name)].join(' ').toLowerCase().includes(q)
}
