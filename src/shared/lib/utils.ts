import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, isValid, parseISO } from 'date-fns'
import { getRegion, inTenantZone } from '@/shared/lib/region'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return isValid(d) ? d : null
}

/**
 * Formats in the tenant's date format and timezone (Settings > Company > Regional). Timestamps
 * are shown in the tenant timezone; date-only values (yyyy-MM-dd) are never shifted.
 */
export function fmtDate(value: string | null | undefined, pattern?: string): string {
  const d = toDate(value)
  if (!d) return '—'
  const zoned = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? d : inTenantZone(d)
  return format(zoned, pattern ?? getRegion().dateFormat)
}

/** Amount in the tenant currency unless one is given. */
export function fmtMoney(value: number, currency = getRegion().currency): string {
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`
}

export function fmtCompactMoney(value: number, currency = getRegion().currency): string {
  return `${currency} ${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
