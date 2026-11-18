import type { ReactNode } from 'react'
import { Bot, Check, Database, HardDrive, Mail, Users } from 'lucide-react'
import type { Plan, PlanLimits } from '@/modules/billing/types'
import { PLAN_MODULE_LABEL, formatLimitValue } from '@/modules/billing/gating'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'

/** Price label from the plan data: "Free for 14 days", "$29 / month", "Custom pricing". */
export function formatPlanPrice(plan: Plan, trialDays?: number | null): { amount: string; suffix: string } {
  if (plan.checkout === 'contact') return { amount: 'Custom', suffix: 'pricing' }
  if (plan.price === null || plan.price === 0) return { amount: 'Free', suffix: trialDays ? `for ${trialDays} days` : '' }
  const amount = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: Number.isInteger(plan.price) ? 0 : 2,
  }).format(plan.price)
  return { amount, suffix: `/ ${plan.billingPeriod}` }
}

export function limitText(value: number | null, unit: string): string {
  if (value === null) return `Unlimited ${unit}`
  return `${new Intl.NumberFormat('en').format(value)} ${unit}`
}

export function PlanLimitsList({ limits, className }: { limits: PlanLimits; className?: string }) {
  const rows = [
    { key: 'users', icon: Users, text: limitText(limits.users, limits.users === 1 ? 'user' : 'users') },
    { key: 'leads', icon: Database, text: limitText(limits.leadsContacts, 'leads & contacts') },
    {
      key: 'storage',
      icon: HardDrive,
      text: limits.storageMb === null ? 'Unlimited storage' : `${formatLimitValue('storageMb', limits.storageMb)} storage`,
    },
    { key: 'emails', icon: Mail, text: `${limitText(limits.emailsPerMonth, 'emails')} / month` },
    { key: 'ai', icon: Bot, text: limitText(limits.aiCredits, 'AI credits') },
  ]
  return (
    <ul className={cn('space-y-1.5', className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <r.icon className="size-3.5 shrink-0 text-muted" aria-hidden />
          {r.text}
        </li>
      ))}
    </ul>
  )
}

interface PlanCardProps {
  plan: Plan
  /** Highlighted (e.g. "Most popular" or the current plan). */
  featured?: boolean
  badge?: ReactNode
  selected?: boolean
  /** Call to action at the bottom. */
  action?: ReactNode
  /** Trial length (platform setting) for the "Free for N days" label. */
  trialDays?: number | null
  className?: string
}

/** One plan: price, limits, included modules and highlights. */
export function PlanCard({ plan, featured, badge, selected, action, trialDays, className }: PlanCardProps) {
  const price = formatPlanPrice(plan, trialDays)
  return (
    <article
      aria-label={`${plan.name} plan`}
      data-plan-id={plan.id}
      className={cn(
        'relative flex flex-col rounded-card border bg-surface p-5 shadow-xs transition-[border-color,box-shadow] duration-150',
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/30'
          : featured
            ? 'border-brand-300 dark:border-brand-500/40'
            : 'border-line',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{plan.name}</h3>
        {badge}
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-[-0.02em] text-ink">{price.amount}</span>
        {price.suffix && <span className="text-xs text-muted">{price.suffix}</span>}
      </p>

      <PlanLimitsList limits={plan.limits} className="mt-4 border-t border-line pt-4" />

      <ul className="mt-4 space-y-1.5">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
            {h}
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-muted">Included modules</p>
        <div className="flex flex-wrap gap-1">
          {plan.modules.map((m) => (
            <Badge key={m} variant="outline">
              {PLAN_MODULE_LABEL[m] ?? m}
            </Badge>
          ))}
        </div>
      </div>

      {action && <div className="mt-auto pt-5">{action}</div>}
    </article>
  )
}
