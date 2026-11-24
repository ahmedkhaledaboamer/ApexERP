import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AccountType, JournalSourceType } from '@/modules/finance/types'
import { ACCOUNT_TYPE_LABEL } from '@/modules/finance/types'
import { SOURCE_TYPE_LABEL } from '@/modules/finance/ledger/types'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { cn } from '@/shared/lib/utils'

/** Shared pieces of the ledger screens (overview, chart of accounts, journal, settings). */

export function Amount({ value, currency, className, strong, blankZero }: { value: number; currency?: string; className?: string; strong?: boolean; blankZero?: boolean }) {
  if (blankZero && value === 0) return <span className="text-subtle">—</span>
  return (
    <span className={cn('num whitespace-nowrap', strong && 'font-semibold text-ink', value < 0 && 'text-danger-600', className)}>
      {currency ? <span className="me-1 text-xs text-muted">{currency}</span> : null}
      {fmtMoney(value)}
    </span>
  )
}

const SOURCE_TONE: Partial<Record<JournalSourceType, Tone>> = { manual: 'neutral', opening_balance: 'teal', invoice: 'blue', credit_note: 'amber', payment: 'green', payment_refund: 'red', pdc: 'sky', payroll: 'pink' }
export function SourceBadge({ type }: { type: JournalSourceType }) {
  return <Badge tone={SOURCE_TONE[type] ?? 'neutral'}>{SOURCE_TYPE_LABEL[type]}</Badge>
}

const TYPE_TONE: Record<AccountType, Tone> = { asset: 'blue', liability: 'amber', equity: 'teal', income: 'green', expense: 'red' }
export function AccountTypeBadge({ type }: { type: AccountType }) {
  return <Badge tone={TYPE_TONE[type]} variant="dot">{ACCOUNT_TYPE_LABEL[type]}</Badge>
}

/** A plain table (ledger lists are short enough; no column picker). */
export function SimpleTable({ label, head, children, className, foot }: { label: string; head: ReactNode; children: ReactNode; className?: string; foot?: ReactNode }) {
  return (
    <div className={cn('relative overflow-x-auto rounded-xl border border-line bg-surface', className)}>
      <table className="w-full text-[0.8125rem]" aria-label={label}>
        <thead className="border-b border-line bg-sunken/60 text-start text-xs text-muted">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
        {foot && <tfoot className="border-t border-line-strong bg-sunken/40 font-semibold">{foot}</tfoot>}
      </table>
    </div>
  )
}
export const th = 'px-3 py-2 text-start font-medium whitespace-nowrap'
export const thEnd = 'px-3 py-2 text-end font-medium whitespace-nowrap'
export const td = 'px-3 py-2 align-top'
export const tdEnd = 'px-3 py-2 text-end align-top'

/** Link to a journal entry (opens the entry drawer on the Journal page). */
export function EntryLink({ id, number }: { id: string; number: string }) {
  return (
    <Link to={`/finance/journal?entry=${encodeURIComponent(id)}`} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">
      {number}
    </Link>
  )
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
