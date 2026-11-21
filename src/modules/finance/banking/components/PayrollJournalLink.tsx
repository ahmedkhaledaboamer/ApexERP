import { usePayrollPosting } from '@/modules/finance/banking/api'
import { EntryLink } from '@/modules/finance/ledger/components/bits'

/**
 * HR › Salary › run drawer: the run's ledger postings (accrual on approval, payment when paid) for users who can see
 * Accounts & finance (others see nothing — HR Managers have accounting hidden).
 */
export function PayrollJournalLink({ runId, status }: { runId: string; status: string }) {
  const q = usePayrollPosting(runId, status)
  const p = q.data
  if (!p || (status !== 'approved' && status !== 'paid' && !p.reversalEntryIds.length)) return null
  return (
    <p className="text-xs text-muted" data-testid="payroll-journal">
      Ledger:{' '}
      {p.accrualEntryId ? <>accrual <EntryLink id={p.accrualEntryId} number={p.accrualEntryNumber ?? ''} /></> : p.status === 'reversed' ? 'accrual reversed' : 'not posted'}
      {p.paymentEntryId && <> · payment <EntryLink id={p.paymentEntryId} number={p.paymentEntryNumber ?? ''} /></>}
      {p.note && <> · {p.note}</>}
    </p>
  )
}
