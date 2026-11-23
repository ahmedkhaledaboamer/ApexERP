import { Link } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { useApprovalsInbox } from '@/modules/finance/purchases/approvalsInbox'
import { PATHS } from '@/app/paths'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { Badge } from '@/shared/components/ui/Badge'

/**
 * My HR slot "Approvals" (modules/hr/selfservice/portalSlots.tsx): how many purchase requests, bills and expense
 * claims wait for the caller's decision, with a link to the inbox. Nothing when nothing waits (or no accounting plan).
 */
export function MyApprovalsCard() {
  const inbox = useApprovalsInbox()
  if (!inbox.on || inbox.loading || inbox.count === 0) return null
  const parts = [
    [inbox.pos.data?.length ?? 0, 'purchase request'],
    [inbox.bills.data?.length ?? 0, 'supplier bill'],
    [inbox.claims.data?.length ?? 0, 'expense claim'],
  ].filter(([n]) => (n as number) > 0) as [number, string][]
  return (
    <Card>
      <CardHeader icon={<Inbox className="size-4" />} title="Approvals" description="Waiting for your decision." action={<Badge tone="amber">{inbox.count}</Badge>} />
      <div className="px-4 pb-4 text-[0.8125rem]">
        <p className="text-ink-2">{parts.map(([n, what]) => `${n} ${what}${n === 1 ? '' : 's'}`).join(' · ')}</p>
        <Link to={PATHS.financeApprovals} className="mt-2 inline-block text-xs text-brand-700 hover:underline dark:text-brand-300">Open my approvals</Link>
      </div>
    </Card>
  )
}
