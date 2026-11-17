import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
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

/** Segmented one-time-code input: one box per digit, paste fills all, arrows and backspace move. */
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
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  function focus(i: number) {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))]
    el?.focus()
    el?.select()
  }

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
  }

  function setAt(i: number, d: string) {
    const arr = digits.slice()
    arr[i] = d
    // Keep the value contiguous: anything after an empty box is dropped.
    const firstEmpty = arr.indexOf('')
    commit((firstEmpty === -1 ? arr : arr.slice(0, firstEmpty)).join(''))
  }

  function onInput(i: number, raw: string) {
    const d = raw.replace(/\D/g, '')
    if (!d) return
    if (d.length > 1) {
      // Autofill / fast typing delivered several digits into one box.
      commit((value.slice(0, i) + d).slice(0, length))
      focus(i + d.length)
      return
    }
    setAt(Math.min(i, value.length), d)
    focus(Math.min(i, value.length) + 1)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) {
        commit(value.slice(0, i))
      } else if (i > 0) {
        commit(value.slice(0, i - 1))
        focus(i - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(Math.min(i + 1, value.length))
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!text) return
    e.preventDefault()
    commit(text)
    focus(text.length)
  }

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex items-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
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
            // Don't let focus skip ahead of the first empty box.
            if (i > value.length) focus(value.length)
            else e.target.select()
          }}
          className={cn(
            'num h-12 w-full min-w-0 max-w-12 rounded-lg border bg-surface text-center text-xl font-semibold text-ink shadow-xs transition-[border-color,box-shadow] duration-150 focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
            invalid ? 'border-danger-500' : d ? 'border-line-strong' : 'border-line-strong hover:border-subtle',
            i === length / 2 - 1 && 'me-2',
          )}
        />
      ))}
    </div>
  )
}

/** "Demo code: 123456" hint, shown only against the mock API (there is no real authenticator). */
export function DemoOtpHint({ className, onUse }: { className?: string; onUse?: (code: string) => void }) {
  if (!MOCK_API) return null
  return (
    <p className={cn('flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-muted', className)}>
      <KeyRound className="size-3.5 shrink-0" aria-hidden />
      <span>
        Demo code: <span className="num font-semibold tracking-[0.15em] text-ink">{DEMO_OTP}</span>
      </span>
      <span className="text-subtle">· no authenticator app is connected in the demo</span>
      {onUse && (
        <button type="button" onClick={() => onUse(DEMO_OTP)} className="ms-auto font-medium text-brand-600 hover:underline dark:text-brand-300">
          Use it
        </button>
      )}
    </p>
  )
}
