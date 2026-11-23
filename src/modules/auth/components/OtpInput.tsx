import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { DEMO_OTP, MOCK_API } from '@/modules/auth/constants'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  /** Called once all six digits are in (typed or pasted). */
  onComplete?: (value: string) => void
  length?: number
  invalid?: boolean
  disabled?: boolean
  autoFocus?: boolean
  /** Accessible name for the group, e.g. "Verification code". */
  label?: string
  /** id of an element describing the input (hint or error). */
  describedBy?: string
}

/**
 * Segmented one-time-code input: one box per digit. Typing a digit moves straight to the next box,
 * paste / autofill fills all, Backspace and the arrow keys move back and forth.
 *
 * The latest value is kept in a ref and updated synchronously on every change, so moving focus right
 * after a keystroke never reads the previous render's value (which used to bounce focus back to the
 * first box).
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  invalid,
  disabled,
  autoFocus,
  label = 'Verification code',
  describedBy,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const valueRef = useRef(value)
  valueRef.current = value
  const [active, setActive] = useState<number | null>(null)
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  // The boxes are disabled while a code is being checked, which drops focus. When they come back
  // (e.g. a wrong code cleared them), put the cursor in the first empty box so the user can retype.
  const wasDisabled = useRef(disabled)
  useEffect(() => {
    if (wasDisabled.current && !disabled && autoFocus) {
      const el = refs.current[Math.min(valueRef.current.length, length - 1)]
      el?.focus()
      el?.select()
    }
    wasDisabled.current = disabled
  }, [disabled, autoFocus, length])

  function focus(i: number) {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))]
    el?.focus()
    el?.select()
  }

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length)
    valueRef.current = clean
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
    return clean
  }

  function onInput(i: number, raw: string) {
    const typed = raw.replace(/\D/g, '')
    if (!typed) return
    const current = valueRef.current
    // Never leave a gap: a digit typed past the first empty box lands in that box.
    const at = Math.min(i, current.length)
    if (typed.length > 1) {
      // Autofill, fast typing or typing into a filled box: take the new characters from this box on.
      const incoming = current[at] && typed.startsWith(current[at]) && typed.length === 2 ? typed.slice(1) : typed
      const next = commit(current.slice(0, at) + incoming)
      focus(Math.min(next.length, length - 1))
      return
    }
    const next = commit(current.slice(0, at) + typed + current.slice(at + 1))
    focus(Math.min(at + 1, next.length, length - 1))
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    const current = valueRef.current
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (current[i]) {
        commit(current.slice(0, i))
        focus(i)
      } else if (i > 0) {
        commit(current.slice(0, i - 1))
        focus(i - 1)
      }
    } else if (e.key === 'Delete') {
      e.preventDefault()
      if (current[i]) commit(current.slice(0, i))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(Math.min(i + 1, current.length))
    } else if (e.key === 'Home') {
      e.preventDefault()
      focus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focus(Math.min(current.length, length - 1))
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!text) return
    e.preventDefault()
    const next = commit(text)
    focus(Math.min(next.length, length - 1))
  }

  const half = Math.floor(length / 2)

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      dir="ltr"
      className={cn('flex items-center justify-between gap-2 sm:gap-2.5', invalid && 'motion-safe:animate-otp-shake')}
    >
      {digits.map((d, i) => {
        const isActive = active === i
        return (
          <div key={i} className="contents">
            {i === half && <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full bg-line-strong" />}
            <div className="relative min-w-0 flex-1">
              <input
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                pattern="[0-9]*"
                maxLength={length}
                aria-label={`Digit ${i + 1} of ${length}`}
                aria-invalid={invalid || undefined}
                disabled={disabled}
                value={d}
                onChange={(e) => onInput(i, e.target.value)}
                onKeyDown={(e) => onKey(e, i)}
                onPaste={onPaste}
                onFocus={(e) => {
                  setActive(i)
                  // Focus never skips ahead of the first empty box (reads the latest value).
                  const len = valueRef.current.length
                  if (i > len) focus(len)
                  else e.target.select()
                }}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                className={cn(
                  'num block aspect-[4/5] h-auto w-full max-w-14 rounded-xl border-[1.5px] bg-surface text-center text-2xl font-semibold text-ink caret-transparent shadow-xs outline-none transition-[border-color,box-shadow,background-color,transform] duration-150',
                  'focus:border-brand-500 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-brand-500)_18%,transparent)]',
                  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
                  invalid
                    ? 'border-danger-500 bg-danger-50/40 text-danger-600 dark:bg-danger-500/10'
                    : d
                      ? 'border-brand-300 bg-brand-50/50 dark:border-brand-500/50 dark:bg-brand-500/10'
                      : 'border-line-strong hover:border-subtle',
                  d && !invalid && 'motion-safe:animate-otp-pop',
                )}
              />
              {/* A soft caret in the active empty box, since the native caret is hidden. */}
              {isActive && !d && !disabled && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-6 w-0.5 -translate-y-1/2 rounded-full bg-brand-500 motion-safe:animate-pulse" />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** "Demo code: 123456" hint, shown only against the mock API (there is no real authenticator). */
export function DemoOtpHint({ className, onUse }: { className?: string; onUse?: (code: string) => void }) {
  if (!MOCK_API) return null
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 dark:border-brand-500/20 dark:bg-brand-500/10', className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-brand-600 shadow-xs dark:text-brand-300">
        <KeyRound className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-xs text-muted">
          Demo code <span className="num ms-1 text-[0.8125rem] font-semibold tracking-[0.2em] text-ink">{DEMO_OTP}</span>
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-subtle">No authenticator app is connected in the demo.</p>
      </div>
      {onUse && (
        <button
          type="button"
          onClick={() => onUse(DEMO_OTP)}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-500/20"
        >
          Use it
        </button>
      )}
    </div>
  )
}
