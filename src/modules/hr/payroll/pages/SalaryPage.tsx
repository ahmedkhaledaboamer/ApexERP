import { useSearchParams } from 'react-router-dom'
import { Banknote } from 'lucide-react'
import { usePaySettings, usePayrollScope } from '@/modules/hr/payroll/api'
import { RunsTab } from '@/modules/hr/payroll/components/RunsTab'
import { AdjustmentsTab, LoansTab, ProfilesTab } from '@/modules/hr/payroll/components/PeopleTabs'
import { PayslipsTab, SettingsTab, SettlementsTab, SummaryTab } from '@/modules/hr/payroll/components/OtherTabs'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'

type Tab = 'runs' | 'payslips' | 'adjustments' | 'loans' | 'profiles' | 'settlements' | 'summary' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'runs', label: 'Payroll runs' },
  { id: 'payslips', label: 'Payslips' },
  { id: 'adjustments', label: 'Adjustments' },
  { id: 'loans', label: 'Loans & advances' },
  { id: 'profiles', label: 'Payroll profiles' },
  { id: 'settlements', label: 'Final settlements' },
  { id: 'summary', label: 'Summary' },
  { id: 'settings', label: 'Pay settings' },
]

/**
 * `/hr/salary`: Salary Management. HR full (Company Admin, Management, HR Manager) runs the payroll; everyone
 * else with HR access (Department Head, Employee) sees only "My payslips". ?tab=, ?run= (opens a run),
 * ?payslip= (highlights one).
 */
export default function SalaryPage() {
  const { isFull } = usePayrollScope()
  const [params, setParams] = useSearchParams()
  const settings = usePaySettings(isFull)
  const tab = (isFull ? (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'runs') : 'payslips') as Tab
  const setTab = (t: Tab) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.set('tab', t)
    n.delete('run')
    return n
  })
  const openRun = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (id) n.set('run', id)
    else n.delete('run')
    return n
  })

  if (!isFull) {
    return (
      <>
        <PageHeader icon={<IconTile><Banknote /></IconTile>} title="My payslips" description="Your monthly payslips, available once the payroll of the month is paid." />
        <PageBody>
          <PayslipsTab mine highlight={params.get('payslip')} />
        </PageBody>
      </>
    )
  }

  return (
    <>
      <PageHeader
        icon={<IconTile><Banknote /></IconTile>}
        title="Salary Management"
        description={settings.data ? `Monthly payroll in ${settings.data.currency} · pay day ${settings.data.payDay} · ${settings.data.country === 'AE' ? 'WPS (UAE)' : 'Mudad (KSA)'}` : 'Monthly payroll, payslips, loans and end-of-service settlements.'}
      >
        <Tabs label="Salary management" items={TABS} value={tab} onChange={setTab} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'runs' && <RunsTab openRun={params.get('run')} onOpenRun={openRun} />}
          {tab === 'payslips' && <PayslipsTab mine={false} highlight={params.get('payslip')} />}
          {tab === 'adjustments' && <AdjustmentsTab />}
          {tab === 'loans' && <LoansTab />}
          {tab === 'profiles' && <ProfilesTab />}
          {tab === 'settlements' && <SettlementsTab country={settings.data?.country ?? 'AE'} />}
          {tab === 'summary' && <SummaryTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </PageBody>
    </>
  )
}
