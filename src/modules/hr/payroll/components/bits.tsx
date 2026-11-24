import type { ReactNode } from 'react'
import type { RunStatus } from '@/modules/hr/payroll/types'
import { RUN_STATUS_LABEL } from '@/modules/hr/payroll/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { cn } from '@/shared/lib/utils'

/** Shared pieces of the Salary Management screens. */

/** 12,345.50 (2 decimals; payroll amounts are exact to the fils / halala). */
export function fmt2(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function Amount({ value, currency, className, strong }: { value: number; currency?: string; className?: string; strong?: boolean }) {
  return (
    <span className={cn('num whitespace-nowrap', strong && 'font-semibold text-ink', value < 0 && 'text-danger-600', className)}>
      {currency ? <span className="me-1 text-xs text-muted">{currency}</span> : null}
      {fmt2(value)}
    </span>
  )
}

const RUN_TONE: Record<RunStatus, Tone> = { draft: 'neutral', calculated: 'amber', approved: 'blue', paid: 'green' }
export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge tone={RUN_TONE[status]} variant="dot">{RUN_STATUS_LABEL[status]}</Badge>
}

/** A plain data table (payroll lists are short; no column picker needed). */
export function SimpleTable({ label, head, children, className }: { label: string; head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative overflow-x-auto rounded-xl border border-line bg-surface', className)}>
      <table className="w-full text-[0.8125rem]" aria-label={label}>
        <thead className="border-b border-line bg-sunken/60 text-start text-xs text-muted">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}
export const th = 'px-3 py-2 text-start font-medium whitespace-nowrap'
export const thEnd = 'px-3 py-2 text-end font-medium whitespace-nowrap'
export const td = 'px-3 py-2 align-top'
export const tdEnd = 'px-3 py-2 text-end align-top'

/** Saves a text file in the browser (bank files). */
export function downloadText(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "The rates are defaults, not legal advice" note. */
export function DefaultsNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-xs text-ink-2">
      {children ?? 'Statutory rates and rules here are defaults for UAE / KSA that HR must confirm for the company. They are not legal or tax advice.'}
    </p>
  )
}
