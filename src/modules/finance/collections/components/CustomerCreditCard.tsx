import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins } from 'lucide-react'
import { useCustomerCredit, useFinanceScope } from '@/modules/finance/collections/api'
import { useEntitlements } from '@/modules/billing/hooks'
import { PATHS, financeStatementPath } from '@/app/paths'
import { CreditEditor } from './ReceivablesTabs'
import { fmt2 } from './bits'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * The customer page's "Balance & credit" card (Accounts & finance › Receivables): open balance, overdue,
 * cheques held, credit limit / available and flags. Shown to accounting view / full only (the API answers 403
 * otherwise); full can edit the limit, the hold and the reminder pause.
 */
export function CustomerCreditCard({ customerId }: { customerId: string }) {
  const { canRead, canWrite } = useFinanceScope()
  const ent = useEntitlements()
  const q = useCustomerCredit(canRead && ent.hasModule('accounting') ? customerId : null)
  const [editing, setEditing] = useState(false)
  if (!canRead || !ent.hasModule('accounting') || q.error) return null
  const c = q.data
  return (
    <Card>
      <CardHeader
        icon={<HandCoins className="size-4" aria-hidden />}
        title="Balance & credit"
        action={canWrite && c ? <Button size="xs" variant="secondary" write onClick={() => setEditing(true)}>Edit</Button> : undefined}
      />
      <CardBody>
        {!c ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-3 text-[0.8125rem]">
            <div className="flex flex-wrap gap-1">
              {c.creditHold && <Badge tone="red">On credit hold</Badge>}
              {c.overLimit && <Badge tone="amber">Over limit</Badge>}
              {c.bouncedCheques > 0 && <Badge tone="red">{c.bouncedCheques} bounced cheque{c.bouncedCheques === 1 ? '' : 's'}</Badge>}
              {c.dunningPaused && <Badge tone="neutral">Reminders paused</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {(
                [
                  ['Open balance', c.openAr],
                  ['Overdue', c.overdue],
                  ['Cheques held', c.pdcHeld],
                  ['Unapplied credit', c.unappliedCredit],
                  ['Credit limit', c.creditLimit],
                  ['Available', c.available],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="num font-medium text-ink">{v === null ? '—' : `${c.baseCurrency} ${fmt2(v)}`}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-3">
              <Link to={`${PATHS.financeReceivables}?customer=${encodeURIComponent(customerId)}`} className="font-medium text-brand-600 hover:underline">Open invoices</Link>
              <Link to={financeStatementPath(customerId)} className="font-medium text-brand-600 hover:underline">Statement</Link>
            </div>
          </div>
        )}
      </CardBody>
      {canWrite && <CreditEditor credit={editing ? (c ?? null) : null} onClose={() => setEditing(false)} />}
    </Card>
  )
}
