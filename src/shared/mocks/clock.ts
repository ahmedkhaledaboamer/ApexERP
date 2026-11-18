import { registerValue } from '@/shared/mocks/persist/registry'

/**
 * The mock API's clock: real time plus a simulated offset (dev: POST /dev/billing/advance moves it
 * forward). Billing, the subscription lifecycle and usage periods read time from here, so a demo can
 * walk a trial to its end without waiting. The offset is persisted with the mock DB.
 */

const DAY_MS = 86_400_000

let offsetMs = 0
registerValue('clock.offsetMs', () => offsetMs, (v) => { offsetMs = Number(v) || 0 })

/** Simulated now (ms since epoch). */
export function nowMs(): number {
  return Date.now() + offsetMs
}

/** Simulated now as a Date. */
export function now(): Date {
  return new Date(nowMs())
}

/** Simulated now as an ISO string. */
export function nowIso(): string {
  return now().toISOString()
}

/** Whole days the clock is ahead of real time (may be fractional after a reset mid-day; rounded). */
export function offsetDays(): number {
  return Math.round((offsetMs / DAY_MS) * 1000) / 1000
}

/** Moves the simulated clock forward by `days`. */
export function advanceClock(days: number): void {
  offsetMs += days * DAY_MS
}

/** Back to real time (tests, dev reset). */
export function resetClock(): void {
  offsetMs = 0
}
