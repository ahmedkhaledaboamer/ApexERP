import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Ban,
  CalendarDays,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Globe,
  History,
  MapPin,
  Pencil,
  Target,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import type { TaskFilter, TaskLinkView } from '@/modules/tasks/types'
import { useAddTeamMember, useCancelEvent, useEventQuery, useEventStatsQuery, useRemoveTeamMember, useUpdateEvent } from '@/modules/events/hooks/useEvents'
import { EventStatusBadge, EventTypeBadge, eventWhen, moneyIn } from '@/modules/events/components/eventMeta'
import { EventDrawer } from '@/modules/events/components/EventDrawer'
import { AttendeesTab } from '@/modules/events/components/AttendeesTab'
import { LinkedTasksPanel } from '@/modules/tasks/components/LinkedTasksPanel'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { PATHS, publicEventPath } from '@/app/paths'
import { ApiError } from '@/shared/lib/apiError'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar, AvatarGroup } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, Switch } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'

type Tab = 'overview' | 'attendees' | 'leads' | 'tasks' | 'activity'
const TABS: Tab[] = ['overview', 'attendees', 'leads', 'tasks', 'activity']

export default function EventDetailPage() {
  const { id = '' } = useParams()
  const query = useEventQuery(id)
  if (query.isPending) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </PageBody>
    )
  }
  if (query.error) {
    const status = query.error instanceof ApiError ? query.error.status : 0
    return (
      <PageBody>
        {status === 404 || status === 403 ? (
          <EmptyState
            icon={<CalendarDays />}
            title={status === 404 ? 'Event not found' : 'This event isn’t available to you'}
            body={query.error.message}
            action={
              <Link to={PATHS.events} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                Back to events
              </Link>
            }
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }
  return <EventView event={query.data} />
}

function EventView({ event: e }: { event: EventDetail }) {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview'
  const setTab = (t: Tab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (t === 'overview') next.delete('tab')
        else next.set('tab', t)
        return next
      },
      { replace: true },
    )
  const [editing, setEditing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancel = useCancelEvent()
  const toast = useToast()

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.events} className="hover:text-ink">
              Events
            </Link>
            <span className="text-subtle">/</span>
            <span className="truncate text-ink-2">{e.name}</span>
          </nav>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">{e.name}</h1>
                <EventStatusBadge status={e.status} />
                <EventTypeBadge type={e.type} />
                {e.registrationOpen && <Badge tone="green">Registration open</Badge>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
                <span className="num flex items-center gap-1.5 text-ink-2">
                  <CalendarDays className="size-3.5" aria-hidden />
                  {eventWhen(e)}
                </span>
                {(e.location || e.onlineUrl) && (
                  <span className="flex items-center gap-1.5">
                    {e.location ? <MapPin className="size-3.5" aria-hidden /> : <Globe className="size-3.5" aria-hidden />}
                    {e.location || 'Online'}
                  </span>
                )}
                <span className="num flex items-center gap-1.5">
                  <CircleDollarSign className="size-3.5" aria-hidden />
                  Budget {moneyIn(e.budget, e.currency)}
                </span>
                <span className="flex items-center gap-1.5 text-ink-2">
                  <Avatar name={e.ownerName || '—'} size="xs" />
                  {e.ownerName || 'No owner'}
                </span>
                <span className="flex items-center gap-1.5" aria-label={`Team: ${e.team.map((t) => t.name).join(', ')}`}>
                  <AvatarGroup names={e.team.map((t) => t.name)} size="xs" max={5} />
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {e.canEdit && (
                <Button write variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
              )}
              {e.canManage && e.status !== 'cancelled' && e.status !== 'completed' && (
                <Button write variant="secondary" size="sm" onClick={() => setConfirmCancel(true)}>
                  <Ban />
                  Cancel event
                </Button>
              )}
            </div>
          </div>
          <Tabs<Tab>
            label="Event sections"
            value={tab}
            onChange={setTab}
            className="mt-5 overflow-x-auto border-b-0"
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'attendees', label: 'Attendees', count: e.attendeeCount },
              { id: 'leads', label: 'Leads & deals' },
              { id: 'tasks', label: 'Tasks' },
              { id: 'activity', label: 'Activity' },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 space-y-6">
          {tab === 'overview' && <Overview event={e} />}
          {tab === 'attendees' && <AttendeesTab event={e} />}
          {tab === 'leads' && <LeadsAndDeals event={e} />}
          {tab === 'tasks' && <EventTasks event={e} />}
          {tab === 'activity' && <ActivityList event={e} />}
        </div>
      </PageBody>

      {e.canEdit && <EventDrawer open={editing} onClose={() => setEditing(false)} event={e} />}
      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        size="sm"
        title="Cancel this event?"
        description="The event is kept (with its attendees and their leads) but closed: registration stops and no one can be added."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Keep it
            </Button>
            <Button
              write
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(e.id, {
                  onSuccess: () => {
                    toast.success('Event cancelled', e.name)
                    setConfirmCancel(false)
                  },
                  onError: (err) => toast.error('Not cancelled', err.message),
                })
              }
            >
              Cancel event
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">{e.name}</p>
      </Modal>
    </div>
  )
}

