import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface StatCardProps {
  label: string
  value: ReactNode
  /** Small context line under the value (used when there's no delta). */
  hint?: ReactNode
  /** % change vs the previous period. */
  deltaLabel?: string
  delta?: number
  /** Show the value in the danger colour (e.g. overdue counts). */
  alert?: boolean
  /** Icon shown in the tile at the top right. */
  icon?: ReactNode
  to?: string
  /** 0..100 progress bar, for targets. */
  progress?: number
  /** Sparkline values, oldest first. */
  spark?: number[]
  sparkColor?: string
}

/** KPI card: label + icon tile, big value, change vs last period, optional sparkline. */
export function StatCard({ label, value, hint, delta, deltaLabel = "vs last period", alert, icon, to, progress, spark, sparkColor = "var(--color-brand-600)" }: StatCardProps) {
  const gradientId = useId().replace(/:/g, '')
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.9375rem] text-ink-2">{label}</p>
        {icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken/60 text-muted [&_svg]:size-[1.125rem]">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('num text-[1.75rem] leading-none font-bold whitespace-nowrap tracking-[-0.02em]', alert ? 'text-danger-600' : 'text-ink')}>{value}</p>
          {delta !== undefined && Number.isFinite(delta) ? (
            <p className="mt-3 flex flex-wrap items-center gap-1 text-[0.8125rem]">
              <span className={cn('num inline-flex items-center gap-1 font-semibold', delta >= 0 ? 'text-success-600' : 'text-danger-600')}>
                {delta >= 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(1)}%
              </span>
              <span className="text-muted">{deltaLabel}</span>
            </p>
          ) : hint ? (
            <p className="mt-3 truncate text-[0.8125rem] text-muted">{hint}</p>
          ) : null}
        </div>
        {spark && spark.length > 1 && (
          <div dir="ltr" className="h-12 w-28 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.75} fill={`url(#${gradientId})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full', progress >= 100 ? 'bg-success-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
    </>
  )
  const cls = 'block rounded-card border border-line bg-surface p-5 shadow-xs'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-soft')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** % change from `prev` to `current`; undefined when there's no base to compare with. */
export function pctChange(current: number, prev: number): number | undefined {
  if (!prev) return undefined
  return ((current - prev) / prev) * 100
}
