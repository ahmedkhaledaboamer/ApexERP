import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { PaymentLinkStatus, PaymentStatus, PdcStatus } from '@/modules/finance/collections/types'
import { PAYMENT_LINK_STATUS_LABEL, PDC_STATUS_LABEL } from '@/modules/finance/collections/types'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { getRegion } from '@/shared/lib/region'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { EmptyState, ErrorState } from '@/shared/components/ui/Feedback'
import { cn } from '@/shared/lib/utils'

/** Shared pieces of the Payments and Receivables screens. */

/** 12,345.50 (two decimals). */
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

/** The company's today (regional timezone), yyyy-MM-dd. */
export const companyToday = () => todayIsoIn(getRegion().timezone)
export const baseCurrency = () => getRegion().currency

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return status === 'void' ? <Badge tone="neutral">Void</Badge> : <Badge tone="green" variant="dot">Posted</Badge>
}

const PDC_TONE: Record<PdcStatus, Tone> = { received: 'amber', deposited: 'blue', cleared: 'green', bounced: 'red' }
export function PdcStatusBadge({ status }: { status: PdcStatus }) {
  return <Badge tone={PDC_TONE[status]} variant="dot">{PDC_STATUS_LABEL[status]}</Badge>
}

const LINK_TONE: Record<PaymentLinkStatus, Tone> = { active: 'blue', paid: 'green', expired: 'neutral', void: 'neutral' }
export function LinkStatusBadge({ status }: { status: PaymentLinkStatus }) {
  return <Badge tone={LINK_TONE[status]}>{PAYMENT_LINK_STATUS_LABEL[status]}</Badge>
}

/** A plain data table. */
export function SimpleTable({ label, head, children, foot, className }: { label: string; head: ReactNode; children: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-line bg-surface', className)}>
      <table className="w-full text-[0.8125rem]" aria-label={label}>
        <thead className="border-b border-line bg-sunken/60 text-start text-xs text-muted">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
        {foot ? <tfoot className="border-t-2 border-line-strong font-semibold">{foot}</tfoot> : null}
      </table>
    </div>
  )
}
export const th = 'px-3 py-2 text-start font-medium whitespace-nowrap'
export const thEnd = 'px-3 py-2 text-end font-medium whitespace-nowrap'
export const td = 'px-3 py-2 align-top'
export const tdEnd = 'px-3 py-2 text-end align-top'

export const isForbidden = (err: unknown) => (err as { status?: number } | null)?.status === 403

export function FinError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isForbidden(error)) return <EmptyState icon={<Lock />} title="This finance page isn’t available to you" body={error.message} />
  return <ErrorState message={error.message} onRetry={onRetry} />
}

/** Saves a text file in the browser (CSV exports). */
export function downloadText(fileName: string, content: string, mimeType = 'text/csv'): void {
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

/** CSV with quoting (and a guard against formula injection). */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v)
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n')
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
