import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-xs', className)} {...rest} />
}

interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Buttons or links on the right. */
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function CardHeader({ title, description, action, icon, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start gap-3 px-5 pt-4 pb-3', className)}>
      {icon && <span className="mt-0.5 text-muted [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="text-[0.8125rem] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action && <div className="-my-1 flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...rest} />
}

/** Label/value rows for record details (Attio-style attribute list). */
export function PropertyList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-line', className)}>{children}</dl>
}

export function Property({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="flex items-start gap-2 pt-0.5 text-[0.8125rem] leading-snug text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
        {icon}
        {/* Labels wrap instead of being cut off ("Recommended se…"). */}
        <span className="min-w-0 break-words">{label}</span>
      </dt>
      {/* Values never spill out of the card: long text wraps, chips/links are capped at the column. */}
      <dd className="min-w-0 text-[0.8125rem] leading-snug break-words text-ink [&>*]:max-w-full">{children}</dd>
    </div>
  )
}
