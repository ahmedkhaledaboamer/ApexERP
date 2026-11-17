import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Idle tracking shared by every tab of the app. The last activity time is kept in a ref and
 * mirrored (throttled) to localStorage, so activity in one tab keeps the others alive and
 * "Stay signed in" in one tab closes the warning in all of them.
 */

export const ACTIVITY_STORAGE_KEY = 'apex-aora.last-activity'
const WRITE_THROTTLE_MS = 5_000
const TICK_MS = 1_000
const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'wheel', 'touchstart'] as const

interface Stored {
  /** Which sign-in this belongs to, so a fresh sign-in never inherits an old idle time. */
  sid: string
  at: number
}

function readStored(sid: string): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    return v.sid === sid && typeof v.at === 'number' ? v.at : null
  } catch {
    return null
  }
}

function writeStored(sid: string, at: number) {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({ sid, at } satisfies Stored))
  } catch {
    // Storage unavailable: tabs then time out independently.
  }
}

export function clearStoredActivity() {
  try {
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

interface Options {
  /** Identifies the sign-in (e.g. a hash of the token). Empty disables tracking. */
  sid: string
  timeoutMs: number
  warningMs: number
  /** False until the real timeout is known; activity is still tracked, nothing is enforced. */
  enforce: boolean
  onTimeout: () => void
}

export interface IdleState {
  warningOpen: boolean
  secondsLeft: number
  /** Explicit "I'm here": resets the timer in every tab. */
  stay: () => void
}

export function useIdleTimeout({ sid, timeoutMs, warningMs, enforce, onTimeout }: Options): IdleState {
  const [warningOpen, setWarningOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const last = useRef(Date.now())
  const lastWrite = useRef(0)
  const warningRef = useRef(false)
  const doneRef = useRef(false)
  const opts = useRef({ timeoutMs, warningMs, enforce, onTimeout })
  opts.current = { timeoutMs, warningMs, enforce, onTimeout }

  const markActive = useCallback(
    (force: boolean) => {
      const now = Date.now()
      last.current = now
      if (force || now - lastWrite.current >= WRITE_THROTTLE_MS) {
        lastWrite.current = now
        writeStored(sid, now)
      }
    },
    [sid],
  )

  const tick = useCallback(() => {
    if (doneRef.current) return
    const stored = readStored(sid)
    if (stored !== null && stored > last.current) last.current = stored
    const { timeoutMs: t, warningMs: w, enforce: on } = opts.current
    if (!on) return
    const remaining = last.current + t - Date.now()
    if (remaining <= 0) {
      doneRef.current = true
      warningRef.current = false
      setWarningOpen(false)
      opts.current.onTimeout()
      return
    }
    const warn = remaining <= w
    warningRef.current = warn
    setWarningOpen(warn)
    setSecondsLeft(warn ? Math.ceil(remaining / 1000) : 0)
  }, [sid])

  // A new sign-in starts its own clock; a reload of the same sign-in keeps the shared one.
  useEffect(() => {
    if (!sid) return
    doneRef.current = false
    const stored = readStored(sid)
    if (stored === null) markActive(true)
    else last.current = stored
  }, [sid, markActive])

  useEffect(() => {
    if (!sid) return
    // While the warning shows, only its buttons count: its own appearance (focus moving
    // into the dialog, the pointer resting on it) must not quietly extend the session.
    const onActivity = () => {
      if (!warningRef.current && !doneRef.current) markActive(false)
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      tick() // Coming back after the limit signs out instead of counting as activity.
      onActivity()
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY) tick()
    }
    for (const ev of EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(tick, TICK_MS)
    tick()
    return () => {
      for (const ev of EVENTS) window.removeEventListener(ev, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
      window.clearInterval(timer)
    }
  }, [sid, markActive, tick])

  // A policy change (or the policy finishing loading) applies straight away.
  useEffect(() => {
    if (sid) tick()
  }, [sid, timeoutMs, warningMs, enforce, tick])

  const stay = useCallback(() => {
    markActive(true)
    warningRef.current = false
    setWarningOpen(false)
    setSecondsLeft(0)
  }, [markActive])

  return { warningOpen, secondsLeft, stay }
}
