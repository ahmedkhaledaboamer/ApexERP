/** Milliseconds left until `expiresAt` (never negative; 0 for a missing or invalid date). */
export function msUntil(expiresAt: string | null | undefined, now: number = Date.now()): number {
  if (!expiresAt) return 0
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) ? Math.max(0, t - now) : 0
}

/** "mm:ss" (minutes keep counting past 59, e.g. "75:00"); rounds up so 0:00 only shows at the end. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Spoken form for screen readers: "14 minutes 5 seconds left". */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  const parts: string[] = []
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
  if (s || !m) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`)
  return `${parts.join(' ')} left`
}
