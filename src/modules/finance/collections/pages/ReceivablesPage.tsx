import { useSearchParams } from 'react-router-dom'
import { HandCoins } from 'lucide-react'
import { useFinanceScope } from '@/modules/finance/collections/api'
import { AgingTab, CreditTab, RemindersTab, StatementsTab } from '@/modules/finance/collections/components/ReceivablesTabs'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'

type Tab = 'aging' | 'statements' | 'credit' | 'reminders'
const TABS: { id: Tab; label: string }[] = [
  { id: 'aging', label: 'Aging' },
  { id: 'statements', label: 'Statements' },
  { id: 'credit', label: 'Credit limits' },
  { id: 'reminders', label: 'Reminders & settings' },
]

/**
 * `/finance/receivables`: aging by customer (as of a date, drill-down, CSV), statements of account (print, mock
 * email), credit limits and the automated payment reminders. Accounting full edits; Sales Manager reads.
 * ?tab=, ?customer= (drill-down / statement).
 */
export default function ReceivablesPage() {
  const { canWrite } = useFinanceScope()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'aging') as Tab
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (v) n.set(k, v)
      else n.delete(k)
      return n
    })
  const customer = params.get('customer')
  return (
    <>
      <PageHeader icon={<IconTile><HandCoins /></IconTile>} title="Receivables" description="Who owes what and for how long, statements of account, credit limits and automatic payment reminders.">
        <Tabs label="Receivables" items={TABS} value={tab} onChange={(t) => set('tab', t)} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'aging' && <AgingTab customer={customer} onCustomer={(id) => set('customer', id)} canWrite={canWrite} />}
          {tab === 'statements' && <StatementsTab customer={customer} onCustomer={(id) => set('customer', id)} canWrite={canWrite} />}
          {tab === 'credit' && <CreditTab canWrite={canWrite} />}
          {tab === 'reminders' && <RemindersTab canWrite={canWrite} />}
        </div>
      </PageBody>
    </>
  )
}
