import { CheckCircle2, CircleSlash } from 'lucide-react'
import type { PricingType } from '@/modules/services/types'
import { categoryMeta } from '@/modules/services/categoryMeta'
import { can } from '@/shared/lib/permissions'
import { cn, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

/** Edit rights on the catalog (System Admin, Management, Sales Manager by the matrix). */
export function useServicesAccess(): { canEdit: boolean } {
  const user = useCurrentUser()
  return { canEdit: !!user && can(user.role, 'services', 'edit') }
}

export const PRICING_TONE: Record<PricingType, Tone> = { Fixed: 'blue', Monthly: 'brand', Hourly: 'teal' }

export const PRICING_SUFFIX: Record<PricingType, string> = { Fixed: '', Monthly: ' / month', Hourly: ' / hour' }

export function PricingBadge({ type }: { type: PricingType }) {
  return (
    <Badge tone={PRICING_TONE[type]} variant="dot">
      {type}
    </Badge>
  )
}

/** "AED 4,500 / month" with the suffix muted. */
export function Price({ value, currency, type, className }: { value: number; currency: string; type: PricingType; className?: string }) {
  return (
    <span className={cn('num whitespace-nowrap text-ink', className)}>
      {fmtMoney(value, currency)}
      {PRICING_SUFFIX[type] && <span className="text-muted">{PRICING_SUFFIX[type]}</span>}
    </span>
  )
}

export function priceText(value: number, currency: string, type: PricingType): string {
  return `${fmtMoney(value, currency)}${PRICING_SUFFIX[type]}`
}

/** Tinted tile with the category's icon. */
export function CategoryIcon({ category, size = 'md', className }: { category: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const meta = categoryMeta(category)
  const Icon = meta.icon
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        size === 'sm' && 'size-7 [&_svg]:size-3.5',
        size === 'md' && 'size-9 [&_svg]:size-[1.125rem]',
        size === 'lg' && 'size-12 rounded-xl [&_svg]:size-6',
        meta.tone,
        className,
      )}
    >
      <Icon />
    </span>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="green" icon={<CheckCircle2 />}>
      Active
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<CircleSlash />}>
      Inactive
    </Badge>
  )
}

/** Delivery time as a short phrase. */
export function deliveryText(days: number): string {
  if (!days) return 'Ongoing'
  return `${days} working day${days === 1 ? '' : 's'}`
}