/* ---------------- Overview ---------------- */

function Overview({ event: e }: { event: EventDetail }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" icon={<CalendarDays />} />
          <CardBody>
            <PropertyList>
              <Property label="When">{eventWhen(e)}</Property>
              <Property label="Location">{e.location || '—'}</Property>
              <Property label="Online link">
                {e.onlineUrl ? (
                  <a href={e.onlineUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
                    {e.onlineUrl.replace(/^https?:\/\//, '')}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  '—'
                )}
              </Property>
              <Property label="Role">{e.isOrganizer ? 'We organize it' : 'We attend'}</Property>
              <Property label="Budget">{moneyIn(e.budget, e.currency)}</Property>
              <Property label="Actual cost">{moneyIn(e.actualCost, e.currency)}</Property>
              <Property label="Created">
                {fmtDate(e.createdAt)}
                {e.createdByName && ` by ${e.createdByName}`}
              </Property>
            </PropertyList>
            {e.description && <p className="mt-4 text-[0.875rem] whitespace-pre-line text-ink-2">{e.description}</p>}
          </CardBody>
        </Card>
        <RegistrationCard event={e} />
      </div>
      <TeamCard event={e} />
    </div>
  )
}

function RegistrationCard({ event: e }: { event: EventDetail }) {
  const update = useUpdateEvent()
  const toast = useToast()
  const url = e.registrationToken ? `${window.location.origin}${publicEventPath(e.registrationToken)}` : null
  const closedByStatus = e.status === 'cancelled' || e.status === 'completed'
  return (
    <Card>
      <CardHeader title="Public registration" icon={<Globe />} description="Everyone who registers becomes a lead with the source Event." />
      <CardBody className="space-y-3">
        {e.canEdit ? (
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <Switch
              checked={e.registrationOpen}
              disabled={closedByStatus || update.isPending}
              label="Registration open"
              onChange={(v) =>
                update.mutate(
                  { id: e.id, input: { registrationOpen: v } },
                  {
                    onSuccess: () => toast.success(v ? 'Registration opened' : 'Registration closed', e.name),
                    onError: (err) => toast.error('Not changed', err.message),
                  },
                )
              }
            />
            {e.registrationOpen ? 'Registration is open' : closedByStatus ? `Closed: the event is ${e.status}` : 'Registration is closed'}
          </label>
        ) : (
          <p className="text-[0.8125rem] text-muted">{e.registrationOpen ? 'Registration is open.' : 'Registration is closed.'}</p>
        )}
        {url && (
          <div className="flex flex-wrap items-center gap-2">
            <code data-testid="registration-link" className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1.5 text-xs text-ink-2">
              {url}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => toast.success('Link copied'),
                  () => toast.error('Couldn’t copy', url),
                )
              }}
            >
              <Copy />
              Copy
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Open page
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function TeamCard({ event: e }: { event: EventDetail }) {
  const users = useUsersQuery()
  const add = useAddTeamMember()
  const remove = useRemoveTeamMember()
  const toast = useToast()
  const [pick, setPick] = useState('')
  const candidates = (users.data ?? []).filter((u) => u.active !== false && !e.team.some((t) => t.userId === u.id))
  const onError = (err: Error) => toast.error('Team not changed', err.message)
  return (
    <Card className="self-start">
      <CardHeader title="Team" icon={<Users />} description="Team members see and work on this event, whatever their role." />
      <CardBody className="space-y-3">
        <ul className="space-y-2" aria-label="Team members">
          {e.team.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5">
              <Avatar name={m.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted">{m.isOwner ? 'Owner' : m.title}</p>
              </div>
              {e.canManage && !m.isOwner && (
                <Button
                  write
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={`Remove ${m.name} from the team`}
                  onClick={() => remove.mutate({ id: e.id, userId: m.userId }, { onSuccess: () => toast.success('Removed from the team', m.name), onError })}
                >
                  <UserMinus />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {e.canManage && (
          <div className="flex items-center gap-2">
            <SelectInput aria-label="Add a team member" value={pick} onChange={(ev) => setPick(ev.target.value)} className="min-w-0 flex-1">
              <option value="">Add a team member…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </SelectInput>
            <Button
              write
              size="sm"
              disabled={!pick}
              loading={add.isPending}
              onClick={() =>
                add.mutate(
                  { id: e.id, userId: pick },
                  {
                    onSuccess: () => {
                      toast.success('Added to the team', candidates.find((u) => u.id === pick)?.name)
                      setPick('')
                    },
                    onError,
                  },
                )
              }
            >
              <UserPlus />
              Add
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- Leads & deals ---------------- */

function LeadsAndDeals({ event: e }: { event: EventDetail }) {
  const stats = useEventStatsQuery(e.id)
  if (stats.isPending) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </div>
    )
  }
  if (stats.error) return <ErrorState message={stats.error.message} onRetry={() => stats.refetch()} />
  const s = stats.data
  const conversion = s.leads ? Math.round((s.dealsWon / s.leads) * 100) : 0
  return (
    <div className="space-y-6">
      <section aria-label="Event results" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attendees" icon={<Users />} value={s.attendees} hint={`${s.checkedIn} checked in`} />
        <StatCard label="Leads from this event" icon={<Target />} value={s.leads} hint={`${s.leadsCreated} new · ${s.leadsLinked} existing linked`} />
        <StatCard label="Deals won" icon={<Trophy />} value={s.dealsWon} hint={`${moneyIn(s.wonValue, s.currency)} won · ${conversion}% of leads`} />
        <StatCard
          label="Cost per lead"
          icon={<CircleDollarSign />}
          value={s.costPerLead === null ? '—' : moneyIn(s.costPerLead, s.currency)}
          hint={s.budget === null ? 'Set a budget to see it' : `Budget ${moneyIn(s.budget, s.currency)} ÷ ${s.leadsCreated} new leads`}
        />
      </section>
      <Card>
        <CardHeader title="How it’s counted" icon={<History />} />
        <CardBody className="space-y-1.5 text-[0.8125rem] text-muted">
          <p>Every registered attendee becomes a lead with the source Event, or is linked to the existing lead with the same email.</p>
          <p>
            Deals won and their value come from those leads ({moneyIn(s.pipelineValue, s.currency)} still open in the pipeline). Cost per lead = budget ÷ new leads
            {s.actualCost !== null && ` (actual cost so far ${moneyIn(s.actualCost, s.currency)})`}.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

/* ---------------- Tasks ---------------- */

function EventTasks({ event: e }: { event: EventDetail }) {
  const link = useMemo<TaskLinkView>(() => ({ type: 'event', id: e.id, label: e.name, available: true }), [e.id, e.name])
  const filters = useMemo<TaskFilter[]>(() => [{ linkType: 'event', linkId: e.id, includeDone: true }], [e.id])
  return <LinkedTasksPanel link={link} filters={filters} hideLink emptyBody="Tasks for this event (stand booking, materials, follow-ups) show here." />
}

/* ---------------- Activity ---------------- */

function ActivityList({ event: e }: { event: EventDetail }) {
  if (e.history.length === 0) return <EmptyState icon={<History />} title="No activity yet" body="Changes to the event, its team and its attendees show here." />
  return (
    <Card>
      <ol className="divide-y divide-line" aria-label="Event activity">
        {e.history.map((h) => (
          <li key={h.id} className="flex items-start gap-3 px-5 py-3">
            <Avatar name={h.userName} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] text-ink-2">
                <span className="font-medium text-ink">{h.userName}</span> · {h.summary}
              </p>
              <p className="num text-xs text-muted">{fmtDate(h.at, 'd MMM yyyy, HH:mm')}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
