import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, LogOut } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { useAccountPolicy } from '@/modules/account/hooks/useAccount'
import { clearStoredActivity, useIdleTimeout } from '@/modules/account/hooks/useIdleTimeout'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedOut } from '@/store/authSlice'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'

const WARNING_SECONDS = 60

/** Router state the login page reads to explain why the user is there. */
export interface IdleSignOutState {
  from?: string
  idleMinutes: number
}

/** Short, non-reversible id for the current sign-in (the token itself stays out of the activity key). */
function sessionId(token: string | undefined): string {
  if (!token) return ''
  let h = 2166136261
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619) >>> 0
  return h.toString(36)
}

function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Enforces the security policy's idle timeout: a warning with a live countdown a minute before,
 * then sign-out. Mounted once in the app shell.
 */
export function SessionTimeout() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const token = useAppSelector((s) => s.auth.session?.token)
  const sid = useMemo(() => sessionId(token), [token])
  const { sessionTimeoutMinutes: minutes, settled } = useAccountPolicy()

  const signOut = useCallback(
    (idle: boolean) => {
      clearStoredActivity()
      queryClient.clear()
      dispatch(signedOut())
      const state: IdleSignOutState | undefined = idle
        ? { from: location.pathname + location.search, idleMinutes: minutes }
        : undefined
      navigate(PATHS.login, { replace: true, state })
    },
    [dispatch, navigate, queryClient, location.pathname, location.search, minutes],
  )

  const onTimeout = useCallback(() => signOut(true), [signOut])

  const { warningOpen, secondsLeft, stay } = useIdleTimeout({
    sid,
    timeoutMs: minutes * 60_000,
    warningMs: WARNING_SECONDS * 1000,
    enforce: settled && !!sid,
    onTimeout,
  })

  const progress = Math.min(1, Math.max(0, secondsLeft / WARNING_SECONDS))

  return (
    <Modal
      open={warningOpen}
      onClose={stay}
      size="sm"
      title="Are you still there?"
      description={`For your security, you’ll be signed out after ${minutes} minutes of inactivity.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => signOut(false)}>
            <LogOut />
            Sign out now
          </Button>
          <Button onClick={stay}>Stay signed in</Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-warning-100 bg-warning-50 text-warning-600 dark:border-warning-500/20 dark:bg-warning-500/10">
          <Clock className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] text-muted">Signing you out in</p>
          <p role="timer" aria-live="off" className="num text-2xl font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {clock(secondsLeft)}
          </p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div
          className="h-full rounded-full bg-warning-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {secondsLeft === 30 || secondsLeft === 10 ? `${secondsLeft} seconds left before you are signed out.` : ''}
      </p>
      <p className="mt-3 text-xs text-muted">Unsaved changes on this page may be lost if you’re signed out.</p>
    </Modal>
  )
}
