let names: Intl.DisplayNames | null = null

/** English country name for an ISO 3166-1 alpha-2 code ("EG" → "Egypt"); falls back to the code, "—" when empty. */
export function countryLabel(code: string | null | undefined): string {
  if (!code) return '—'
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return names.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}
