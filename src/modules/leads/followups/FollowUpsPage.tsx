import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, differenceInCalendarDays, endOfDay, format, isTomorrow, startOfDay } from 'date-fns'
import { AlertTriangle, CalendarCheck, CalendarClock, CalendarOff, CalendarRange, PartyPopper, X } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { followUpState } from '@/modules/leads/components/FollowUpLabel'
import { LogActivityModal } from '@/modules/leads/components/LogActivityModal'
import { useLeadsQuery, useUpdateLead } from '@/modules/leads/hooks/useLeads'
import type { LeadRow } from '@/modules/leads/types'
import { useCurrentUser } from '@/store/hooks'
import { can, scopeOf, SCOPE_LABELS } from '@/shared/lib/permissions'
import { useLookups } from '@/shared/hooks/useLookups'
import { useLeadAlerts } from '@/modules/alerts/hooks/useAlerts'
import { toDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, SelectInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { FollowUpRow } from './FollowUpRow'

type View = 'overdue' | 'today' | 'upcoming' | 'none'

const VIEWS: View[] = ['overdue', 'today', 'upcoming', 'none']

const UPCOMING_DAYS = 7

interface Group {
  id: string
  label: string
  tone?: 'danger' | 'warning' | 'brand'
  leads: LeadRow[]
}

/** Which bucket an open lead falls in; `null` for closed leads and follow-ups beyond the week. */
function bucketOf(lead: LeadRow, horizon: Date, closedKeys: readonly string[]): View | null {
  if (closedKeys.includes(lead.status)) return null
  const state = followUpState(lead.nextFollowUpDate, lead.status, closedKeys)
  if (state === 'upcoming') {
    const d = toDate(lead.nextFollowUpDate)
    return d && d <= horizon ? 'upcoming' : null
  }
  return state
}

export default function FollowUpsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState
          title="Follow-ups aren’t part of your role"
          body={`${user.role} has no access to Sales & CRM. Ask a System Admin if you need it.`}
        />
      </PageBody>
    )
  }
  return <FollowUps scope={scope} canEdit={can(user.role, 'sales', 'edit')} />
}

