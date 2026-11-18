import type { Tone } from '@/shared/components/ui/Badge'
import type { SubscriptionStatus } from '@/modules/billing/types'
import type { CountryCode } from '@/modules/tenancy/types'

export const SUB_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  trialing: { label: 'Trial', tone: 'sky' },
  active: { label: 'Active', tone: 'green' },
  past_due: { label: 'Past due', tone: 'amber' },
  suspended: { label: 'Suspended', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  deleted: { label: 'Deleted', tone: 'neutral' },
}

export const SUB_STATUSES = Object.keys(SUB_STATUS) as SubscriptionStatus[]

export const COUNTRY_LABEL: Record<CountryCode, string> = {
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  EG: 'Egypt',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
}
export const COUNTRIES = Object.keys(COUNTRY_LABEL) as CountryCode[]

const dateFmt = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 days ago", "in 2 hours". */
export function fmtRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'Never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = (t - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day')
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), 'month')
  return rtf.format(Math.round(diff / (86_400 * 365)), 'year')
}

export function fmtMoney(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return '—'
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** ISO → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** <input type="datetime-local"> value → ISO (null when empty or invalid). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Minimum length for every platform write reason. */
export const MIN_REASON = 3
/** Impersonation needs a real explanation (shown to the company admin). */
export const MIN_IMPERSONATION_REASON = 10
