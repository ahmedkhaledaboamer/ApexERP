import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getDaysInMonth } from 'date-fns'
import { Activity, CalendarDays, Crosshair, Pencil, TrendingDown, Users } from 'lucide-react'
import { EditTargetsDrawer } from '@/modules/targets/components/EditTargetsDrawer'
import { MonthSwitcher } from '@/modules/targets/components/MonthSwitcher'
import { TargetProgress } from '@/modules/targets/components/TargetProgress'
import { useEventsEnabled } from '@/modules/events/hooks/useEventsEnabled'
import { useTargetsQuery } from '@/modules/targets/hooks/useTargets'
import {
  completion,
  countedKinds,
  currentMonth,
  hasTarget,
  isTracked,
  monthLabel,
  paceTone,
  parseMonth,
  shiftMonth,
  totalsOf,
  TONE_BAR,
  TONE_HEX,
  TONE_TEXT,
} from '@/modules/targets/lib'
import {
  TARGET_KEYS,
  TARGET_LABELS,
  TARGET_SOURCES,
  type AgentTargetRow,
  type TargetKey,
  type TargetsMonth,
  type TargetValues,
} from '@/modules/targets/types'
import { EVENTS_NA_NOTE } from '@/shared/lib/features'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf, SCOPE_LABELS } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Gauge } from '@/shared/components/ui/Gauge'
import { StatCard } from '@/shared/components/ui/StatCard'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { MyCommissionsLink } from '@/modules/finance/commissions/components/MyCommissionsLink'

/** How far ahead managers may plan targets. */
const MAX_MONTHS_AHEAD = 3

const ACTIVITY_KINDS = ['calls', 'emails', 'visits', 'meetings'] as const

