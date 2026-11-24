import type { ReactNode } from 'react'
import { EyeOff } from 'lucide-react'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { SURVEY_STATUS_LABEL, type SurveyStatus } from '../types'

const STATUS_TONE: Record<SurveyStatus, Tone> = { draft: 'neutral', scheduled: 'sky', open: 'green', closed: 'neutral' }
export const SurveyStatusBadge = ({ status }: { status: SurveyStatus }) => <Badge tone={STATUS_TONE[status]}>{SURVEY_STATUS_LABEL[status]}</Badge>

/** The threshold message shown instead of a result. */
export function NotEnough({ min, responses, children }: { min: number; responses?: number; children?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-sunken px-3 py-2 text-xs text-muted" data-testid="not-enough">
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      <span>
        Not enough responses to show{responses !== undefined ? ` (${responses} so far; at least ${min} needed to protect anonymity)` : ` (at least ${min} needed)`}.{children}
      </span>
    </p>
  )
}

export function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-1 text-xl font-semibold text-ink" data-testid={testId}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export const fmtEnps = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n}`)
export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2))
export const fmtRate = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`)
