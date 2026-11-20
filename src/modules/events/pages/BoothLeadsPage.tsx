import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { AlarmClock, ScanLine, UserCog, X } from 'lucide-react'
import type { BoothLead, FollowUpState } from '@/modules/events/sectionsTypes'
import { FOLLOW_UP_STATES, FOLLOW_UP_STATE_LABEL } from '@/modules/events/sectionsTypes'
import { CAPTURE_RATINGS, CAPTURE_RATING_LABEL, type CaptureRating } from '@/modules/events/types'
import { useAssignBoothLeads, useBoothLeads, useCanAssignBoothLeads } from '@/modules/events/hooks/useEventSections'
import { matchesBoothLead, NO_BOOTH_FILTERS, type BoothFilters } from '@/modules/events/lib/sections'
import { useLeadOwnersQuery } from '@/modules/leads/hooks/useLeads'
import { eventPath, leadPath } from '@/app/paths'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SearchInput, SelectInput, Switch } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, selectColumn, useDataTable } from '@/shared/components/data-table'

const STATE_TONE: Record<FollowUpState, Tone> = { untouched: 'neutral', contacted: 'sky', meeting: 'pink', won: 'green', lost: 'red', no_lead: 'neutral' }
const RATING_TONE: Record<CaptureRating, Tone> = { hot: 'red', warm: 'amber', cold: 'sky' }

/** Events › Booth leads: every booth capture across the visible events, with its follow-up state. */
export default function BoothLeadsPage() {
  const query = useBoothLeads()
  const data = query.data
  const all = useMemo(() => data?.rows ?? [], [data])
  const canAssign = useCanAssignBoothLeads() && !!data?.canAssign
  const [f, setF] = useState<BoothFilters>(NO_BOOTH_FILTERS)
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState<BoothLead[] | null>(null)
  const set = <K extends keyof BoothFilters>(k: K, v: BoothFilters[K]) => setF((x) => ({ ...x, [k]: v }))
  const filtered = useMemo(() => all.filter((r) => matchesBoothLead(r, f)), [all, f])
  const eventsList = useMemo(() => [...new Map(all.map((r) => [r.eventId, r.eventName])).entries()], [all])
  const owners = useMemo(() => [...new Map(all.filter((r) => r.leadOwnerId).map((r) => [r.leadOwnerId as string, r.leadOwnerName ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all])
  const overdue = all.filter((r) => r.overdue).length
  const currency = data?.currency ?? 'AED'

  const columns = useMemo(() => {
    const col = createColumnHelper<BoothLead>()
    return [
      ...(canAssign ? [selectColumn<BoothLead>()] : []),
      col.accessor('capturedAt', { header: 'Captured', cell: ({ getValue }) => <span className="num whitespace-nowrap text-xs text-ink-2">{fmtDate(getValue(), 'd MMM yyyy, HH:mm')}</span> }),
      col.accessor('visitorName', {
        header: 'Visitor',
        enableHiding: false,
        meta: { width: 220 },
        cell: ({ row }) => (
          <div className={`min-w-0 ${row.original.overdue ? 'border-s-2 border-danger-500 ps-2' : ''}`}>
            <p className="truncate font-medium text-ink">{row.original.visitorName}</p>
            <p className="truncate text-xs text-muted">{row.original.visitorCompany || row.original.visitorEmail || '—'}</p>
          </div>
        ),
      }),
      col.accessor('eventName', {
        header: 'Event',
        cell: ({ row }) => (
          <Link to={eventPath(row.original.eventId)} onClick={(e) => e.stopPropagation()} className="truncate text-ink-2 hover:underline">
            {row.original.eventName}
          </Link>
        ),
      }),
      col.accessor('capturedByName', { header: 'Captured by', cell: ({ getValue }) => <span className="text-ink-2">{getValue()}</span> }),
      col.accessor('rating', { header: 'Rating', cell: ({ getValue }) => <Badge tone={RATING_TONE[getValue()]}>{CAPTURE_RATING_LABEL[getValue()]}</Badge> }),
      col.accessor((r) => r.leadStatus ?? '', {
        id: 'lead',
        header: 'Lead',
        cell: ({ row }) => {
          const r = row.original
          if (!r.leadId) return <span className="text-xs text-subtle">No lead</span>
          if (!r.canOpenLead || !r.leadStatus) return <Badge tone="neutral">Lead</Badge>
          return (
            <Link to={leadPath(r.leadId)} onClick={(e) => e.stopPropagation()} className="flex min-w-0 flex-col items-start gap-0.5" aria-label={`Open the lead of ${r.visitorName}`}>
              <StatusBadge status={r.leadStatus} />
              <span className="truncate text-xs text-muted">
                {r.leadOwnerName}
                {r.leadValue ? ` · ${fmtMoney(r.leadValue, currency)}` : ''}
              </span>
            </Link>
          )
        },
      }),
      col.accessor('state', {
        header: 'Follow-up',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex flex-col items-start gap-0.5">
              <Badge tone={STATE_TONE[r.state]}>{FOLLOW_UP_STATE_LABEL[r.state]}</Badge>
              {r.overdue ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600 dark:text-danger-300" data-testid="overdue-flag">
                  <AlarmClock className="size-3.5" aria-hidden />
                  Overdue · {r.daysOverdue} {r.daysOverdue === 1 ? 'day' : 'days'}
                </span>
              ) : r.state === 'untouched' ? (
                <span className="num text-xs text-muted">Due {fmtDate(r.followUpDue)}</span>
              ) : null}
            </div>
          )
        },
      }),
    ]
  }, [canAssign, currency])

  const table = useDataTable({ id: 'event-booth-leads', data: filtered, columns, globalFilter: search, globalFilterFn: boothSearch, getRowId: (r) => r.id, enableRowSelection: canAssign })

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <ScanLine />
          </IconTile>
        }
        title="Booth leads"
        description={`Every booth capture across your events and what happened next. Untouched captures are overdue ${data ? `${data.followUpDays} day${data.followUpDays === 1 ? '' : 's'}` : 'a few days'} after the capture (Settings › Automation).`}
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
          <Select label="Event" value={f.eventId} onChange={(v) => set('eventId', v)} all="All events" options={eventsList.map(([id, name]) => ({ value: id, label: name }))} />
          <Select label="Rating" value={f.rating} onChange={(v) => set('rating', v as CaptureRating | '')} all="Any rating" options={CAPTURE_RATINGS.map((r) => ({ value: r, label: CAPTURE_RATING_LABEL[r] }))} />
          <Select label="Owner" value={f.ownerId} onChange={(v) => set('ownerId', v)} all="Any owner" options={owners.map(([id, name]) => ({ value: id, label: name }))} />
          <Select label="Follow-up state" value={f.state} onChange={(v) => set('state', v as FollowUpState | '')} all="Any state" options={FOLLOW_UP_STATES.map((s) => ({ value: s, label: FOLLOW_UP_STATE_LABEL[s] }))} />
          <div className="flex items-center gap-2 pb-1.5">
            <Switch id="booth-overdue" checked={f.overdueOnly} onChange={(v) => set('overdueOnly', v)} label="Overdue follow-up only" />
            <label htmlFor="booth-overdue" className="text-[0.8125rem] text-ink-2">
              Overdue follow-up only <span className={`num ${overdue ? 'text-danger-600 dark:text-danger-300' : 'text-muted'}`}>({overdue})</span>
            </label>
          </div>
        </div>
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          toolbar={
            <>
              <SearchInput aria-label="Search booth leads" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search visitor, company, event…" className="w-full sm:w-64" />
              {(search || JSON.stringify(f) !== JSON.stringify(NO_BOOTH_FILTERS)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setF(NO_BOOTH_FILTERS)
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
              <span className="num ms-auto text-xs text-muted" data-testid="booth-count">
                {filtered.length} {filtered.length === 1 ? 'capture' : 'captures'}
              </span>
            </>
          }
          bulkActions={
            canAssign
              ? (selected) => (
                  <Button write size="sm" variant="secondary" onClick={() => setAssigning(selected)}>
                    <UserCog />
                    Assign owner
                  </Button>
                )
              : undefined
          }
          empty={
            <EmptyState
              icon={<ScanLine />}
              title={all.length === 0 ? 'No booth captures yet' : 'No captures match'}
              body={all.length === 0 ? 'Captures made on the booth capture page of your events show up here.' : 'Try other filters.'}
            />
          }
        />
      </PageBody>
      {canAssign && (
        <AssignModal
          rows={assigning}
          onClose={(done) => {
            setAssigning(null)
            if (done) table.resetRowSelection()
          }}
        />
      )}
    </>
  )
}

