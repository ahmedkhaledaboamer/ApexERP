import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'
import { useReadOnly, useReadOnlyHint } from '@/shared/lib/readOnly'

/** `gradient` is kept as an alias of `primary` for older call sites. */
type Variant = 'primary' | 'gradient' | 'secondary' | 'ghost' | 'danger' | 'ai'
type Size = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Square button holding a single icon; pass `aria-label`. */
  iconOnly?: boolean
  /**
   * A create / edit / delete / send / import action. While the workspace is read-only (subscription
   * Suspended or Cancelled) it is disabled with the tooltip "Workspace is read-only". It stays
   * hoverable (aria-disabled, clicks swallowed) so the tooltip can explain why.
   */
  write?: boolean
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-600',
  gradient:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-600',
  secondary: 'border border-line-strong bg-surface text-ink shadow-xs hover:bg-hover active:bg-sunken',
  ghost: 'text-muted hover:bg-hover hover:text-ink',
  danger: 'bg-danger-600 text-white shadow-xs hover:bg-danger-700',
  ai: 'bg-brand-gradient text-white shadow-xs hover:brightness-110',
}

const SIZES: Record<Size, string> = {
  xs: 'h-7 gap-1 rounded-md px-2 text-xs',
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-[0.8125rem]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-[0.8125rem]',
  lg: 'h-10 gap-2 rounded-lg px-4 text-sm',
}

const ICON_ONLY: Record<Size, string> = {
  xs: 'w-7 px-0',
  sm: 'w-8 px-0',
  md: 'w-9 px-0',
  lg: 'w-10 px-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, iconOnly = false, write = false, disabled, className, children, type = 'button', onClick, title, ...rest },
  ref,
) {
  const readOnly = useReadOnly()
  const readOnlyHint = useReadOnlyHint()
  const blocked = write && readOnly
  return (
    <button
      ref={ref}
      type={type}
      disabled={(disabled || loading) && !blocked}
      aria-busy={loading || undefined}
      aria-disabled={blocked || undefined}
      data-read-only={blocked || undefined}
      title={blocked ? readOnlyHint : title}
      onClick={
        blocked
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
            }
          : onClick
      }
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,filter,box-shadow] duration-150 ease-out select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        iconOnly && ICON_ONLY[size],
        blocked && 'cursor-not-allowed opacity-50 hover:brightness-100',
        className,
      )}
      {...rest}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  )
})
