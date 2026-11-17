/** UAE mobile: +971 5X XXX XXXX, spaces optional. */
export const UAE_MOBILE = /^\+971\s?5\d\s?\d{3}\s?\d{4}$/

export function isUaeMobile(value: string): boolean {
  return UAE_MOBILE.test(value.trim())
}

/** Normalizes local forms (05X…, 9715X…, 5X…) to +9715XXXXXXXX; returns null if it isn't a UAE mobile. */
export function normalizeUaeMobile(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  const local = digits.startsWith('971') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits
  return /^5\d{8}$/.test(local) ? `+971${local}` : null
}

/** +971 5X XXX XXXX for display. */
export function formatUaeMobile(value: string): string {
  const n = normalizeUaeMobile(value)
  if (!n) return value
  return `+971 ${n.slice(4, 6)} ${n.slice(6, 9)} ${n.slice(9)}`
}
