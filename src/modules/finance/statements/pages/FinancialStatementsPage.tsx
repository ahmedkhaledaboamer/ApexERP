import { useSearchParams } from 'react-router-dom'
import { FileChartColumn } from 'lucide-react'
import { errMsg, fmtDate } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { Tabs } from '@/shared/components/ui/Tabs'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useStatementsMeta } from '../api'
import { BalanceSheetTab, CashFlowTab, GeneralLedgerTab, ProfitAndLossTab, TrialBalanceTab } from '../components/ReportTabs'
import { YearEndTab } from '../components/YearEndTab'

type Tab = 'pnl' | 'balance-sheet' | 'cash-flow' | 'general-ledger' | 'trial-balance' | 'year-end'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pnl', label: 'Profit and loss' },
  { id: 'balance-sheet', label: 'Balance sheet' },
  { id: 'cash-flow', label: 'Cash flow' },
  { id: 'general-ledger', label: 'General ledger' },
  { id: 'trial-balance', label: 'Trial balance' },
  { id: 'year-end', label: 'Year-end' },
]

/**
 * `/finance/statements?tab=`: Financial statements from the journal — profit and loss (periods, comparisons, dimension
 * filters, 12-month trend, drill-down), balance sheet, cash flow (indirect), general ledger, trial balance with
 * comparatives (CSV / Excel / print with letterhead) and the year-end close. Sales Manager: read only.
 */
export default function FinancialStatementsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'pnl') as Tab
  const meta = useStatementsMeta()
  const m = meta.data
  return (
    <>
      <PrintStyles orientation="portrait" margin="12mm" />
      <div className="print:hidden">
        <PageHeader
          icon={<IconTile><FileChartColumn /></IconTile>}
          title="Financial statements"
          description={m ? `From the journal, in ${m.currency}${m.lockDate ? ` · books locked up to ${fmtDate(m.lockDate)}` : ''}` : 'Profit and loss, balance sheet, cash flow, ledgers and the year-end close.'}
        >
          <Tabs label="Financial statements" items={TABS} value={tab} onChange={(t) => setParams(t === 'pnl' ? {} : { tab: t })} />
        </PageHeader>
      </div>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {meta.isError ? (
            <ErrorState message={errMsg(meta.error)} onRetry={() => void meta.refetch()} />
          ) : !m ? (
            <Skeleton className="h-96" />
          ) : tab === 'pnl' ? (
            <ProfitAndLossTab meta={m} />
          ) : tab === 'balance-sheet' ? (
            <BalanceSheetTab meta={m} />
          ) : tab === 'cash-flow' ? (
            <CashFlowTab meta={m} />
          ) : tab === 'general-ledger' ? (
            <GeneralLedgerTab meta={m} />
          ) : tab === 'trial-balance' ? (
            <TrialBalanceTab meta={m} />
          ) : (
            <YearEndTab />
          )}
        </div>
      </PageBody>
    </>
  )
}
