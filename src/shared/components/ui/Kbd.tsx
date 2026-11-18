import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[0.6875rem] font-medium text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** CSS-only tooltip; wraps one focusable/hoverable child. */
export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 rounded-md bg-ink px-2 py-1 text-[0.6875rem] font-medium whitespace-nowrap text-canvas opacity-0 shadow-pop transition-opacity delay-300 duration-100 group-focus-within/tt:opacity-100 group-hover/tt:opacity-100',
          side === 'top' && 'bottom-full start-1/2 mb-1.5 -translate-x-1/2 rtl:translate-x-1/2',
          side === 'bottom' && 'top-full start-1/2 mt-1.5 -translate-x-1/2 rtl:translate-x-1/2',
          side === 'right' && 'start-full top-1/2 ms-2 -translate-y-1/2',
        )}
      >
        {label}
      </span>
    </span>
  )
}
