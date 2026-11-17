import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Primary and secondary actions, right-aligned. */
  actions?: ReactNode
  /** Leading visual (icon tile or avatar). */
  icon?: ReactNode
  /** Tabs or a toolbar under the title row. */
  children?: ReactNode
  className?: string
}

/** Page title block on the canvas: large title, description, actions on the right. */
export function PageHeader({ title, description, actions, icon, children, className }: PageHeaderProps) {
  return (
    <div className={cn('mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10 lg:pt-8', className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {description && <div className="mt-1.5 text-[0.9375rem] text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5 border-b border-line">{children}</div>}
    </div>
  )
}

/** Width-capped page body under the header. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-[100rem] px-4 py-6 sm:px-6 lg:px-10', className)}>{children}</div>
}

/** Square icon tile, e.g. for card corners. */
export function IconTile({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'brand' | 'neutral' }) {
  return (
    <span
      className={cn(
        'flex size-9 items-center justify-center rounded-lg border [&_svg]:size-[1.125rem]',
        tone === 'brand'
          ? 'border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300'
          : 'border-line bg-surface text-muted',
      )}
    >
      {children}
    </span>
  )
}
