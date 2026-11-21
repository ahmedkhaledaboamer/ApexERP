import { Link } from 'react-router-dom'
import { BadgePercent } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { useEntitlements } from '@/modules/billing/hooks'

/** "My commissions" on the Sales targets page (every sales role; shown when the plan has Accounts & finance). */
export function MyCommissionsLink() {
  const ent = useEntitlements()
  if (!ent.hasModule('accounting')) return null
  return (
    <Link
      to={PATHS.myCommissions}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink shadow-xs hover:bg-hover [&_svg]:size-4"
    >
      <BadgePercent aria-hidden />
      My commissions
    </Link>
  )
}
