import { useSearchParams } from 'react-router-dom'
import { Plus, Receipt } from 'lucide-react'
import { useExpenseScope, useFunds } from '@/modules/finance/expenses/api'
import { ExpenseDetailDrawer, ExpensesTab, RecordExpenseDrawer } from '@/modules/finance/expenses/components/ExpensesTab'
import { ClaimDetailDrawer, ClaimsTab } from '@/modules/finance/expenses/components/ClaimsTab'
import { ClaimEditorDrawer } from '@/modules/finance/expenses/components/ClaimEditor'
import { FundDrawer, PettyTab } from '@/modules/finance/expenses/components/PettyTab'
import { PolicyTab } from '@/modules/finance/expenses/components/PolicyTab'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Tabs } from '@/shared/components/ui/Tabs'

type Tab = 'expenses' | 'claims' | 'petty' | 'policy'

/**
 * `/finance/expenses`: company expenses (accounting full records / approves, view reads), employee expense claims
 * (every employee: own claims; approvers their queue; accounting full all), petty cash (full: every fund; a
 * custodian: their own), categories & policy. ?tab=, ?expense=, ?claim=, ?fund=, ?new=1 (opens the form of the tab).
 */
export default function ExpensesPage() {
  const { canWrite, canReadCompany } = useExpenseScope()
  const funds = useFunds()
  const [params, setParams] = useSearchParams()
  const tabs: { id: Tab; label: string }[] = [
    ...(canReadCompany ? [{ id: 'expenses' as const, label: 'Expenses' }] : []),
    { id: 'claims', label: 'Claims' },
    ...(canWrite || (funds.data?.length ?? 0) > 0 ? [{ id: 'petty' as const, label: 'Petty cash' }] : []),
    ...(canReadCompany ? [{ id: 'policy' as const, label: 'Categories & policy' }] : []),
  ]
  const asked = params.get('tab') as Tab | null
  const tab: Tab = asked && tabs.some((t) => t.id === asked) ? asked : params.get('claim') ? 'claims' : params.get('fund') ? 'petty' : tabs[0].id
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v) n.set(k, v)
        else n.delete(k)
      }
      return n
    })
  const creating = params.get('new') === '1'
  const action =
    tab === 'expenses' && canWrite ? <Button write onClick={() => set({ new: '1' })}><Plus /> Record expense</Button>
    : tab === 'claims' ? <Button write onClick={() => set({ new: '1' })}><Plus /> New claim</Button>
    : undefined
  return (
    <>
      <PageHeader
        icon={<IconTile><Receipt /></IconTile>}
        title="Expenses"
        description="Company expenses with receipts and VAT, employee expense claims, petty cash, categories and policy."
        actions={action}
      >
        <Tabs label="Expenses" items={tabs} value={tab} onChange={(t) => set({ tab: t, new: null })} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'expenses' && <ExpensesTab onOpen={(id) => set({ expense: id })} />}
          {tab === 'claims' && <ClaimsTab canSeeAll={canWrite} onOpen={(id) => set({ claim: id })} />}
          {tab === 'petty' && <PettyTab canManage={canWrite} onOpen={(id) => set({ fund: id })} />}
          {tab === 'policy' && <PolicyTab canEdit={canWrite} />}
        </div>
      </PageBody>
      {canReadCompany && <ExpenseDetailDrawer id={params.get('expense')} onClose={() => set({ expense: null })} />}
      {canWrite && <RecordExpenseDrawer open={creating && tab === 'expenses'} onClose={() => set({ new: null })} onSaved={(e) => set({ new: null, expense: e.id })} />}
      <ClaimEditorDrawer open={creating && tab === 'claims'} onClose={() => set({ new: null })} onDone={(c) => set({ new: null, claim: c.id })} />
      <ClaimDetailDrawer id={params.get('claim')} onClose={() => set({ claim: null })} />
      <FundDrawer id={params.get('fund')} onClose={() => set({ fund: null })} />
    </>
  )
}
