import type { LookupsApi } from '@/shared/hooks/useLookups'

/** Separator between the loss-reason key and the optional free-text details on a lead. */
export const LOSS_DETAIL_SEPARATOR = ' — '

/** Stored value for a loss reason: the lookup key, plus " — details" when given. */
export function composeLossReason(key: string, detail: string): string {
  const d = detail.trim()
  return d ? `${key}${LOSS_DETAIL_SEPARATOR}${d}` : key
}

/**
 * Key of the protected system loss reason "Imported - no reason recorded" (Settings > Fixed lists).
 * Only the Excel import may set it; it is hidden from pickers, so agents can't choose it.
 */
export const IMPORTED_LOSS_REASON = 'imported-no-reason'

/** Free text older imports stored before the system item existed; read as IMPORTED_LOSS_REASON. */
export const LEGACY_IMPORTED_LOSS_TEXT = 'Imported from Excel (no reason recorded)'

/**
 * Display text for a stored loss reason: the reason's current label (so renames show), followed
 * by any details. Values that match no reason are shown as stored.
 */
export function lossReasonText(lookups: LookupsApi, stored: string): string {
  if (!stored) return ''
  const value = stored === LEGACY_IMPORTED_LOSS_TEXT ? IMPORTED_LOSS_REASON : stored
  const match = [...lookups.all.lossReasons]
    .sort((a, b) => b.key.length - a.key.length)
    .find((r) => value === r.key || value.startsWith(`${r.key}${LOSS_DETAIL_SEPARATOR}`))
  if (!match) return value === IMPORTED_LOSS_REASON ? 'Imported - no reason recorded' : value
  return match.label + value.slice(match.key.length)
}

/** The lookup key part of a stored loss reason, or '' when it matches no list item. */
export function lossReasonKey(lookups: LookupsApi, stored: string): string {
  const value = stored === LEGACY_IMPORTED_LOSS_TEXT ? IMPORTED_LOSS_REASON : stored
  return (
    [...lookups.all.lossReasons]
      .sort((a, b) => b.key.length - a.key.length)
      .find((r) => value === r.key || value.startsWith(`${r.key}${LOSS_DETAIL_SEPARATOR}`))?.key ?? ''
  )
}
