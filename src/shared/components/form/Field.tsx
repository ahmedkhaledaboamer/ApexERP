import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/** Label, control, hint and error for one form field. */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">
        {label}
        {required && (
          <span className="ms-0.5 text-danger-600" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded-lg border bg-surface px-3 text-[0.8125rem] text-ink shadow-xs placeholder:text-subtle transition-[border-color,box-shadow] duration-150 focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70'

function controlState(invalid?: boolean) {
  return invalid ? 'border-danger-500' : 'border-line-strong hover:border-subtle'
}

type Invalid = { invalid?: boolean }

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Invalid>(
  function TextInput({ invalid, className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, 'h-9', controlState(invalid), className)}
        {...rest}
      />
    )
  },
)

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Invalid>(
  function SelectInput({ invalid, className, ...rest }, ref) {
    return (
      <span className="relative block">
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, 'h-9 appearance-none pe-8', controlState(invalid), className)}
          {...rest}
        />
        <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      </span>
    )
  },
)

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid>(
  function TextArea({ invalid, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, 'min-h-24 py-2 leading-relaxed', controlState(invalid), className)}
        {...rest}
      />
    )
  },
)

/** Compact search box for toolbars. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SearchInput(
  { className, ...rest },
  ref,
) {
  return (
    <span className={cn('relative block', className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        ref={ref}
        type="search"
        className="h-8 w-full rounded-md border border-line-strong bg-surface ps-8 pe-2.5 text-[0.8125rem] shadow-xs placeholder:text-subtle focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
        {...rest}
      />
    </span>
  )
})

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function Checkbox({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn('size-4 cursor-pointer rounded border-line-strong accent-brand-600', className)}
        {...rest}
      />
    )
  },
)

interface SwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-4 rounded-full bg-white shadow-xs transition-transform duration-150',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
