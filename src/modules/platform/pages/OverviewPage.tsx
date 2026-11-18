import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CircleDollarSign, TrendingDown, UserPlus, Users } from 'lucide-react'
import type { CountBy, PlatformOverview } from '@/modules/platform/types'
import { useOverview } from '@/modules/platform/hooks'
import { platformCompanyPath } from '@/modules/platform/permissions'
import { fmtDate, fmtDateTime, fmtMoney } from '@/modules/platform/format'
import { LIMIT_LABEL } from '@/modules/billing/gating'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { cn } from '@/shared/lib/utils'

const nf = new Intl.NumberFormat('en')

/** Platform overview: KPIs, distribution bars, weekly sign-ups and the lists that need attention. */
export default function OverviewPage() {
  const query = useOverview()
  return (
    <>
      <PageHeader
        title="Overview"
        description={query.data ? `All companies on the platform · updated ${fmtDateTime(query.data.generatedAt)}` : 'All companies on the platform'}
      />
      <PageBody className="space-y-5">
        {query.isPending ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-32 rounded-card" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-card" />
          </>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <OverviewBody o={query.data} />
        )}
      </PageBody>
    </>
  )
}

function OverviewBody({ o }: { o: PlatformOverview }) {
  return (
    <>
      <div id="overview-kpis" className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', o.mrr !== null ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
        <div id="kpi-companies" data-value={o.totals.companies}>
          <StatCard label="Companies" value={nf.format(o.totals.companies)} icon={<Building2 />} hint="All statuses" />
        </div>
        <div id="kpi-active-users" data-value={o.totals.activeUsers}>
          <StatCard label="Active users" value={nf.format(o.totals.activeUsers)} icon={<Users />} hint="Across all companies" />
        </div>
        {o.mrr !== null && (
          <div id="kpi-mrr" data-value={o.mrr}>
            <StatCard label="MRR" value={fmtMoney(o.mrr, o.currency)} icon={<CircleDollarSign />} hint="Monthly recurring revenue" />
          </div>
        )}
        <div id="kpi-signups" data-value={o.signupsLast30Days}>
          <StatCard
            label="Sign-ups (30 days)"
            value={nf.format(o.signupsLast30Days)}
            icon={<UserPlus />}
            spark={o.signups.map((s) => s.count)}
            hint="New companies"
          />
        </div>
        <div id="kpi-churn" data-value={o.churn.ratePct}>
          <StatCard
            label="Churn (30 days)"
            value={`${o.churn.ratePct.toFixed(1)}%`}
            icon={<TrendingDown />}
            hint={`${o.churn.cancelledLast30Days} cancelled`}
            alert={o.churn.ratePct >= 5}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <BarsCard id="overview-by-status" title="Companies by status" rows={o.byStatus} />
        <BarsCard id="overview-by-plan" title="Companies by plan" rows={o.byPlan} />
        <BarsCard id="overview-by-country" title="Companies by country" rows={o.byCountry} />
        {o.mrrByPlan && <BarsCard id="overview-mrr-by-plan" title="MRR by plan" rows={o.mrrByPlan} format={(n) => fmtMoney(n, o.currency)} />}
        <SignupsCard o={o} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ListCard id="overview-trials" title="Trials ending soon" empty="No trials end in the next days.">
          {o.trialsEndingSoon.map((t) => (
            <Row key={t.companyId} companyId={t.companyId} name={t.name}>
              <span className={cn('num', t.daysLeft <= 3 && 'font-medium text-warning-700 dark:text-warning-500')}>
                {t.daysLeft === 0 ? 'Today' : `${t.daysLeft} ${t.daysLeft === 1 ? 'day' : 'days'}`}
              </span>
              <span className="text-subtle">{fmtDate(t.trialEndsAt)}</span>
            </Row>
          ))}
        </ListCard>
        <ListCard id="overview-past-due" title="Past due" empty="Nobody is past due.">
          {o.pastDue.map((p) => (
            <Row key={p.companyId} companyId={p.companyId} name={p.name}>
              {p.amountDue !== null && <span className="num">{fmtMoney(p.amountDue, o.currency)}</span>}
              <span className="text-subtle">{p.graceEndsAt ? `Grace ends ${fmtDate(p.graceEndsAt)}` : ''}</span>
            </Row>
          ))}
        </ListCard>
        <ListCard id="overview-top-usage" title="Top usage" empty="No company is close to a limit.">
          {o.topUsage.map((u) => (
            <Row key={`${u.companyId}-${u.key}`} companyId={u.companyId} name={u.name}>
              <span className={cn('num', u.percent >= 100 ? 'font-medium text-danger-700 dark:text-danger-500' : u.percent >= 80 ? 'text-warning-700 dark:text-warning-500' : '')}>
                {u.percent}%
              </span>
              <span className="text-subtle">{LIMIT_LABEL[u.key] ?? u.key}</span>
            </Row>
          ))}
        </ListCard>
      </div>
    </>
  )
}

/** Horizontal CSS bars (one hue; the value is printed next to each bar). */
function BarsCard({ id, title, rows, format = (n: number) => nf.format(n) }: { id: string; title: string; rows: CountBy[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  return (
    <Card id={id}>
      <CardHeader title={title} />
      <CardBody>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted">No data.</p>
        ) : (
          <ul className="space-y-2.5">
            {sorted.map((r) => (
              <li key={r.key} data-key={r.key} data-count={r.count} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-[0.8125rem]">
                <span className="truncate text-ink-2" title={r.label}>
                  {r.label}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-600 dark:bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="num text-end text-xs font-medium text-ink">{format(r.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function SignupsCard({ o }: { o: PlatformOverview }) {
  const max = Math.max(1, ...o.signups.map((s) => s.count))
  return (
    <Card id="overview-signups">
      <CardHeader title="Weekly sign-ups" description="Last 8 weeks" />
      <CardBody>
        <div className="flex h-36 items-end gap-2" role="list" aria-label="Sign-ups per week">
          {o.signups.map((s) => (
            <div key={s.weekStart} role="listitem" className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Week of ${fmtDate(s.weekStart)}: ${s.count}`}>
              <span className="num text-[0.6875rem] text-muted">{s.count}</span>
              <span className="w-full rounded-t-md bg-brand-600 dark:bg-brand-500" style={{ height: `${Math.max(2, (s.count / max) * 100)}%` }} aria-hidden />
              <span className="truncate text-[0.625rem] text-subtle">{new Date(s.weekStart).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function ListCard({ id, title, empty, children }: { id: string; title: string; empty: string; children: ReactNode[] }) {
  return (
    <Card id={id}>
      <CardHeader title={title} />
      {children.length === 0 ? (
        <CardBody>
          <p className="text-xs text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line border-t border-line">{children}</ul>
      )}
    </Card>
  )
}

function Row({ companyId, name, children }: { companyId: string; name: string; children: ReactNode }) {
  return (
    <li>
      <Link to={platformCompanyPath(companyId)} data-company-id={companyId} className="flex items-center gap-3 px-5 py-2.5 text-[0.8125rem] hover:bg-hover/60">
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{children}</span>
      </Link>
    </li>
  )
}
