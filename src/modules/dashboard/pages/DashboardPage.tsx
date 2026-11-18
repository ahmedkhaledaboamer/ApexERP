import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Download,
  Clock,
  Crosshair,
  Percent,
  Scale,
  TrendingUp,
  UserPlus,
} from 'lucide-react'
import type { DashboardPeriod, DashboardSummary, Role } from '@/shared/types'
import { leadPath, PATHS } from '@/app/paths'
import { getDashboardSummary } from '@/modules/dashboard/api/dashboardApi'
import { dashboardKeys } from '@/modules/dashboard/queryKeys'
import { MyTasksCard, TaskStats } from '@/modules/dashboard/components/TaskWidgets'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { FollowUpLabel, followUpState } from '@/modules/leads/components/FollowUpLabel'
import type { LeadRow } from '@/modules/leads/types'
import { isTracked } from '@/modules/targets/lib'
import { TargetNotTracked } from '@/modules/targets/components/TargetProgress'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtCompactMoney } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Gauge } from '@/shared/components/ui/Gauge'
import { pctChange, StatCard } from '@/shared/components/ui/StatCard'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { Tabs } from '@/shared/components/ui/Tabs'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { Button } from '@/shared/components/ui/Button'
import { Segmented, type SegmentedOption } from '@/shared/components/ui/Segmented'
import { useRegion } from '@/modules/tenancy/hooks'
import { OnboardingChecklist } from '@/modules/onboarding/OnboardingChecklist'

const C = { brand: 'var(--color-brand-600)', blue: '#2563eb', green: '#10b981', amber: '#f59e0b', grey: '#d4d4d0' }

const PERIODS: SegmentedOption<DashboardPeriod>[] = [
  { value: '30d', label: '30 days' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'ytd', label: 'YTD' },
  { value: '12m', label: '12 months' },
]

/** Spec: agent, manager and management dashboards. Data scope still comes from permissions. */
function dashboardFor(role: Role, scope: ReturnType<typeof scopeOf>): { title: string; subject: string } {
  if (role === 'Management' || role === 'Company Admin') return { title: 'Management dashboard', subject: 'the company is' }
  if (role === 'Sales Manager' || role === 'Department Head') return { title: 'Manager dashboard', subject: 'your team is' }
  if (scope === 'own') return { title: 'My dashboard', subject: 'your pipeline is' }
  return { title: 'Sales overview', subject: 'sales are' }
}

export default function DashboardPage() {
  const user = useCurrentUser()
  const [params, setParams] = useSearchParams()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  const raw = params.get('period')
  const period: DashboardPeriod = PERIODS.some((p) => p.value === raw) ? (raw as DashboardPeriod) : '12m'
  const { title, subject } = dashboardFor(user.role, scope)

  function setPeriod(next: DashboardPeriod) {
    const q = new URLSearchParams(params)
    if (next === '12m') q.delete('period')
    else q.set('period', next)
    setParams(q, { replace: true })
  }

  return (
    <>
      <PrintStyles />
      <PageHeader
        title={scope === 'hidden' ? 'Dashboard' : title}
        description={
          <>
            {greeting()}, {user.name.split(' ')[0]}
            {scope === 'hidden' ? '.' : ` — here’s how ${subject} performing.`}
            <span className="hidden print:inline"> · {PERIODS.find((p) => p.value === period)?.label} · {format(new Date(), 'd MMM yyyy')}</span>
          </>
        }
        actions={
          scope !== 'hidden' && (
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <Segmented label="Dashboard period" options={PERIODS} value={period} onChange={setPeriod} />
              <Button variant="secondary" size="lg" className="h-11 rounded-xl px-4 text-[0.875rem]" onClick={() => window.print()}>
                <Download />
                Export PDF
              </Button>
            </div>
          )
        }
      />
      <PageBody>
        <OnboardingChecklist className="mb-6" />
        {scope === 'hidden' ? (
          <TasksOnlyDashboard userId={user.id} role={user.role} showTasks={scopeOf(user.role, 'tasks') !== 'hidden'} />
        ) : (
          <SalesDashboard userId={user.id} period={period} />
        )}
      </PageBody>
    </>
  )
}

