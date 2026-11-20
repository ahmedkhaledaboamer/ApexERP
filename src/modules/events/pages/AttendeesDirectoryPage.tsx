import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Ban, CheckCircle2, Download, ExternalLink, FileSpreadsheet, BookUser, X } from 'lucide-react'
import type { AttendeeExportRow, AttendeePerson, PersonRegistration } from '@/modules/events/sectionsTypes'
import { ATTENDEE_SOURCE_LABEL, ATTENDEE_STATUS_LABEL, CAPTURE_RATING_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL, type EventType } from '@/modules/events/types'
import { exportAttendeeDirectory } from '@/modules/events/api/eventSectionsApi'
import { useAttendeeDirectory } from '@/modules/events/hooks/useEventSections'
import { matchesPerson, NO_ATTENDEE_FILTERS, type AttendeeFilters } from '@/modules/events/lib/sections'
import { buildCsv, csvFileName, downloadCsv, type CsvColumn } from '@/modules/platform/csv'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { eventPath, leadPath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, useDataTable } from '@/shared/components/data-table'

/** Events › Attendees: everyone registered at the events the caller can see, one row per person. */
export default function AttendeesDirectoryPage() {
  const query = useAttendeeDirectory()
  const all = useMemo(() => query.data?.people ?? [], [query.data])
  const eventsList = query.data?.events ?? []
  const [search, setSearch] = useState('')
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [open, setOpen] = useState<AttendeePerson | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const toast = useToast()
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))
  const filtered = useMemo(() => all.filter((p) => matches(p, f)), [all, f])
  const statuses = useMemo(() => [...new Set(all.map((p) => p.leadStatus).filter((s): s is string => !!s))].sort(), [all])
  const active = search !== '' || JSON.stringify(f) !== JSON.stringify(NO_FILTERS)

  const columns = useMemo(() => {
    const col = createColumnHelper<AttendeePerson>()
    return [
      col.accessor('name', {
        header: 'Person',
        enableHiding: false,
        meta: { width: 240 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium text-ink">
              <span className="truncate">{row.original.name}</span>
              {row.original.doNotContact && (
                <Badge tone="red" icon={<Ban className="size-3" aria-hidden />}>
                  Do not contact
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted">{row.original.title || '—'}</p>
          </div>
        ),
      }),
      col.accessor('companyName', { header: 'Company', cell: ({ getValue }) => <span className="truncate text-ink-2">{getValue() || '—'}</span> }),
      col.accessor('email', {
        header: 'Contact',
        cell: ({ row }) => (
          <div className="min-w-0 text-[0.8125rem]">
            <p className="truncate text-ink-2">{row.original.email || '—'}</p>
            <p className="num truncate text-xs text-muted">{row.original.mobile}</p>
          </div>
        ),
      }),
      col.accessor('eventsAttended', {
        header: 'Events',
        cell: ({ row }) => (
          <span className="num text-ink-2" title="Attended / registered">
            {row.original.eventsAttended} / {row.original.eventsRegistered}
          </span>
        ),
      }),
      col.accessor('lastEventDate', {
        header: 'Last event',
        cell: ({ row }) =>
          row.original.lastEventId ? (
            <div className="min-w-0 text-xs">
              <p className="truncate text-ink-2">{row.original.lastEventName}</p>
              <p className="num text-muted">{fmtDate(row.original.lastEventDate)}</p>
            </div>
          ) : (
            '—'
          ),
      }),
      col.accessor((p) => p.checkedInRate ?? -1, {
        id: 'checkedInRate',
        header: 'Checked in',
        cell: ({ row }) => <span className="num text-ink-2">{row.original.checkedInRate === null ? '—' : `${row.original.checkedInRate}%`}</span>,
      }),
      col.accessor((p) => p.ticketTypes.join(', '), { id: 'tickets', header: 'Tickets', cell: ({ getValue }) => <span className="text-xs text-muted">{getValue() || '—'}</span> }),
      col.accessor((p) => p.leadStatus ?? '', {
        id: 'lead',
        header: 'Lead',
        cell: ({ row }) => <LeadChip person={row.original} />,
      }),
      col.accessor((p) => p.sources.map((s) => ATTENDEE_SOURCE_LABEL[s]).join(', '), { id: 'source', header: 'Source', cell: ({ getValue }) => <span className="text-xs text-muted">{getValue()}</span> }),
    ]
  }, [])

  const table = useDataTable({ id: 'event-attendee-directory', data: filtered, columns, globalFilter: search, globalFilterFn: personSearch, getRowId: (r) => r.key, defaultHidden: ['source'] })

  async function runExport(kind: 'csv' | 'xlsx') {
    setExporting(kind)
    try {
      // The export follows the filters on screen (search included).
      const keys = new Set(table.getFilteredRowModel().rows.map((r) => r.original.key))
      const rows = (await exportAttendeeDirectory()).filter((r) => keys.has(r.key))
      if (kind === 'csv') downloadCsv(csvFileName('event-attendees'), buildCsv(rows, CSV_COLUMNS))
      else
        await downloadExcel(
          `event-attendees-${format(new Date(), 'yyyy-MM-dd')}`,
          [{ name: 'Attendees', title: 'Event attendees', columns: CSV_COLUMNS.map((c) => ({ header: c.header, width: 18 })), rows: rows.map((r) => CSV_COLUMNS.map((c) => c.value(r) as string | number | null)) }],
          `${rows.length} people · Do Not Contact people are exported without email and mobile · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`,
        )
      toast.success('Export ready', `${rows.length} ${rows.length === 1 ? 'person' : 'people'}; Do Not Contact people without email and mobile.`)
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : 'Try again in a moment.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <BookUser />
          </IconTile>
        }
        title="Attendees"
        description="Everyone registered at your events, one row per person: events attended, check-ins, tickets and their lead."
        actions={
          query.data?.canExport ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => runExport('csv')} loading={exporting === 'csv'} disabled={!filtered.length}>
                <Download />
                CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={() => runExport('xlsx')} loading={exporting === 'xlsx'} disabled={!filtered.length}>
                <FileSpreadsheet />
                Excel
              </Button>
            </div>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
          <FilterSelect label="Event" value={f.eventId} onChange={(v) => set('eventId', v)} options={eventsList.map((e) => ({ value: e.id, label: e.name }))} all="All events" />
          <FilterSelect label="Event type" value={f.type} onChange={(v) => set('type', v as EventType | '')} options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))} all="All types" />
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">From</span>
            <TextInput type="date" aria-label="Events from" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-40" />
          </label>
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">To</span>
            <TextInput type="date" aria-label="Events to" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-40" />
          </label>
          <FilterSelect
            label="Checked in"
            value={f.checkedIn}
            onChange={(v) => set('checkedIn', v as Filters['checkedIn'])}
            options={[
              { value: 'yes', label: 'Attended at least once' },
              { value: 'no', label: 'Never checked in' },
            ]}
            all="Anyone"
          />
          <FilterSelect
            label="Lead"
            value={f.lead}
            onChange={(v) => set('lead', v)}
            options={[{ value: 'with', label: 'Has a lead' }, { value: 'without', label: 'No lead' }, ...statuses.map((s) => ({ value: `status:${s}`, label: `Status: ${s}` }))]}
            all="Any"
          />
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">Company</span>
            <TextInput aria-label="Company" value={f.company} onChange={(e) => set('company', e.target.value)} placeholder="Any company" className="w-44" />
          </label>
        </div>
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={setOpen}
          toolbar={
            <>
              <SearchInput aria-label="Search attendees" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, email…" className="w-full sm:w-64" />
              {active && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setF(NO_FILTERS)
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
              <span className="num ms-auto text-xs text-muted" data-testid="attendee-count">
                {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
              </span>
            </>
          }
          empty={
            <EmptyState
              icon={<BookUser />}
              title={all.length === 0 ? 'No attendees yet' : 'No one matches'}
              body={all.length === 0 ? 'People registered at the events you can see show up here.' : 'Try other filters or another search.'}
            />
          }
        />
      </PageBody>
      <PersonDrawer person={open} onClose={() => setOpen(null)} />
    </>
  )
}