const boothSearch: FilterFn<BoothLead> = (row, _c, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const r = row.original
  return [r.visitorName, r.visitorCompany, r.visitorEmail, r.eventName, r.capturedByName, r.notes].join(' ').toLowerCase().includes(q)
}

function Select({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all: string }) {
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

function AssignModal({ rows, onClose }: { rows: BoothLead[] | null; onClose: (done: boolean) => void }) {
  const owners = useLeadOwnersQuery(!!rows)
  const assign = useAssignBoothLeads()
  const toast = useToast()
  const [ownerId, setOwnerId] = useState('')
  const withLead = (rows ?? []).filter((r) => r.leadId)
  function submit() {
    if (!rows || !ownerId) return
    assign.mutate(
      { captureIds: rows.map((r) => r.id), ownerId },
      {
        onSuccess: (res) => {
          if (res.skipped.length) toast.info(`${res.updated} lead${res.updated === 1 ? '' : 's'} reassigned`, `${res.skipped.length} skipped: ${[...new Set(res.skipped.map((s) => skipText(s.reason)))].join('; ')}`)
          else toast.success(`${res.updated} lead${res.updated === 1 ? '' : 's'} reassigned`)
          setOwnerId('')
          onClose(true)
        },
        onError: (err) => toast.error('Owner not changed', err.message),
      },
    )
  }
  return (
    <Modal
      open={!!rows}
      onClose={() => onClose(false)}
      size="sm"
      title="Assign owner"
      description={`${withLead.length} of ${rows?.length ?? 0} selected captures have a lead. The change goes through the normal lead update, so your lead access rules apply.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button write onClick={submit} disabled={!ownerId || !withLead.length} loading={assign.isPending}>
            Assign
          </Button>
        </>
      }
    >
      <Field label="New owner" id="booth-owner">
        <SelectInput id="booth-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Pick a person…</option>
          {(owners.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.openLeads} open
            </option>
          ))}
        </SelectInput>
      </Field>
    </Modal>
  )
}

const skipText = (reason: string) => (reason === 'no_lead' ? 'no lead' : reason === 'not_found' ? 'not available' : reason)