function SalesDashboard({ userId, period }: { userId: string; period: DashboardPeriod }) {
  const summary = useQuery({
    queryKey: dashboardKeys.summary(userId, period),
    queryFn: () => getDashboardSummary(period),
    placeholderData: keepPreviousData,
  })
  const leads = useLeadsQuery()

  if (summary.isPending) return <DashboardSkeleton />
  if (summary.isError) {
    return (
      <Card>
        <ErrorState message={summary.error.message} onRetry={() => summary.refetch()} />
      </Card>
    )
  }
  const d = summary.data
  const series = d.series

  return (
    <div className={cn('space-y-5 transition-opacity duration-150', summary.isPlaceholderData && 'opacity-60')} aria-busy={summary.isFetching}>
      {/* Money row */}
      <section aria-label="Sales figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Won revenue"
          icon={<CircleDollarSign />}
          value={fmtCompactMoney(d.wonValue)}
          delta={pctChange(d.wonValue, d.wonValuePrev)}
          spark={series.map((m) => m.wonValue)}
          sparkColor={C.green}
        />
        <StatCard
          label="Open pipeline"
          icon={<TrendingUp />}
          value={fmtCompactMoney(d.openPipelineValue)}
          hint={`${d.openLeads} open leads`}
          spark={series.map((m) => m.created)}
          sparkColor={C.brand}
          to={PATHS.pipeline}
        />
        <StatCard
          label="Weighted forecast"
          icon={<Scale />}
          value={fmtCompactMoney(d.weightedForecast)}
          hint="Value × stage probability"
          spark={series.map((m) => m.wonValue * 0.6 + m.created * 9000)}
          sparkColor={C.blue}
        />
        <StatCard
          label="New leads"
          icon={<UserPlus />}
          value={d.newLeads}
          delta={pctChange(d.newLeads, d.newLeadsPrev)}
          spark={series.map((m) => m.created)}
          sparkColor={C.amber}
          to={PATHS.leads}
        />
      </section>

      {/* Work row */}
      <section aria-label="Follow-ups and activity" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Follow-ups today" icon={<CalendarClock />} value={d.followUpsDueToday} hint="Due before end of day" to="/follow-ups" />
        <StatCard
          label="Overdue follow-ups"
          icon={<AlertTriangle />}
          value={d.followUpsOverdue}
          alert={d.followUpsOverdue > 0}
          hint={d.followUpsOverdue > 0 ? 'Agents get a daily reminder' : 'Nothing overdue'}
          to="/follow-ups"
        />
        <StatCard
          label="Activities logged"
          icon={<Activity />}
          value={d.activities}
          delta={pctChange(d.activities, d.activitiesPrev)}
        />
        <StatCard label="Lead → won" icon={<Percent />} value={`${d.winRate}%`} hint={`${d.wonCount} won of ${d.closedCount} closed`} />
      </section>

      {d.tasks.scope !== 'hidden' && <TaskRow data={d} />}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_26.25rem]">
        <TrendCard data={d} />
        <TargetCard data={d} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[26.25rem_minmax(0,1fr)]">
        <StageCard leads={leads.data} loading={leads.isPending} />
        <AttentionCard leads={leads.data} loading={leads.isPending} />
      </div>
    </div>
  )
}

/* ---------------- Tasks ---------------- */

/** My tasks card + overdue / due-this-week stats, from the shared task selectors. */
function TaskRow({ data }: { data: DashboardSummary }) {
  return (
    <section aria-label="Tasks" className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <MyTasksCard data={data.tasks} />
      <div className="grid grid-cols-1 content-start gap-5 sm:grid-cols-2 xl:grid-cols-1">
        <TaskStats data={data.tasks} />
      </div>
    </section>
  )
}

/** Roles without sales access: the dashboard shows their tasks only. */
function TasksOnlyDashboard({ userId, role, showTasks }: { userId: string; role: Role; showTasks: boolean }) {
  const summary = useQuery({
    queryKey: dashboardKeys.summary(userId, '12m'),
    queryFn: () => getDashboardSummary('12m'),
    enabled: showTasks,
  })
  const noSales = (
    <Card>
      <EmptyState title="No sales figures for your role" body={`As ${role}, your dashboard fills in as HR and your other modules come online.`} />
    </Card>
  )
  if (!showTasks) return noSales
  if (summary.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading dashboard" className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-card" />
        <div className="space-y-5">
          <Skeleton className="h-36 rounded-card" />
          <Skeleton className="h-36 rounded-card" />
        </div>
      </div>
    )
  }
  if (summary.isError) {
    return (
      <Card>
        <ErrorState message={summary.error.message} onRetry={() => summary.refetch()} />
      </Card>
    )
  }
  return (
    <div className="space-y-5">
      <TaskRow data={summary.data} />
      {noSales}
    </div>
  )
}