function FollowUps({ scope, canEdit }: { scope: ReturnType<typeof scopeOf>; canEdit: boolean }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const view = (VIEWS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as View) : 'overdue'
  const search = params.get('q') ?? ''
  const owner = params.get('owner') ?? ''
  const showOwnerFilter = scope !== 'own'

  const query = useLeadsQuery()
  const update = useUpdateLead()
  const lookups = useLookups()
  const leadAlerts = useLeadAlerts()
  const closedKeys = lookups.closedStatusKeys
  const [logFor, setLogFor] = useState<LeadRow | null>(null)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const all = useMemo(() => query.data ?? [], [query.data])
  const owners = useMemo(() => [...new Map(all.map((l) => [l.ownerId, l.ownerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all])

  // Owner and search narrow everything, KPIs included, so the numbers match the list.
  const narrowed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(
      (l) =>
        (!owner || l.ownerId === owner) &&
        (!q || [l.company, l.contactName, l.contactEmail, l.mobile, l.nextStep, l.ownerName].join(' ').toLowerCase().includes(q)),
    )
  }, [all, owner, search])

  const buckets = useMemo(() => {
    const horizon = endOfDay(addDays(new Date(), UPCOMING_DAYS))
    const out: Record<View, LeadRow[]> = { overdue: [], today: [], upcoming: [], none: [] }
    for (const l of narrowed) {
      const b = bucketOf(l, horizon, closedKeys)
      if (b) out[b].push(l)
    }
    const byDate = (a: LeadRow, b: LeadRow) =>
      (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? '') || a.company.localeCompare(b.company)
    for (const v of VIEWS) out[v].sort(v === 'none' ? (a, b) => b.createdAt.localeCompare(a.createdAt) : byDate)
    return out
  }, [narrowed, closedKeys])

  const groups = useMemo(() => groupsFor(view, buckets[view]), [view, buckets])
  const filtered = !!search || !!owner

  function reschedule(lead: LeadRow, iso: string, label: string) {
    update.mutate(
      { id: lead.id, input: { nextFollowUpDate: iso } },
      {
        onSuccess: () => toast.success('Follow-up rescheduled', `${lead.company} moved to ${label}.`),
        onError: (e) => toast.error('Couldn’t reschedule', e.message),
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={
          <>
            Today’s and overdue follow-ups{scope === 'own' ? ' for your leads' : ` · ${SCOPE_LABELS[scope]}`}. Log what happened, then set the next date.
          </>
        }
        actions={
          <Link
            to={PATHS.pipeline}
            className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-[0.8125rem] font-medium text-ink shadow-xs hover:bg-hover"
          >
            Open pipeline
          </Link>
        }
      />
      <PageBody className="space-y-5">
        {/* KPIs */}
        <section aria-label="Follow-up summary" className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
          {query.isPending || lookups.isLoading ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[7.75rem] rounded-card" />)
          ) : (
            <>
              <StatCard
                label="Overdue"
                icon={<AlertTriangle />}
                value={buckets.overdue.length}
                alert={buckets.overdue.length > 0}
                hint={buckets.overdue.length ? `${buckets.overdue.filter((l) => daysLate(l) >= 3).length} are 3+ days late` : 'Nothing overdue'}
                to={tabHref(params, 'overdue')}
              />
              <StatCard label="Due today" icon={<CalendarClock />} value={buckets.today.length} hint={format(new Date(), 'EEEE d MMM')} to={tabHref(params, 'today')} />
              <StatCard label="Upcoming this week" icon={<CalendarRange />} value={buckets.upcoming.length} hint={`Next ${UPCOMING_DAYS} days`} to={tabHref(params, 'upcoming')} />
              <StatCard
                label="Without a follow-up date"
                icon={<CalendarOff />}
                value={buckets.none.length}
                hint="Open leads with no next date"
                to={tabHref(params, 'none')}
              />
            </>
          )}
        </section>

        <Card className="overflow-visible">
          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5 md:flex-row md:items-center">
            <div className="-mx-1 overflow-x-auto px-1">
              <Tabs<View>
                variant="pill"
                label="Follow-up view"
                value={view}
                onChange={(v) => setParam('tab', v === 'overdue' ? '' : v)}
                items={[
                  { id: 'overdue', label: 'Overdue', count: buckets.overdue.length },
                  { id: 'today', label: 'Today', count: buckets.today.length },
                  { id: 'upcoming', label: 'Upcoming', count: buckets.upcoming.length },
                  { id: 'none', label: 'No date', count: buckets.none.length },
                ]}
              />
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
              <SearchInput
                aria-label="Search follow-ups"
                value={search}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search company, contact, mobile…"
                className="w-full sm:w-64"
              />
              {showOwnerFilter && (
                <div className="flex items-center gap-2">
                  {owner && <Avatar name={owners.find(([id]) => id === owner)?.[1] ?? ''} size="sm" />}
                  <SelectInput
                    aria-label="Filter by owner"
                    value={owner}
                    onChange={(e) => setParam('owner', e.target.value)}
                    className="h-8 w-48 rounded-md"
                  >
                    <option value="">All owners</option>
                    {owners.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </SelectInput>
                </div>
              )}
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.delete('q')
                    next.delete('owner')
                    setParams(next, { replace: true })
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
            </div>
          </div>

          {/* List */}
          <div id={`tab-panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`}>
            {query.isPending || lookups.isLoading ? (
              <ListSkeleton />
            ) : query.isError ? (
              <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
            ) : groups.length === 0 ? (
              <EmptyFor view={view} filtered={filtered} />
            ) : (
              groups.map((g) => (
                <section key={g.id} aria-label={g.label}>
                  <h2 className="flex items-center gap-2 border-b border-line bg-sunken/50 px-4 py-2 text-xs font-semibold text-ink-2 sm:px-5">
                    <span
                      aria-hidden
                      className={
                        g.tone === 'danger'
                          ? 'size-1.5 rounded-full bg-danger-500'
                          : g.tone === 'warning'
                            ? 'size-1.5 rounded-full bg-warning-500'
                            : g.tone === 'brand'
                              ? 'size-1.5 rounded-full bg-brand-500'
                              : 'size-1.5 rounded-full bg-subtle'
                      }
                    />
                    {g.label}
                    <span className="num font-normal text-muted">{g.leads.length}</span>
                  </h2>
                  <ul className="divide-y divide-line">
                    {g.leads.map((l) => (
                      <FollowUpRow
                        key={l.id}
                        lead={l}
                        alerts={leadAlerts.get(l.id)}
                        canEdit={canEdit}
                        showOwner={scope !== 'own'}
                        rescheduling={update.isPending && update.variables?.id === l.id}
                        onLog={setLogFor}
                        onReschedule={reschedule}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </Card>
        {!canEdit && !query.isPending && (
          <p className="text-center text-[0.8125rem] text-muted">Your role can view follow-ups but not log activity or reschedule them.</p>
        )}
      </PageBody>

      {logFor && (
        <LogActivityModal
          open
          leadId={logFor.id}
          doNotContact={logFor.doNotContact}
          onClose={() => setLogFor(null)}
          onLogged={(activity) => {
            if (!activity.autoStatus) toast.success('Activity logged', `Added to ${logFor.company}’s timeline. Reschedule if there’s a next step.`)
          }}
        />
      )}
    </>
  )
}

/* ---------------- Grouping ---------------- */

function daysLate(lead: LeadRow): number {
  const d = toDate(lead.nextFollowUpDate)
  return d ? differenceInCalendarDays(startOfDay(new Date()), d) : 0
}

function groupsFor(view: View, leads: LeadRow[]): Group[] {
  if (leads.length === 0) return []
  if (view === 'overdue') {
    // Most late first, so the worst ones are at the top.
    const late3 = leads.filter((l) => daysLate(l) >= 3)
    const late2 = leads.filter((l) => daysLate(l) === 2)
    const late1 = leads.filter((l) => daysLate(l) <= 1)
    return [
      { id: 'late-3', label: '3+ days late', tone: 'danger' as const, leads: late3 },
      { id: 'late-2', label: '2 days late', tone: 'warning' as const, leads: late2 },
      { id: 'late-1', label: '1 day late', tone: 'warning' as const, leads: late1 },
    ].filter((g) => g.leads.length > 0)
  }
  if (view === 'today') return [{ id: 'today', label: `Today · ${format(new Date(), 'EEEE d MMM')}`, tone: 'brand', leads }]
  if (view === 'none') return [{ id: 'none', label: 'No follow-up date set', leads }]
  const byDay = new Map<string, LeadRow[]>()
  for (const l of leads) {
    const d = toDate(l.nextFollowUpDate)
    if (!d) continue
    const dayKey = format(d, 'yyyy-MM-dd')
    byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), l])
  }
  return [...byDay.entries()].map(([day, list]) => {
    const d = new Date(`${day}T00:00:00`)
    return { id: day, label: isTomorrow(d) ? `Tomorrow · ${format(d, 'EEEE d MMM')}` : format(d, 'EEEE d MMM'), leads: list }
  })
}

function tabHref(params: URLSearchParams, view: View): string {
  const next = new URLSearchParams(params)
  if (view === 'overdue') next.delete('tab')
  else next.set('tab', view)
  const s = next.toString()
  return s ? `?${s}` : '?'
}

/* ---------------- States ---------------- */

function EmptyFor({ view, filtered }: { view: View; filtered: boolean }) {
  if (filtered) {
    return <EmptyState title="No follow-ups match" body="Try another search or show all owners." />
  }
  const copy: Record<View, { title: string; body: string; icon: ReactNode }> = {
    overdue: { title: 'Nothing overdue', body: 'Every follow-up is on time. Nice work.', icon: <PartyPopper aria-hidden /> },
    today: { title: 'No follow-ups due today', body: 'Check what’s overdue or coming up this week.', icon: <CalendarCheck aria-hidden /> },
    upcoming: { title: 'Nothing in the next 7 days', body: 'Follow-ups you schedule for this week will show up here.', icon: <CalendarRange aria-hidden /> },
    none: { title: 'Every open lead has a date', body: 'Open leads without a next follow-up date show up here.', icon: <CalendarCheck aria-hidden /> },
  }
  const c = copy[view]
  return <EmptyState title={c.title} body={c.body} icon={c.icon} />
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading follow-ups" className="divide-y divide-line">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="hidden h-5 w-20 lg:block" />
          <Skeleton className="hidden h-3.5 w-56 lg:block" />
          <Skeleton className="h-8 w-40" />
        </div>
      ))}
    </div>
  )
}
