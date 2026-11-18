import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** Segmented control (radio group): grey track, the active option a white pill with a brand ring. */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKey(e: KeyboardEvent, index: number) {
    // Left/right follow the reading direction (RTL: ArrowLeft moves forward).
    const inline = (document.documentElement.dir === 'rtl' ? -1 : 1)
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' ? inline : e.key === 'ArrowLeft' ? -inline : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center gap-0.5 rounded-xl border border-line bg-sunken p-1', className)}>
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'rounded-lg font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150',
              size === 'md' ? 'h-9 px-3.5 text-[0.875rem]' : 'h-7 px-2.5 text-[0.8125rem]',
              active
                ? 'bg-surface text-ink shadow-xs ring-2 ring-brand-500'
                : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
