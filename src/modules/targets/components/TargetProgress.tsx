import { Info } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { EVENTS_NA_HINT, EVENTS_NA_LABEL } from '@/shared/lib/features'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { hasTarget, isTracked, paceTone, pctOf, TONE_BAR, TONE_TEXT } from '@/modules/targets/lib'
import type { TargetKey } from '@/modules/targets/types'

/**
 * Muted "n/a until Events is enabled" with an explaining tooltip, used wherever an untracked
 * kind's figure would be (see isTracked). Optional `target` mentions a target that is set.
 */
export function TargetNotTracked({ target, className }: { target?: number; className?: string }) {
  return (
    <Tooltip label={EVENTS_NA_HINT}>
      <span
        tabIndex={0}
        className={cn(
          'inline-flex items-center gap-1 rounded text-xs whitespace-nowrap text-subtle outline-none focus-visible:shadow-[var(--shadow-focus)]',
          className,
        )}
      >
        {EVENTS_NA_LABEL}
        {target !== undefined && hasTarget(target) && <span className="num text-subtle"> · target {target}</span>}
        <Info className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">. {EVENTS_NA_HINT}</span>
      </span>
    </Tooltip>
  )
}

interface TargetProgressProps {
  /** The kind shown; kinds not tracked yet (events) render "n/a" instead of a bar. */
  kind?: TargetKey
  actual: number
  target: number
  /** Share of the month elapsed, 0..1; draws the "should be here by today" tick. */
  elapsed: number
  /** `cell`: compact matrix cell. `row`: label line above a wider bar. */
  layout?: 'cell' | 'row'
  label?: string
  className?: string
}

/** actual / target with a thin bar, coloured by how it compares with today's pace. A 0 target reads "No target". */
export function TargetProgress({ kind, actual, target, elapsed, layout = 'cell', label, className }: TargetProgressProps) {
  if (kind && !isTracked(kind)) {
    return (
      <div className={cn(layout === 'cell' ? 'min-w-[5.75rem]' : '', className)}>
        <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
          {label && <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>}
          <TargetNotTracked />
        </div>
        <div aria-hidden className={cn('mt-1.5 rounded-full border border-dashed border-line', layout === 'cell' ? 'h-1' : 'h-1.5')} />
      </div>
    )
  }

  if (!hasTarget(target)) {
    return (
      <div className={cn(layout === 'cell' ? 'min-w-[5.75rem]' : '', className)}>
        <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
          {label && <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>}
          <span className="text-xs whitespace-nowrap text-subtle">{actual > 0 ? `${actual} · No target` : 'No target'}</span>
        </div>
        <div aria-hidden className={cn('mt-1.5 rounded-full border border-dashed border-line-strong', layout === 'cell' ? 'h-1' : 'h-1.5')} />
      </div>
    )
  }

  const pct = pctOf(actual, target)
  const tone = paceTone(pct, elapsed)
  const showTick = elapsed > 0 && elapsed < 1

  return (
    <div className={cn(layout === 'cell' ? 'min-w-[5.75rem]' : '', className)}>
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        {label && <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>}
        <span className="num whitespace-nowrap">
          <span className="font-semibold text-ink">{actual}</span>
          <span className="text-muted"> / {target}</span>
        </span>
        <span className={cn('num text-xs font-medium whitespace-nowrap', TONE_TEXT[tone], label && 'w-10 text-end')}>{Math.round(pct)}%</span>
      </div>
      <div
        className={cn('relative mt-1.5 overflow-hidden rounded-full bg-sunken', layout === 'cell' ? 'h-1' : 'h-1.5')}
        role="progressbar"
        aria-label={label ? `${label}: ${actual} of ${target}` : `${actual} of ${target}`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', TONE_BAR[tone])} style={{ width: `${Math.min(100, pct)}%` }} />
        {showTick && <span aria-hidden className="absolute inset-y-0 w-px bg-ink/35" style={{ left: `${elapsed * 100}%` }} />}
      </div>
    </div>
  )
}
