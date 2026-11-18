/**
 * Wall-clock time in an IANA timezone without a date library: the company's local date / time of an
 * instant, and the instant of a company-local date + time. Used by the Events module (event dates are
 * entered and shown in the company's timezone, stored as UTC instants).
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timezone, f)
  }
  return f
}

/** Local calendar date (yyyy-MM-dd) and time (HH:mm) of an instant in `timezone`. */
export function zonedParts(instant: string | number | Date, timezone: string): { date: string; time: string } {
  const d = instant instanceof Date ? instant : new Date(instant)
  const parts = Object.fromEntries(formatter(timezone).formatToParts(d).map((p) => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` }
}

/** Offset of `timezone` from UTC at an instant, in minutes (Dubai: +240). */
function offsetMinutes(ms: number, timezone: string): number {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, parts.hour === '24' ? 0 : +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The UTC instant (ISO) of a local `date` (yyyy-MM-dd) and `time` (HH:mm, default 00:00) in `timezone`. */
export function zonedToUtc(date: string, time: string | null | undefined, timezone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes settle the offset around DST changes.
  let ms = wall - offsetMinutes(wall, timezone) * 60_000
  ms = wall - offsetMinutes(ms, timezone) * 60_000
  return new Date(ms).toISOString()
}

/** True when `date` is a real calendar date in yyyy-MM-dd. */
export function isRealIsoDate(date: unknown): date is string {
  if (typeof date !== 'string' || !ISO_DATE.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
