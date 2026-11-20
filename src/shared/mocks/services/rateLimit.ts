import { nowMs } from '@/shared/mocks/clock'
import { CodedApiError } from '@/shared/mocks/tenant'

/** One counted attempt of a public endpoint (not company data). */
export interface RateHit {
  key: string
  at: number
}

/**
 * Sliding-window rate limit of the public endpoints (event registration, lead capture forms): at most
 * `limit` hits per key in `windowMs` (mock clock). Over the limit → 429 `rate_limited` with the wait;
 * otherwise every key is counted once. Old hits are dropped from `hits` as it goes.
 */
export function hitRateLimit(hits: RateHit[], keys: string[], opts: { limit: number; windowMs: number; what: string }): void {
  const t = nowMs()
  for (let i = hits.length - 1; i >= 0; i--) if (t - hits[i].at >= opts.windowMs) hits.splice(i, 1)
  for (const key of keys) {
    const mine = hits.filter((h) => h.key === key)
    if (mine.length >= opts.limit) {
      const retry = Math.max(1, Math.ceil((Math.min(...mine.map((h) => h.at)) + opts.windowMs - t) / 1000))
      throw new CodedApiError(`Too many ${opts.what} attempts. Try again in ${retry} seconds.`, 429, 'rate_limited')
    }
  }
  for (const key of keys) hits.push({ key, at: t })
}
