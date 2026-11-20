import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake, Plus } from 'lucide-react'
import type { SponsorDeal, SponsorFilter, SponsorStage } from '@/modules/events/sponsorTypes'
import { SPONSOR_STAGES, SPONSOR_STAGE_LABEL } from '@/modules/events/sponsorTypes'
import { useMoveSponsor, useSponsorBoardQuery } from '@/modules/events/hooks/useSponsorsLogistics'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { SPONSOR_STAGE_TONE, SponsorStageBadge, sponsorMoveProblem } from '@/modules/events/components/sponsorMeta'
import { LostReasonModal, NewSponsorModal } from '@/modules/events/components/SponsorForms'
import { SponsorDrawer } from '@/modules/events/components/SponsorDrawer'
import { PATHS, eventPath } from '@/app/paths'
import { userStorage } from '@/shared/lib/storage'
import { KanbanBoard, KanbanCard } from '@/shared/components/kanban/KanbanBoard'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

type View = 'board' | 'list'
const VIEW_KEY = 'events.sponsors.view'
const readView = (): View => (userStorage.pref.get(VIEW_KEY) === 'list' ? 'list' : 'board')

/** `/events/sponsors`: sponsors & exhibitors across the events the company organizes — pipeline board and list. */
export default function EventSponsorsPage() {
  const [filter, setFilter] = useState<SponsorFilter>({})
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    userStorage.pref.set(VIEW_KEY, v)
  }
  const q = useSponsorBoardQuery(filter)
  const users = useUsersQuery()
  const move = useMoveSponsor()
  const toast = useToast()
  const [open, setOpen] = useState<{ eventId: string; id: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [losing, setLosing] = useState<SponsorDeal | null>(null)
  const board = q.data
  const packages = useMemo(() => board?.packages ?? [], [board])
  const canAdd = !!board?.events.some((e) => e.canManage && packages.some((p) => p.eventId === e.id))

  function moveTo(d: SponsorDeal, to: SponsorStage, lostReason?: string) {
    const problem = sponsorMoveProblem(d, to, packages)
    if (problem) return toast.error('Not moved', problem)
    if (to === 'lost' && !lostReason) return setLosing(d)
    move.mutate(
      { eventId: d.eventId, sponsorId: d.id, input: { stage: to, lostReason } },
      { onSuccess: (r) => { setLosing(null); toast.success(`${r.organizationName}: ${SPONSOR_STAGE_LABEL[r.stage]}`) }, onError: (err) => toast.error('Not moved', err.message) },
    )
  }

  const filters = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <SelectInput aria-label="Event" className="w-56" value={filter.eventId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, eventId: e.target.value || undefined, packageId: undefined }))}>
        <option value="">All events</option>
        {(board?.events ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </SelectInput>
      <SelectInput aria-label="Package" className="w-44" value={filter.packageId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, packageId: e.target.value || undefined }))}>
        <option value="">All packages</option>
        {packages.filter((p) => !filter.eventId || p.eventId === filter.eventId).map((p) => <option key={p.id} value={p.id}>{filter.eventId ? p.name : `${p.name} · ${p.eventName}`}</option>)}
      </SelectInput>
      <SelectInput aria-label="Stage" className="w-40" value={filter.stage ?? ''} onChange={(e) => setFilter((f) => ({ ...f, stage: (e.target.value || undefined) as SponsorStage | undefined }))}>
        <option value="">All stages</option>
        {SPONSOR_STAGES.map((s) => <option key={s} value={s}>{SPONSOR_STAGE_LABEL[s]}</option>)}
      </SelectInput>
      <SelectInput aria-label="Owner" className="w-44" value={filter.ownerId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, ownerId: e.target.value || undefined }))}>
        <option value="">All owners</option>
        {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </SelectInput>
      <Segmented<View> className="ms-auto" label="View" value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
    </div>
  )

  return (
    <>
      <PageHeader
        icon={<IconTile><Handshake /></IconTile>}
        title="Sponsors & exhibitors"
        description={
          <>
            Sponsorship packages and sponsors of the events your company organizes. Signed and paid sponsors count as income in the event’s ROI.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
        actions={
          canAdd && (
            <Button write onClick={() => setAdding(true)}>
              <Plus />
              Add sponsor
            </Button>
          )
        }
      />
      <PageBody className="space-y-4">
        {filters}
        {q.isPending ? (
          <Skeleton className="h-72 rounded-card" />
        ) : q.error ? (
          <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
        ) : board!.events.length === 0 ? (
          <EmptyState icon={<Handshake />} title="No organized events" body="Sponsors and exhibitors belong to events your company organizes. Create one (or mark an event as organized by you) to sell packages." />
        ) : view === 'board' ? (
          <KanbanBoard<SponsorDeal, SponsorStage>
            columns={SPONSOR_STAGES.map((s) => ({ id: s, label: SPONSOR_STAGE_LABEL[s], tone: SPONSOR_STAGE_TONE[s] }))}
            items={board!.deals}
            getId={(d) => d.id}
            getColumn={(d) => d.stage}
            canMoveItem={(d) => d.canManage}
            onMove={(d, to) => moveTo(d, to)}
            onBlockedMove={() => toast.error('Not moved', 'Only marketing managers and the event’s team can move its sponsors.')}
            summarize={(items) => moneyIn(items.reduce((s, d) => s + d.amount, 0), board!.currency)}
            emptyLabel="No sponsors"
            renderCard={(d) => (
              <KanbanCard>
                <button type="button" className="block w-full text-start" onClick={() => setOpen({ eventId: d.eventId, id: d.id })} aria-label={`Open ${d.organizationName}`}>
                  <p className="truncate text-[0.8125rem] font-semibold">{d.organizationName}</p>
                  <p className="truncate text-xs text-muted">{d.eventName} · {d.packageName}</p>
                  <p className="num mt-1 text-[0.8125rem]">{moneyIn(d.amount, d.currency)}</p>
                  {d.ownerName && <p className="mt-0.5 truncate text-xs text-muted">{d.ownerName}</p>}
                </button>
              </KanbanCard>
            )}
          />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]" aria-label="Sponsors">
              <thead className="border-b border-line bg-sunken/50 text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 text-start font-medium">Organization</th>
                  <th className="px-3 py-2 text-start font-medium">Event</th>
                  <th className="px-3 py-2 text-start font-medium">Package</th>
                  <th className="px-3 py-2 text-start font-medium">Stage</th>
                  <th className="px-3 py-2 text-end font-medium">Amount</th>
                  <th className="px-3 py-2 text-start font-medium">Expected payment</th>
                  <th className="px-5 py-2 text-start font-medium">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {board!.deals.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-4 text-muted">No sponsors match.</td></tr>
                )}
                {board!.deals.map((d) => (
                  <tr key={d.id} className="hover:bg-hover">
                    <td className="px-5 py-2">
                      <button type="button" className="font-medium hover:underline" onClick={() => setOpen({ eventId: d.eventId, id: d.id })}>{d.organizationName}</button>
                    </td>
                    <td className="px-3 py-2"><Link className="hover:underline" to={eventPath(d.eventId, 'sponsors')}>{d.eventName}</Link></td>
                    <td className="px-3 py-2">{d.packageName}</td>
                    <td className="px-3 py-2"><SponsorStageBadge stage={d.stage} /></td>
                    <td className="num px-3 py-2 text-end">{moneyIn(d.amount, d.currency)}</td>
                    <td className="num px-3 py-2">{d.actualPaymentDate ? `Paid ${d.actualPaymentDate}` : d.expectedPaymentDate ?? '—'}</td>
                    <td className="px-5 py-2 text-ink-2">{d.ownerName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
      {adding && board && <NewSponsorModal events={board.events} packages={packages} onClose={() => setAdding(false)} onCreated={(id, eventId) => setOpen({ id, eventId })} />}
      {losing && <LostReasonModal name={losing.organizationName} busy={move.isPending} onClose={() => setLosing(null)} onConfirm={(r) => moveTo(losing, 'lost', r)} />}
      <SponsorDrawer eventId={open?.eventId ?? ''} sponsorId={open?.id ?? null} packages={packages} onClose={() => setOpen(null)} />
    </>
  )
}
