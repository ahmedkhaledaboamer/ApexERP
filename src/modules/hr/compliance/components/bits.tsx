import type { ReactNode } from 'react'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import type { HrFile } from '@/modules/hr/peopleTypes'
import { policyBlocks } from '../rules'
import { ACK_STATUS_LABEL, DISCIPLINARY_STATUS_LABEL, DISCIPLINARY_TYPE_LABEL, POLICY_STATUS_LABEL, type AckStatus, type DisciplinaryStatus, type DisciplinaryType, type EscalationHint, type PolicyStatus } from '../types'

export const DISCIPLINE_PATH = '/hr/discipline'
export const POLICIES_PATH = '/hr/policies'
export const MY_POLICIES_PATH = '/hr/me/policies'
export const policyPath = (id: string) => `/hr/policies/${encodeURIComponent(id)}`
export const warningLetterPath = (id: string, language = 'en') => `/hr/discipline/${encodeURIComponent(id)}/letter?language=${language}`

const TYPE_TONE: Record<DisciplinaryType, Tone> = {
  verbal_warning: 'sky',
  written_warning: 'amber',
  final_warning: 'red',
  suspension_paid: 'pink',
  suspension_unpaid: 'red',
  deduction: 'pink',
}
export function TypeBadge({ type }: { type: DisciplinaryType }) {
  return <Badge tone={TYPE_TONE[type]}>{DISCIPLINARY_TYPE_LABEL[type]}</Badge>
}

const STATUS_TONE: Record<DisciplinaryStatus, Tone> = { active: 'blue', expired: 'neutral', withdrawn: 'neutral' }
export function RecordStatusBadge({ status }: { status: DisciplinaryStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{DISCIPLINARY_STATUS_LABEL[status]}</Badge>
}

const ACK_TONE: Record<AckStatus, Tone> = { pending: 'amber', acknowledged: 'green', appealed: 'red' }
export function AckBadge({ status }: { status: AckStatus }) {
  return <Badge tone={ACK_TONE[status]}>{ACK_STATUS_LABEL[status]}</Badge>
}

const POLICY_TONE: Record<PolicyStatus, Tone> = { draft: 'neutral', published: 'green', archived: 'neutral' }
export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  return <Badge tone={POLICY_TONE[status]}>{POLICY_STATUS_LABEL[status]}</Badge>
}

export function EscalationNote({ hint }: { hint: EscalationHint | null | undefined }) {
  if (!hint?.message) return null
  return (
    <p role="note" className="rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500" data-testid="escalation-hint">
      {hint.message}
    </p>
  )
}

/** "45%" bar for acknowledgement progress. */
export function AckBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${pct}% acknowledged`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-success-500' : 'bg-accent-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="num text-xs text-ink-2">{pct}%</span>
    </div>
  )
}

/** A policy body in its light format (headings, bullets, bold) as text elements — never HTML. */
export function PolicyBody({ body }: { body: string }) {
  const blocks = policyBlocks(body)
  if (!blocks.length) return null
  const out: ReactNode[] = []
  let bullets: ReactNode[] = []
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`} className="list-disc space-y-1 ps-5">{bullets}</ul>)
    bullets = []
  }
  blocks.forEach((b, i) => {
    const runs = b.runs.map((r, j) => (r.bold ? <strong key={j} className="font-semibold">{r.text}</strong> : <span key={j}>{r.text}</span>))
    if (b.kind === 'bullet') return void bullets.push(<li key={i}>{runs}</li>)
    flush()
    out.push(b.kind === 'heading' ? <h3 key={i} className="pt-2 text-[0.9375rem] font-semibold text-ink">{runs}</h3> : <p key={i}>{runs}</p>)
  })
  flush()
  return (
    <div className="space-y-2 text-[0.875rem] leading-relaxed text-ink-2" dir="auto" data-testid="policy-body">
      {out}
    </div>
  )
}

export function FileLink({ file }: { file: HrFile | null }) {
  if (!file) return null
  const kb = Math.max(1, Math.round(file.sizeBytes / 1024))
  return file.url ? (
    <a href={file.url} download={file.name} className="text-[0.8125rem] font-medium text-accent-700 hover:underline dark:text-accent-300">
      {file.name} ({kb} KB)
    </a>
  ) : (
    <span className="text-[0.8125rem] text-ink-2">
      {file.name} ({kb} KB)
    </span>
  )
}
