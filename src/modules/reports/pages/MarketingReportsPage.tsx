import { useState } from 'react'
import { BarChart3, Coins, Target, Users } from 'lucide-react'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { PRESET_LABELS, PRESETS, presetRange, type RangePreset } from '@/modules/reports/lib/dateRange'
import { CampaignCostReport } from '@/modules/reports/components/CampaignCostReport'
import { useMarketingReport } from '@/modules/marketing/hooks/useMarketing'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SelectInput } from '@/shared/components/form/Field'

/** Reports › Marketing: cost per lead by campaign and lead-source attribution (reports family "marketing"). */
export default function MarketingReportsPage() {
  const user = useCurrentUser()
  if (!user || !canSeeMarketingReportsRole(user.role)) return <NoMarketingAccess what="Marketing reports" />
  return <Report />
}

function Report() {
  const [preset, setPreset] = useState<Exclude<RangePreset, 'custom'>>('thisYear')
  const range = presetRange(preset)
  const query = useMarketingReport(range.from, range.to)
  const t = query.data?.totals
  const cur = query.data?.currency

  return (
    <>
      <PageHeader
        title="Marketing reports"
        description="Which campaigns and sources bring customers, and what each lead cost."
        icon={<BarChart3 aria-hidden />}
        actions={
          <SelectInput aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Exclude<RangePreset, 'custom'>)} className="w-44">
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </SelectInput>
        }
      />
      <PageBody className="space-y-6">
        {query.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Leads in the period" value={t!.leads} hint={`${t!.attributed} from a campaign`} icon={<Users aria-hidden />} />
              <StatCard label="Campaign spend" value={fmtMoney(t!.spend, cur)} icon={<Coins aria-hidden />} />
              <StatCard label="Cost per attributed lead" value={t!.costPerLead === null ? '—' : fmtMoney(t!.costPerLead, cur)} icon={<Target aria-hidden />} />
            </div>
            <CampaignCostReport data={query.data} />
          </>
        )}
      </PageBody>
    </>
  )
}
