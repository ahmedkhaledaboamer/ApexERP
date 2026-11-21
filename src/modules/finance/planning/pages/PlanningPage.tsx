import { useSearchParams } from 'react-router-dom'
import { Target } from 'lucide-react'
import { useFinanceScope } from '@/modules/finance/ledger/api'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { BudgetsTab } from '../components/BudgetsTab'
import { VsActualTab } from '../components/VsActualTab'
import { ForecastTab } from '../components/ForecastTab'

/**
 * `/finance/planning` (?tab=budgets|vs-actual|forecast, ?budget=, ?department=, ?month=): department budgets
 * (create, spread, copy actuals ± %, approve), budget vs actual, and the 13-week / 6-month cash-flow forecast.
 * Accounting full edits (approval: Management / Company Admin); Sales Manager views; department heads without
 * accounting access see the budget vs actual of their own department only (the API scopes it).
 */
type Tab = 'budgets' | 'vs-actual' | 'forecast'

export default function PlanningPage() {
  const [params, setParams] = useSearchParams()
  const { scope } = useFinanceScope()
  const accounting = scope !== 'hidden'
  const tabs: { id: Tab; label: string }[] = accounting
    ? [{ id: 'budgets', label: 'Budgets' }, { id: 'vs-actual', label: 'Budget vs actual' }, { id: 'forecast', label: 'Cash-flow forecast' }]
    : [{ id: 'vs-actual', label: 'My department budget' }]
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && tabs.some((t) => t.id === requested) ? requested : tabs[0].id
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setParams(p, { replace: true })
  }
  return (
    <>
      <PageHeader
        icon={<IconTile><Target /></IconTile>}
        title={accounting ? 'Budgets & forecast' : 'Department budget'}
        description={accounting ? 'Department budgets with approval, budget vs actual, and the cash-flow forecast.' : 'Budget vs actual of the department you head.'}
      />
      <PageBody className="space-y-5">
        {tabs.length > 1 && <Tabs<Tab> label="Planning sections" value={tab} onChange={(t) => set({ tab: t })} items={tabs} />}
        <div id={`tab-panel-${tab}`} role="tabpanel">
          {tab === 'budgets' ? (
            <BudgetsTab open={params.get('budget')} onOpen={(id) => set({ budget: id })} />
          ) : tab === 'vs-actual' ? (
            <VsActualTab budgetId={params.get('budget')} department={params.get('department')} month={params.get('month')} onChange={set} />
          ) : (
            <ForecastTab />
          )}
        </div>
      </PageBody>
    </>
  )
}
