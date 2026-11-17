import { cn, initials } from '@/shared/lib/utils'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<Size, string> = {
  xs: 'size-5 text-[0.5625rem]',
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
}

/** Stable per-name colours, so a person keeps the same avatar everywhere. */
const PALETTE = [
  'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
  'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300',
  'bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-500',
  'bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-500',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  'bg-info-100 text-info-700 dark:bg-info-500/20 dark:text-info-500',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
]

function colourFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

interface AvatarProps {
  name: string
  size?: Size
  /** Square with rounded corners, for companies (Attio style). People are round. */
  square?: boolean
  className?: string
}

export function Avatar({ name, size = 'md', square = false, className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold select-none',
        square ? 'rounded-md' : 'rounded-full',
        SIZES[size],
        colourFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

export function AvatarGroup({ names, max = 3, size = 'sm' }: { names: string[]; max?: number; size?: Size }) {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return (
    <span className="flex items-center -space-x-1.5" title={names.join(', ')}>
      {shown.map((n) => (
        <Avatar key={n} name={n} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span className={cn('inline-flex items-center justify-center rounded-full bg-sunken font-medium text-muted ring-2 ring-surface', SIZES[size])}>
          +{rest}
        </span>
      )}
    </span>
  )
}
