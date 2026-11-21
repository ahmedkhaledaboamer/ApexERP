import { AlertTriangle, Ban } from 'lucide-react'
import { useCreditCheck } from '@/modules/finance/collections/api'
import { fmt2 } from './bits'

/**
 * The quotation form's credit check (Accounts & finance › credit limits): a warning when the customer is on hold,
 * would go over the credit limit or had a bounced cheque; "blocked" when the company setting blocks quotations
 * (the API then refuses to create / send with 409 credit_blocked). Nothing without a customer or accounting.
 */
export function QuotationCreditNotice({ leadId, amount, currency }: { leadId?: string; amount: number; currency?: string }) {
  const q = useCreditCheck({ leadId, amount, currency })
  const c = q.data
  if (!c || c.level === 'ok' || !c.message) return null
  const blocked = c.level === 'blocked'
  return (
    <div
      role={blocked ? 'alert' : 'status'}
      className={
        blocked
          ? 'flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-400'
          : 'flex items-start gap-2 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-[0.8125rem] text-ink-2'
      }
    >
      {blocked ? <Ban className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div>
        <p className="font-medium">{blocked ? 'Credit check: blocked' : 'Credit check'}</p>
        <p>{c.message}{blocked ? ' The company blocks quotations in this case; ask finance to raise the limit or lift the hold.' : ''}</p>
        {c.detail && c.detail.creditLimit !== null && (
          <p className="num text-xs text-muted">Limit {c.detail.baseCurrency} {fmt2(c.detail.creditLimit)} · owed {fmt2(c.detail.exposure)} · available {fmt2(c.detail.available ?? 0)}</p>
        )}
      </div>
    </div>
  )
}
