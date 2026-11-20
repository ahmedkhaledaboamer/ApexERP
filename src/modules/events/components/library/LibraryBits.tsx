import { useState, type ReactNode } from 'react'
import { Lock, Star } from 'lucide-react'
import type { VendorStatus, VenueStatus } from '@/modules/events/libraryTypes'
import { LIBRARY_CURRENCIES, VENDOR_STATUS_LABEL } from '@/modules/events/libraryTypes'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { EmptyState, ErrorState } from '@/shared/components/ui/Feedback'
import { SelectInput, TextInput } from '@/shared/components/form/Field'

/** Shared pieces of the Speakers / Venues / Vendors pages. */

export const isForbidden = (err: unknown) => (err as { status?: number } | null)?.status === 403

/** The page body when the list / detail failed: a calm "no access" for 403, the usual error otherwise. */
export function LibraryError({ error, onRetry, what }: { error: Error; onRetry: () => void; what: string }) {
  if (isForbidden(error)) {
    return <EmptyState icon={<Lock />} title={`${what} are for marketing and event teams`} body={error.message} />
  }
  return <ErrorState message={error.message} onRetry={onRetry} />
}

/** 1–5 stars (read-only), with the number. */
export function Rating({ value, count, className }: { value: number | null; count?: number; className?: string }) {
  if (value === null) return <span className={cn('text-xs text-muted', className)}>Not rated</span>
  return (
    <span className={cn('inline-flex items-center gap-1 text-[0.8125rem] text-ink-2', className)} aria-label={`Rated ${value} of 5`}>
      <Star className="size-3.5 fill-warning-500 text-warning-500" aria-hidden />
      <span className="num">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-xs text-muted">({count})</span>}
    </span>
  )
}

/** 1–5 star picker (radio group). */
export function RatingInput({ value, onChange, label = 'Rating' }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          className="rounded p-0.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <Star className={cn('size-5', n <= value ? 'fill-warning-500 text-warning-500' : 'text-muted/50')} aria-hidden />
        </button>
      ))}
    </div>
  )
}

/** Comma-separated tags, kept as a list. */
export function TagsInput({ id, value, onChange, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <TextInput
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))
      }}
    />
  )
}

export function Tags({ tags, empty = '—' }: { tags: string[]; empty?: ReactNode }) {
  if (!tags.length) return <span className="text-muted">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} tone="neutral">
          {t}
        </Badge>
      ))}
    </span>
  )
}

export function CurrencySelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {LIBRARY_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </SelectInput>
  )
}

const VENDOR_TONE: Record<VendorStatus, 'green' | 'blue' | 'red'> = { preferred: 'green', approved: 'blue', blacklisted: 'red' }

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  return <Badge tone={VENDOR_TONE[status]}>{VENDOR_STATUS_LABEL[status]}</Badge>
}

export function VenueStatusBadge({ status }: { status: VenueStatus }) {
  return status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null
}
