import { Activity, CircleDollarSign, Percent, Timer, Trophy, UserPlus } from 'lucide-react'
import { fmtCompactMoney } from '@/shared/lib/utils'
import { StatCard } from '@/shared/components/ui/StatCard'
import type { ReportKpis } from '@/modules/reports/types'
import { fmtInt, fmtPct } from './chartKit'

export function KpiStrip({ kpis }: { kpis: ReportKpis }) {
  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-4 min-[26.25rem]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 print:grid-cols-3">
      <StatCard label="Leads created" icon={<UserPlus />} value={fmtInt(kpis.leadsCreated)} hint="New in the period" />
      <StatCard label="Won value" icon={<CircleDollarSign />} value={fmtCompactMoney(kpis.wonValue)} hint={`${kpis.wonCount} ${kpis.wonCount === 1 ? 'deal' : 'deals'} won`} />
      <StatCard
        label="Conversion rate"
        icon={<Percent />}
        value={kpis.closedCount ? fmtPct(kpis.conversionRate) : '—'}
        hint={kpis.closedCount ? `${kpis.wonCount} won of ${kpis.closedCount} closed` : 'No deals closed yet'}
      />
      <StatCard label="Avg. deal size" icon={<Trophy />} value={kpis.wonCount ? fmtCompactMoney(kpis.avgDealSize) : '—'} hint="Won value ÷ deals won" />
      <StatCard
        label="Avg. days to close"
        icon={<Timer />}
        value={kpis.avgDaysToClose === null ? '—' : kpis.avgDaysToClose}
        hint="Created → won"
      />
      <StatCard label="Activities logged" icon={<Activity />} value={fmtInt(kpis.activitiesLogged)} hint="Calls, emails, visits, meetings" />
    </section>
  )
}
