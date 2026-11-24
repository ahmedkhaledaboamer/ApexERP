import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  count?: number
}

interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  /** `underline`: Linear-style page tabs. `pill`: segmented control. */
  variant?: 'underline' | 'pill'
  className?: string
}

/** Accessible tablist: arrow keys move between tabs. Pair panels with id `tab-panel-<id>`. */
export function Tabs<T extends string>({ items, value, onChange, label, variant = 'underline', className }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKey(e: KeyboardEvent, index: number) {
    // Left/right follow the reading direction (RTL: ArrowLeft moves forward).
    const inline = (document.documentElement.dir === 'rtl' ? -1 : 1)
    const delta = e.key === 'ArrowRight' ? inline : e.key === 'ArrowLeft' ? -inline : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + items.length) % items.length
    refs.current[next]?.focus()
    onChange(items[next].id)
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        // Too many tabs for the width (phones) scroll inside the strip, never the page. The underline's baseline is an
        // inset shadow (not a border) so the active tab's 2px border sits on it without being clipped by the scroller.
        variant === 'underline'
          ? 'relative flex max-w-full gap-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none]'
          : 'relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.5 [scrollbar-width:none]',
        className,
      )}
    >
      {items.map((t, i) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`tab-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative inline-flex items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-150 [&_svg]:size-3.5',
              variant === 'underline'
                ? cn('h-10 shrink-0 border-b-2', active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')
                : cn('h-7 shrink-0 rounded-md px-2.5', active ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'),
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className="num rounded bg-sunken px-1 text-[0.6875rem] text-muted">{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
