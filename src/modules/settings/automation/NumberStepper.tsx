import { useEffect, useState, type KeyboardEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface NumberStepperProps {
  id: string
  /** NaN while the field is empty or not a number. */
  value: number
  onChange: (value: number) => void
  onBlur?: () => void
  min: number
  max: number
  step?: number
  /** Shown after the control, e.g. "days". */
  unit?: string
  disabled?: boolean
  invalid?: boolean
  label: string
  describedBy?: string
}

/** − [ n ] + with a unit. Arrow keys step, Page Up / Down step by 10, Home / End jump to the limits. */
export function NumberStepper({ id, value, onChange, onBlur, min, max, step = 1, unit, disabled, invalid, label, describedBy }: NumberStepperProps) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '')

  // Follow outside changes (discard, reset) without fighting the user's typing.
  useEffect(() => {
    setText((t) => (Number(t) === value && t !== '' ? t : Number.isFinite(value) ? String(value) : ''))
  }, [value])

  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const set = (n: number) => {
    const next = clamp(n)
    setText(String(next))
    onChange(next)
  }
  const base = Number.isFinite(value) ? value : min

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, number> = { ArrowUp: step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 }
    if (e.key in moves) {
      e.preventDefault()
      set(base + moves[e.key])
    } else if (e.key === 'Home') {
      e.preventDefault()
      set(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      set(max)
    }
  }

  const btn =
    'flex h-full w-8 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5'

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'inline-flex h-9 items-stretch overflow-hidden rounded-lg border bg-surface shadow-xs focus-within:border-brand-500 focus-within:shadow-[var(--shadow-focus)]',
          invalid ? 'border-danger-500' : 'border-line-strong',
          disabled && 'bg-sunken opacity-70',
        )}
      >
        <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} className={btn} disabled={disabled || base <= min} onClick={() => set(base - step)}>
          <Minus aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Number.isFinite(value) ? value : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={text}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, '')
            setText(raw)
            onChange(raw === '' ? Number.NaN : Number(raw))
          }}
          className="num w-14 border-x border-line bg-transparent text-center text-[0.875rem] font-semibold text-ink outline-none disabled:cursor-not-allowed"
        />
        <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} className={btn} disabled={disabled || base >= max} onClick={() => set(base + step)}>
          <Plus aria-hidden />
        </button>
      </div>
      {unit && <span className="min-w-[4.5rem] text-[0.8125rem] text-muted">{unit}</span>}
    </div>
  )
}