export default function SalesTargetsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState
          title="Sales targets aren’t part of your role"
          body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`}
        />
      </PageBody>
    )
  }
  return <SalesTargets scope={scope} />
}

function SalesTargets({ scope }: { scope: ReturnType<typeof scopeOf> }) {
  const [params, setParams] = useSearchParams()
  const thisMonth = currentMonth()
  const lastAllowed = shiftMonth(thisMonth, MAX_MONTHS_AHEAD)
  const fromUrl = params.get('month')
  const month = fromUrl && parseMonth(fromUrl) && fromUrl <= lastAllowed ? fromUrl : thisMonth
  const query = useTargetsQuery(month)
  const [editing, setEditing] = useState<string | null>(null)

  function goTo(next: string) {
    const p = new URLSearchParams(params)
    if (next === thisMonth) p.delete('month')
    else p.set('month', next)
    setParams(p, { replace: true })
  }

  const data = query.data
  const canEdit = !!data?.canEdit
  const own = scope === 'own'

  return (
    <>
      <PageHeader
        title="Sales targets"
        description={
          <>
            Monthly activity targets {own ? 'for you' : `per agent · ${SCOPE_LABELS[scope]}`}. Actuals are counted from logged activity
            automatically.
          </>
        }
        actions={
          <>
            <MonthSwitcher month={month} thisMonth={thisMonth} lastAllowed={lastAllowed} onChange={goTo} />
            <MyCommissionsLink />
            {data?.canEdit && data.rows.length > 0 && (
              <Button write onClick={() => setEditing(data.rows[0].userId)}>
                <Pencil />
                Edit targets
              </Button>
            )}
          </>
        }
      />
      <PageBody className="space-y-5">
        {query.isPending ? (
          <TargetsSkeleton />
        ) : query.isError ? (
          <Card>
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          </Card>
        ) : data!.rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users aria-hidden />}
              title="No sales agents in your scope"
              body="Targets are set per sales agent. Agents who report to you will show up here."
            />
          </Card>
        ) : (
          <div className={cn('space-y-5 transition-opacity', query.isPlaceholderData && 'opacity-60')} aria-busy={query.isFetching || undefined}>
            <Summary data={data!} />
            <Matrix data={data!} canEdit={canEdit} onEdit={setEditing} />
            {!canEdit && (
              <p className="text-center text-[0.8125rem] text-muted">
                {own ? 'Your targets are set by your sales manager.' : 'Your role can view targets but not change them.'}
              </p>
            )}
          </div>
        )}
      </PageBody>

      {canEdit && data && (
        <EditTargetsDrawer
          open={editing !== null}
          onClose={() => setEditing(null)}
          month={data.month}
          rows={data.rows}
          userId={editing ?? data.rows[0]?.userId ?? ''}
          onUserChange={setEditing}
        />
      )}
    </>
  )
}

/* ---------------- Summary ---------------- */

function Summary({ data }: { data: TargetsMonth }) {
  const eventsOn = useEventsEnabled()
  const totals = useMemo(() => totalsOf(data.rows), [data.rows])
  const overall = completion(totals.values, totals.actuals, eventsOn)
  const tone = paceTone(overall, data.elapsed)
  const perAgent = data.rows.map((r) => ({ row: r, pct: completion(r.values, r.actuals, eventsOn) }))
  const onPace = perAgent.filter((a) => paceTone(a.pct, data.elapsed) === 'green').length
  const behind = perAgent.filter((a) => paceTone(a.pct, data.elapsed) === 'red' || paceTone(a.pct, data.elapsed) === 'amber')
  const actTarget = ACTIVITY_KINDS.reduce((s, k) => s + totals.values[k], 0)
  const actActual = ACTIVITY_KINDS.reduce((s, k) => s + totals.actuals[k], 0)
  const status = monthStatus(data)
  const single = data.rows.length === 1
  const behindKinds = TARGET_KEYS.filter((k) => isBehind(k, totals.actuals[k], totals.values[k], data.elapsed, eventsOn))
  const untracked = TARGET_KEYS.filter((k) => !isTracked(k, eventsOn))

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[25rem_minmax(0,1fr)]">
      <Card className="p-1">
        <CardHeader
          className="px-5 pt-5"
          icon={<Crosshair />}
          title={<span className="text-[1.0625rem]">{single ? 'Overall completion' : 'Team completion'}</span>}
          description={
            <span className="text-[0.8125rem]" title={untracked.length ? EVENTS_NA_NOTE : undefined}>
              {monthLabel(data.month)} ·{' '}
              {untracked.length ? `excludes ${untracked.map((k) => TARGET_LABELS[k].toLowerCase()).join(', ')} (n/a)` : 'all target kinds'}
            </span>
          }
        />
        <CardBody>
          <div className="py-2">
            <Gauge percent={overall} label="of monthly targets" color={TONE_HEX[tone === 'neutral' ? 'brand' : tone]} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-sunken/70 px-2 py-2.5">
              <p className="text-xs text-muted">Expected by today</p>
              <p className="num mt-0.5 text-[0.9375rem] font-semibold">{Math.round(data.elapsed * 100)}%</p>
            </div>
            <div className="rounded-lg bg-sunken/70 px-2 py-2.5">
              <p className="text-xs text-muted">Pace</p>
              <p className={cn('mt-0.5 text-[0.9375rem] font-semibold', TONE_TEXT[tone])}>{paceLabel(tone)}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {single ? (
          <StatCard
            label="Your completion"
            icon={<Users />}
            value={`${Math.round(overall)}%`}
            hint={`${paceLabel(tone)} · expected ${Math.round(data.elapsed * 100)}% by today`}
          />
        ) : (
          <StatCard
            label="Agents on pace"
            icon={<Users />}
            value={`${onPace} / ${data.rows.length}`}
            hint={onPace === data.rows.length ? 'Everyone is on track' : 'At or ahead of where they should be today'}
          />
        )}
        <StatCard
          label={single ? 'Kinds behind pace' : 'Behind pace'}
          icon={<TrendingDown />}
          value={single ? behindKinds.length : behind.length}
          alert={(single ? behindKinds.length > 0 : behind.length > 0) && data.elapsed > 0}
          hint={
            single
              ? behindKinds.map((k) => TARGET_LABELS[k]).join(', ') || 'Nothing behind'
              : behind.length
                ? behind.map((a) => a.row.name.split(' ')[0]).join(', ')
                : 'Nobody is behind'
          }
        />
        <StatCard
          label="Activities logged"
          icon={<Activity />}
          value={actActual.toLocaleString('en-US')}
          hint={`of ${actTarget.toLocaleString('en-US')} · calls, emails, visits, meetings`}
          progress={actTarget ? Math.round((actActual / actTarget) * 100) : 0}
        />
        <StatCard label={status.label} icon={<CalendarDays />} value={status.value} hint={status.hint} />
      </div>
    </div>
  )
}

/** Kinds with no target ("No target") or not tracked yet ("n/a", events) are never behind. */
function isBehind(kind: TargetKey, actual: number, target: number, elapsed: number, eventsOn: boolean): boolean {
  if (!isTracked(kind, eventsOn) || !hasTarget(target)) return false
  const t = paceTone((actual / target) * 100, elapsed)
  return t === 'amber' || t === 'red'
}

function paceLabel(tone: ReturnType<typeof paceTone>): string {
  return { green: 'On pace', brand: 'Slightly behind', amber: 'Behind', red: 'Well behind', neutral: 'Not started' }[tone]
}

function monthStatus(data: TargetsMonth): { label: string; value: string; hint: string } {
  if (data.elapsed >= 1) return { label: 'Month', value: 'Closed', hint: 'Final figures for the month' }
  if (data.elapsed <= 0) return { label: 'Month', value: 'Upcoming', hint: 'Targets can be set ahead of time' }
  const d = parseMonth(data.month) ?? new Date()
  const total = getDaysInMonth(d)
  const left = Math.max(0, total - Math.round(data.elapsed * total))
  return { label: 'Days left', value: String(left), hint: `of ${total} in ${monthLabel(data.month).split(' ')[0]}` }
}

/* ---------------- Matrix ---------------- */

function Matrix({ data, canEdit, onEdit }: { data: TargetsMonth; canEdit: boolean; onEdit: (userId: string) => void }) {
  const eventsOn = useEventsEnabled()
  const { values: totalValues, actuals: totalActuals } = totalsOf(data.rows)
  const showTotals = data.rows.length > 1

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-[0.9375rem] font-semibold">Targets by agent</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">Actual / target for {monthLabel(data.month)}</p>
        </div>
        <Legend elapsed={data.elapsed} />
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[75rem] border-collapse text-[0.8125rem]">
          <thead>
            <tr className="border-b border-line bg-sunken/50 text-start text-xs font-medium text-muted">
              <th scope="col" className="sticky start-0 z-10 w-[13.75rem] bg-sunken px-5 py-2.5 font-medium">
                Agent
              </th>
              {TARGET_KEYS.map((k) => (
                <th key={k} scope="col" className="px-3 py-2.5 font-medium" title={isTracked(k, eventsOn) ? TARGET_SOURCES[k] : EVENTS_NA_NOTE}>
                  {TARGET_LABELS[k]}
                </th>
              ))}
              <th
                scope="col"
                className="px-3 py-2.5 font-medium"
                title="Average completion across counted kinds with a target, each capped at 100% (events excluded until enabled)"
              >
                Overall
              </th>
              {canEdit && (
                <th scope="col" className="w-16 px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => (
              <AgentRow key={r.userId} row={r} elapsed={data.elapsed} canEdit={canEdit} onEdit={onEdit} />
            ))}
          </tbody>
          {showTotals && (
            <tfoot>
              <tr className="border-t border-line-strong bg-sunken/40">
                <th scope="row" className="sticky start-0 z-10 bg-sunken px-5 py-3 text-start text-[0.8125rem] font-semibold">
                  Team total
                  <span className="block text-xs font-normal text-muted">{data.rows.length} agents</span>
                </th>
                {TARGET_KEYS.map((k) => (
                  <td key={k} className="px-3 py-3 align-middle">
                    <TargetProgress kind={k} actual={totalActuals[k]} target={totalValues[k]} elapsed={data.elapsed} />
                  </td>
                ))}
                <td className="px-3 py-3">
                  <OverallCell values={totalValues} actuals={totalActuals} elapsed={data.elapsed} />
                </td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}

function AgentRow({ row, elapsed, canEdit, onEdit }: { row: AgentTargetRow; elapsed: number; canEdit: boolean; onEdit: (id: string) => void }) {
  return (
    <tr className="group transition-colors hover:bg-hover/50">
      <th scope="row" className="sticky start-0 z-10 bg-surface px-5 py-3 text-start font-normal group-hover:bg-hover">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={row.name} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.name}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted">
              <span className="truncate">{row.title}</span>
              {row.isDefault && (
                <Badge variant="outline" className="h-[1.125rem] px-1 text-[0.625rem]">
                  Default
                </Badge>
              )}
            </p>
          </div>
        </div>
      </th>
      {TARGET_KEYS.map((k) => (
        <td key={k} className="px-3 py-3 align-middle">
          <TargetProgress kind={k} actual={row.actuals[k]} target={row.values[k]} elapsed={elapsed} />
        </td>
      ))}
      <td className="px-3 py-3">
        <OverallCell values={row.values} actuals={row.actuals} elapsed={elapsed} />
      </td>
      {canEdit && (
        <td className="px-3 py-3 text-end">
          <Button write variant="ghost" size="sm" iconOnly aria-label={`Edit targets for ${row.name}`} title="Edit targets" onClick={() => onEdit(row.userId)}>
            <Pencil />
          </Button>
        </td>
      )}
    </tr>
  )
}

function OverallCell({ values, actuals, elapsed }: { values: TargetValues; actuals: TargetValues; elapsed: number }) {
  const eventsOn = useEventsEnabled()
  if (!countedKinds(values, eventsOn).length) return <span className="text-xs text-subtle">No targets</span>
  const pct = completion(values, actuals, eventsOn)
  const tone = paceTone(pct, elapsed)
  return (
    <div className="min-w-[6rem]">
      <p className={cn('num text-[0.9375rem] font-semibold', TONE_TEXT[tone])}>{Math.round(pct)}%</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full', TONE_BAR[tone])} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

function Legend({ elapsed }: { elapsed: number }) {
  const items: [keyof typeof TONE_BAR, string][] = [
    ['green', 'On pace'],
    ['brand', '70%+ of pace'],
    ['amber', '40%+'],
    ['red', 'Under 40%'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {items.map(([tone, label]) => (
        <span key={tone} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('h-1.5 w-3 rounded-full', TONE_BAR[tone])} />
          {label}
        </span>
      ))}
      {elapsed > 0 && elapsed < 1 && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-px bg-ink/40" />
          Where you should be today
        </span>
      )}
    </div>
  )
}

/* ---------------- Loading ---------------- */

function TargetsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading targets" className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[25rem_minmax(0,1fr)]">
        <Skeleton className="h-[21.25rem] rounded-card" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[9.375rem] rounded-card" />
          ))}
        </div>
      </div>
      <Card className="p-5">
        <Skeleton className="mb-4 h-4 w-40" />
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3.5 w-36" />
              {Array.from({ length: 6 }, (_, j) => (
                <Skeleton key={j} className="hidden h-6 flex-1 md:block" />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