/* ---------------- Trend chart ---------------- */

type TrendView = 'leads' | 'revenue'

function TrendCard({ data }: { data: DashboardSummary }) {
  const wonLabel = `Won (${useRegion().currency})`
  const [view, setView] = useState<TrendView>('leads')
  return (
    <Card className="p-1">
      <CardHeader
        className="px-5 pt-5"
        title={<span className="text-[1.0625rem]">{view === 'leads' ? 'Leads added, won & activity' : 'Revenue won'}</span>}
        description={<span className="text-[0.8125rem]">{data.periodLabel}</span>}
        action={
          <Tabs<TrendView>
            variant="pill"
            label="Chart view"
            value={view}
            onChange={setView}
            items={[
              { id: 'leads', label: 'Leads' },
              { id: 'revenue', label: 'Revenue' },
            ]}
          />
        }
      />
      <div className="flex flex-wrap gap-4 px-5 text-[0.8125rem] text-ink-2">
        {view === 'leads' ? (
          <>
            <Legend color={C.brand} label="Added" />
            <Legend color={C.grey} label="Won" />
            <Legend color={C.green} label="Activities" line />
          </>
        ) : (
          <>
            <Legend color={C.brand} label={wonLabel} />
            <Legend color={C.green} label="Deals won" line />
          </>
        )}
      </div>
      <CardBody className="pt-3">
        <div dir="ltr" className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={4}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} tickLine={false} axisLine={false} tick={{ fill: '#8e8e99', fontSize: '0.75rem' }} />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                width={view === 'revenue' ? 72 : 36}
                tick={{ fill: '#8e8e99', fontSize: '0.75rem' }}
                tickFormatter={(v: number) => (view === 'revenue' ? fmtCompactMoney(v) : String(v))}
              />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                formatter={(value: number, name: string) => (name === wonLabel ? fmtCompactMoney(value) : value)}
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-line)',
                  borderRadius: 10,
                  color: 'var(--color-ink)',
                  fontSize: '0.75rem',
                  boxShadow: 'var(--shadow-pop)',
                }}
              />
              {view === 'leads' ? (
                <>
                  <Bar yAxisId="left" dataKey="created" name="Added" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar yAxisId="left" dataKey="won" name="Won" fill={C.grey} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Line yAxisId="right" type="monotone" dataKey="activities" name="Activities" stroke={C.green} strokeWidth={2} dot={false} />
                </>
              ) : (
                <>
                  <Bar yAxisId="left" dataKey="wonValue" name={wonLabel} fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={30} />
                  <Line yAxisId="right" type="monotone" dataKey="won" name="Deals won" stroke={C.green} strokeWidth={2} dot={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  )
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={line ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-full'} style={{ background: color }} aria-hidden />
      {label}
    </span>
  )
}

/* ---------------- Target vs actual ---------------- */

function TargetCard({ data }: { data: DashboardSummary }) {
  // A target of 0 means "no target": those kinds are hidden and don't move the gauge. Kinds not
  // tracked yet (events, until EVENTS_ENABLED) show "n/a" and never count, even with a target.
  const set = data.targets.filter((t) => t.target > 0 && isTracked(t.key))
  const notTracked = data.targets.filter((t) => t.target > 0 && !isTracked(t.key))
  const actual = set.reduce((s, t) => s + t.actual, 0)
  const target = set.reduce((s, t) => s + t.target, 0)
  const pct = target ? (actual / target) * 100 : 0
  return (
    <Card className="p-1">
      <CardHeader
        className="px-5 pt-5"
        icon={<Crosshair />}
        title={<span className="text-[1.0625rem]">Activity target vs. actual</span>}
        description={<span className="text-[0.8125rem]">{format(new Date(), 'MMMM')} · all activity targets</span>}
      />
      <CardBody>
        <div className="py-2">
          <Gauge percent={pct} label="of monthly target" color={pct >= 100 ? C.green : C.brand} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ['Actual', actual],
            ['Target', target],
            ['Gap', Math.max(0, target - actual)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-sunken/70 px-2 py-2.5">
              <p className="text-xs text-muted">{label}</p>
              <p className="num mt-0.5 text-[0.9375rem] font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <ul className="mt-5 space-y-3">
          {set.length === 0 && <li className="text-[0.8125rem] text-muted">No activity targets set for this month.</li>}
          {set.map((t) => {
            const p = t.target ? Math.round((t.actual / t.target) * 100) : 0
            return (
              <li key={t.key}>
                <div className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-ink-2">{t.label}</span>
                  <span className="num text-muted">
                    <span className="font-medium text-ink">{t.actual}</span> / {t.target}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className={cn('h-full rounded-full', p >= 100 ? 'bg-success-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, p)}%` }} />
                </div>
              </li>
            )
          })}
          {notTracked.map((t) => (
            <li key={t.key}>
              <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                <span className="text-ink-2">{t.label}</span>
                <TargetNotTracked target={t.target} />
              </div>
              <div aria-hidden className="mt-1.5 h-1.5 rounded-full border border-dashed border-line" />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

/* ---------------- Pipeline by stage ---------------- */

function StageCard({ leads, loading }: { leads?: LeadRow[]; loading: boolean }) {
  const lookups = useLookups()
  // Active open stages in their configured order, then parked ones (e.g. Cold) at the end.
  const rows = useMemo(() => {
    const stages = lookups.statuses.filter((s) => s.kind === 'open' || s.kind === 'parked')
    return stages.map((s) => {
      const inStage = (leads ?? []).filter((l) => l.status === s.key)
      return {
        status: s.key,
        label: s.kind === 'parked' ? `${s.label} (parked)` : s.label,
        color: s.color,
        count: inStage.length,
        value: inStage.reduce((t, l) => t + l.value, 0),
      }
    })
  }, [leads, lookups])
  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <Card className="p-1">
      <CardHeader className="px-5 pt-5" title={<span className="text-[1.0625rem]">Pipeline by stage</span>} description="Open leads per stage" />
      <CardBody>
        {loading || lookups.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3.5">
            {rows.map((r) => (
              <li key={r.status}>
                <div className="flex items-center justify-between text-[0.8125rem]">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
                    {r.label}
                  </span>
                  <span className="num text-muted">
                    <span className="font-medium text-ink">{r.count}</span>
                    {r.value > 0 && ` · ${fmtCompactMoney(r.value)}`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(r.count / max) * 100}%`, background: r.color }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- Needs attention ---------------- */

function AttentionCard({ leads, loading }: { leads?: LeadRow[]; loading: boolean }) {
  const { closedStatusKeys } = useLookups()
  const due = useMemo(
    () =>
      (leads ?? [])
        .filter((l) => ['overdue', 'today'].includes(followUpState(l.nextFollowUpDate, l.status, closedStatusKeys)))
        .sort((a, b) => (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? ''))
        .slice(0, 8),
    [leads, closedStatusKeys],
  )

  return (
    <Card className="p-1">
      <CardHeader
        className="px-5 pt-5"
        icon={<Clock />}
        title={<span className="text-[1.0625rem]">Needs attention</span>}
        description="Follow-ups overdue or due today"
        action={
          <Link to={PATHS.leads} className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
            View all
          </Link>
        }
      />
      {loading ? (
        <CardBody className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </CardBody>
      ) : due.length === 0 ? (
        <EmptyState title="You’re all caught up" body="No follow-ups are overdue or due today." className="py-10" />
      ) : (
        <ul className="divide-y divide-line px-1 pb-1">
          {due.map((l) => (
            <li key={l.id}>
              <Link to={leadPath(l.id)} className="flex h-14 items-center gap-3 rounded-lg px-4 text-[0.875rem] hover:bg-hover/70">
                <Avatar name={l.company} size="md" square />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.company}</span>
                  <span className="block truncate text-xs text-muted">{l.nextStep || l.contactName}</span>
                </span>
                <span className="hidden lg:block">
                  <StatusBadge status={l.status} />
                </span>
                <span className="hidden w-36 items-center gap-1.5 text-[0.8125rem] text-ink-2 md:flex">
                  <Avatar name={l.ownerName} size="xs" />
                  <span className="truncate">{l.ownerName}</span>
                </span>
                <span className="w-28 text-end text-[0.8125rem]">
                  <FollowUpLabel date={l.nextFollowUpDate} status={l.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-5">
      {[0, 1].map((row) => (
        <div key={row} className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-card" />
          ))}
        </div>
      ))}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_26.25rem]">
        <Skeleton className="h-[26rem] rounded-card" />
        <Skeleton className="h-[26rem] rounded-card" />
      </div>
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
