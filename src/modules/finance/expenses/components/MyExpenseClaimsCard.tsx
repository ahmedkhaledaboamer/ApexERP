import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HandCoins, Plus } from 'lucide-react'
import { useClaims, useClaimsMeta } from '@/modules/finance/expenses/api'
import { useEntitlements } from '@/modules/billing/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { fmtDate } from '@/shared/lib/utils'
import { Amount, ClaimStatusBadge } from './bits'
import { ClaimEditorDrawer } from './ClaimEditor'

/**
 * My HR slot "My expense claims" (modules/hr/selfservice/portalSlots.tsx): the caller's latest claims and a
 * "New claim" form (lines + receipts, submit for approval). Nothing when the plan has no accounting or the caller
 * has no employee record.
 */
export function MyExpenseClaimsCard() {
  const ent = useEntitlements()
  const on = ent.hasModule('accounting')
  const meta = useClaimsMeta(on)
  const claims = useClaims({ view: 'mine' }, on)
  const [open, setOpen] = useState(false)
  if (!on || meta.data?.employee === null) return null
  return (
    <Card>
      <CardHeader
        icon={<HandCoins className="size-4" />}
        title="My expense claims"
        description="Claim back money you spent for the company."
        action={<Button size="sm" write onClick={() => setOpen(true)}><Plus /> New claim</Button>}
      />
      <div className="px-4 pb-4">
        {claims.isPending ? (
          <Skeleton className="h-16" />
        ) : !claims.data?.length ? (
          <p className="text-[0.8125rem] text-muted">No claims yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="My expense claims">
            {claims.data.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                <Link to={`/finance/expenses?tab=claims&claim=${encodeURIComponent(c.id)}`} className="min-w-0 truncate text-brand-700 hover:underline dark:text-brand-300">
                  <span className="num">{c.number}</span> · {c.title}
                  <span className="block text-xs text-muted">{c.submittedAt ? `Submitted ${fmtDate(c.submittedAt)}` : 'Draft'}</span>
                </Link>
                <span className="flex shrink-0 items-center gap-2"><Amount value={c.total} currency={c.currency} /><ClaimStatusBadge status={c.status} /></span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/finance/expenses?tab=claims" className="mt-2 inline-block text-xs text-brand-700 hover:underline dark:text-brand-300">All my claims</Link>
      </div>
      <ClaimEditorDrawer open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}
