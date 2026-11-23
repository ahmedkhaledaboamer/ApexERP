import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, FilePlus2 } from 'lucide-react'
import { usePurchaseOrders } from '@/modules/finance/purchases/api'
import { useEntitlements } from '@/modules/billing/hooks'
import { PATHS, financePurchaseOrderPath } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { fmt2 } from '@/modules/finance/collections/components/bits'
import { PoStatusBadge, fmtDay } from './bits'

/**
 * My HR slot "My purchase requests" (modules/hr/selfservice/portalSlots.tsx): every employee's way into purchasing
 * without the Accounts & finance section — "Request a purchase" opens the PO request form (own department) and the
 * latest own requests show with their status. Nothing when the plan has no accounting.
 */
export function MyPurchaseRequestsCard() {
  const on = useEntitlements().hasModule('accounting')
  const navigate = useNavigate()
  const mine = usePurchaseOrders({ view: 'mine' })
  if (!on) return null
  const rows = mine.data ?? []
  return (
    <Card>
      <CardHeader
        icon={<ClipboardList className="size-4" />}
        title="My purchase requests"
        description="Ask to buy something for your department; your department head (and finance above the limits) approves it."
        action={
          <Button size="sm" write onClick={() => navigate(PATHS.financePurchaseOrderNew)}>
            <FilePlus2 aria-hidden /> Request a purchase
          </Button>
        }
      />
      <div className="px-4 pb-4">
        {mine.isPending ? (
          <Skeleton className="h-16" />
        ) : !rows.length ? (
          <p className="text-[0.8125rem] text-muted">No purchase requests yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="My purchase requests">
            {rows.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                <Link to={financePurchaseOrderPath(r.id)} className="min-w-0 truncate text-brand-700 hover:underline dark:text-brand-300">
                  <span className="num">{r.number}</span> · {r.vendorName}
                  <span className="block text-xs text-muted">{fmtDay(r.orderDate)}</span>
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="num">{fmt2(r.total)} {r.currency}</span>
                  <PoStatusBadge status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to={`${PATHS.financePurchaseOrders}?view=mine`} className="mt-2 inline-block text-xs text-brand-700 hover:underline dark:text-brand-300">All my requests</Link>
      </div>
    </Card>
  )
}