type Filters = AttendeeFilters
const NO_FILTERS = NO_ATTENDEE_FILTERS
const matches = matchesPerson

const personSearch: FilterFn<AttendeePerson> = (row, _c, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const p = row.original
  return [p.name, p.companyName, p.email, p.mobile, p.title].join(' ').toLowerCase().includes(q)
}

const CSV_COLUMNS: CsvColumn<AttendeeExportRow>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Company', value: (r) => r.companyName },
  { header: 'Title', value: (r) => r.title },
  { header: 'Email', value: (r) => r.email },
  { header: 'Mobile', value: (r) => r.mobile },
  { header: 'Do not contact', value: (r) => (r.doNotContact ? 'Yes' : 'No') },
  { header: 'Events registered', value: (r) => r.eventsRegistered },
  { header: 'Events attended', value: (r) => r.eventsAttended },
  { header: 'Checked-in rate %', value: (r) => r.checkedInRate ?? '' },
  { header: 'Last event', value: (r) => r.lastEventName },
  { header: 'Last event date', value: (r) => r.lastEventDate ?? '' },
  { header: 'Ticket types', value: (r) => r.ticketTypes },
  { header: 'Lead status', value: (r) => r.leadStatus },
  { header: 'Lead owner', value: (r) => r.leadOwnerName },
  { header: 'Source', value: (r) => r.sources },
]

function FilterSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all: string }) {
  return (
    <label className="text-[0.8125rem]">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <SelectInput aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-44">
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectInput>
    </label>
  )
}

function LeadChip({ person: p }: { person: AttendeePerson }) {
  if (!p.leadId) return <span className="text-xs text-subtle">No lead</span>
  if (!p.canOpenLead || !p.leadStatus) return <Badge tone="neutral">Lead</Badge>
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <StatusBadge status={p.leadStatus} />
      <span className="truncate text-xs text-muted">{p.leadOwnerName}</span>
    </div>
  )
}

function PersonDrawer({ person: p, onClose }: { person: AttendeePerson | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!p}
      onClose={onClose}
      title={p?.name ?? ''}
      description={p ? [p.title, p.companyName].filter(Boolean).join(' · ') || undefined : undefined}
      footer={
        p?.leadId && p.canOpenLead ? (
          <Link to={leadPath(p.leadId)} className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700 hover:underline dark:text-brand-300">
            <ExternalLink className="size-4" aria-hidden />
            Open lead
          </Link>
        ) : undefined
      }
    >
      {p && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-[0.8125rem]">
            <Fact label="Email" value={p.email || '—'} />
            <Fact label="Mobile" value={p.mobile || '—'} />
            <Fact label="Events attended" value={`${p.eventsAttended} of ${p.eventsRegistered}`} />
            <Fact label="Checked-in rate" value={p.checkedInRate === null ? '—' : `${p.checkedInRate}%`} />
            <Fact label="Lead" value={p.leadId ? (p.canOpenLead && p.leadStatus ? <StatusBadge status={p.leadStatus} /> : 'Outside your sales access') : 'No lead'} />
            <Fact label="Lead owner" value={p.leadOwnerName ?? '—'} />
          </dl>
          {p.doNotContact && (
            <p className="rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-300">
              Do Not Contact: this person asked not to be contacted. Exports leave out their email and mobile.
            </p>
          )}
          <section aria-label="Registrations">
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Registrations</h3>
            <ol className="space-y-3">
              {p.registrations.map((r) => (
                <RegistrationItem key={r.attendeeId} r={r} />
              ))}
            </ol>
          </section>
        </div>
      )}
    </Drawer>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </div>
  )
}

function RegistrationItem({ r }: { r: PersonRegistration }) {
  return (
    <li className="rounded-lg border border-line p-3 text-[0.8125rem]" data-testid="person-registration">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={eventPath(r.eventId)} className="truncate font-medium text-ink hover:underline">
            {r.eventName}
          </Link>
          <p className="text-xs text-muted">
            {EVENT_TYPE_LABEL[r.eventType]} · <span className="num">{fmtDate(r.eventDate)}</span>
          </p>
        </div>
        {r.status !== 'registered' ? (
          <Badge tone={r.status === 'waitlisted' ? 'amber' : 'neutral'}>{ATTENDEE_STATUS_LABEL[r.status]}</Badge>
        ) : r.checkedInAt ? (
          <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>
            Checked in
          </Badge>
        ) : (
          <Badge tone="neutral">Not checked in</Badge>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Ticket</dt>
        <dd className="text-ink-2">{r.ticketTypeName || '—'}</dd>
        <dt className="text-muted">Check-in</dt>
        <dd className="num text-ink-2">{r.checkedInAt ? fmtDate(r.checkedInAt, 'd MMM yyyy, HH:mm') : '—'}</dd>
        <dt className="text-muted">Source</dt>
        <dd className="text-ink-2">{ATTENDEE_SOURCE_LABEL[r.source]}</dd>
        <dt className="text-muted">Survey</dt>
        <dd className="text-ink-2">{r.survey ? `${r.survey.rating}/5 · NPS ${r.survey.nps}${r.survey.comment ? ` · “${r.survey.comment}”` : ''}` : '—'}</dd>
      </dl>
      {r.captures.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs" aria-label="Booth captures">
          {r.captures.map((c) => (
            <li key={c.id} className="text-ink-2">
              <Badge tone={c.rating === 'hot' ? 'red' : c.rating === 'warm' ? 'amber' : 'sky'}>{CAPTURE_RATING_LABEL[c.rating]}</Badge> captured by {c.capturedByName} ·{' '}
              <span className="num">{fmtDate(c.capturedAt, 'd MMM yyyy')}</span>
              {c.notes ? <span className="text-muted"> · {c.notes}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
