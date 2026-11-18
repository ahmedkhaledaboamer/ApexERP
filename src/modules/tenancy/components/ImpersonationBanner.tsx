import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Eye, LifeBuoy, PencilLine, Timer } from 'lucide-react'
import { enableImpersonationWriteMode, stopImpersonation } from '@/modules/tenancy/api'
import { useImpersonation, useTenant } from '@/modules/tenancy/hooks'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { useEntitlementsQuery } from '@/modules/billing/hooks'
import { countdownLabel, formatCountdown, msUntil } from '@/modules/platform/countdown'
import { IMPERSONATION_TOAST, onImpersonationEvent } from '@/shared/lib/impersonationEvents'
import { setWorkspace } from '@/shared/lib/tenantContext'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useCurrentUser } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

/** Where the console shows a company (kept as a literal so the company bundle doesn't import the console). */
const consoleCompanyPath = (companyId: string) => `/platform/companies/${encodeURIComponent(companyId)}`

/**
 * The server's clock may run ahead of the browser (dev billing simulator). expiresAt is in server
 * time, so the countdown uses the skew measured from the entitlements' serverNow. Null until known.
 */
function useServerSkew(): number | null {
  const q = useEntitlementsQuery()
  if (!q.data?.serverNow || !q.dataUpdatedAt) return null
  const server = Date.parse(q.data.serverNow)
  return Number.isFinite(server) ? server - q.dataUpdatedAt : null
}

type EndNotice = { title: string; body?: string }

/**
 * Persistent support-session banner (company app, while a platform operator impersonates a user):
 * who and on whose behalf, live mm:ss countdown, Read-only / Write mode, "Enable write mode" (second
 * confirmation) and "End session". At 0:00, or when the API says the session expired/ended, the
 * session ends here and the operator goes back to the company in the console with a notice.
 * Read-only / blocked API errors show one toast.
 */
export function ImpersonationBanner() {
  const imp = useImpersonation()
  const user = useCurrentUser()
  const tenant = useTenant()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const toast = useToast()
  const skew = useServerSkew()
  const [now, setNow] = useState(() => Date.now())
  const [confirmWrite, setConfirmWrite] = useState(false)
  const ending = useRef(false)
  const lastToast = useRef(0)
  const companyId = tenant?.id ?? null

  const active = !!imp
  useEffect(() => {
    ending.current = false
  }, [imp?.sessionId, imp?.startedAt])

  /** Back to the console; PlatformApp drops the company session there (outside the company routes). */
  const endLocally = useCallback(
    (notice: EndNotice) => {
      if (ending.current) return
      ending.current = true
      setWorkspace(null)
      navigate(companyId ? consoleCompanyPath(companyId) : '/platform/companies', { replace: true, state: { endSupportSession: true, notice } })
    },
    [navigate, companyId],
  )

  // API errors: read-only / blocked → toast; expired / ended → end here.
  useEffect(
    () =>
      onImpersonationEvent((e) => {
        if (!active) return
        if (e.kind === 'expired') endLocally({ title: 'Support session expired', body: 'The time limit was reached. You’re back in the console.' })
        else if (e.kind === 'ended') endLocally({ title: 'Support session ended', body: e.message })
        else {
          const t = Date.now()
          if (t - lastToast.current < 1500) return
          lastToast.current = t
          toast.info(IMPERSONATION_TOAST[e.kind].title, IMPERSONATION_TOAST[e.kind].body)
        }
      }),
    [active, endLocally, toast],
  )

  // Ticks once a second while a session is open.
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])

  const left = imp?.expiresAt ? msUntil(imp.expiresAt, now + (skew ?? 0)) : null
  useEffect(() => {
    // Only end on the clock once the server time is known (a skewed clock could end it early).
    if (left === 0 && skew !== null) endLocally({ title: 'Support session expired', body: 'The time limit was reached. You’re back in the console.' })
  }, [left, skew, endLocally])

  const stop = useMutation({
    mutationFn: stopImpersonation,
    // Even if the stop call fails, the support session ends on this device.
    onSettled: () => endLocally({ title: 'Support session ended', body: user ? `You’re no longer signed in as ${user.name}.` : undefined }),
  })

  const write = useMutation({
    mutationFn: enableImpersonationWriteMode,
    onSuccess: (session) => {
      // Same support session (same operator + start): not a transition, the cache stays.
      dispatch(signedIn(session))
      setConfirmWrite(false)
      toast.success('Write mode on', 'Every change is recorded with your name in the company’s audit log.')
    },
  })

  if (!imp || !user) return null
  const mode = imp.mode ?? 'read'
  const companyName = tenant?.branding.displayName ?? tenant?.name ?? 'this company'

  return (
    <div
      id="impersonation-banner"
      role="region"
      aria-label="Support session"
      data-mode={mode}
      data-session-id={imp.sessionId}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning-100 bg-warning-50 px-4 py-2 text-[0.8125rem] text-warning-700 sm:px-6 dark:border-warning-500/30 dark:bg-warning-500/15 dark:text-warning-500"
    >
      <LifeBuoy className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1" id="impersonation-banner-text">
        You are viewing as <span className="font-semibold">{user.name}</span> ({companyName}) on behalf of {PRODUCT_NAME} support
        <span className="text-warning-700/80 dark:text-warning-500/80"> · {imp.platformUserName}</span>
      </p>
      <span
        id="impersonation-mode"
        data-mode={mode}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold ring-1 ring-inset',
          mode === 'write' ? 'bg-danger-50 text-danger-700 ring-danger-100 dark:bg-danger-500/15 dark:text-danger-500 dark:ring-danger-500/30' : 'bg-surface text-ink-2 ring-line-strong',
        )}
      >
        {mode === 'write' ? <PencilLine className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
        {mode === 'write' ? 'Write mode' : 'Read-only'}
      </span>
      {left !== null && (
        <span
          id="impersonation-countdown"
          role="timer"
          aria-label={countdownLabel(left)}
          data-ms-left={left}
          className="num inline-flex items-center gap-1 font-semibold tabular-nums"
        >
          <Timer className="size-3.5" aria-hidden />
          {formatCountdown(left)}
        </span>
      )}
      {mode === 'read' && (
        <Button id="impersonation-write-mode" size="sm" variant="secondary" onClick={() => setConfirmWrite(true)}>
          Enable write mode
        </Button>
      )}
      <Button id="impersonation-end" size="sm" variant="secondary" loading={stop.isPending} onClick={() => stop.mutate()}>
        End session
      </Button>

      <Modal
        open={confirmWrite}
        onClose={() => {
          write.reset()
          setConfirmWrite(false)
        }}
        size="sm"
        title="Enable write mode?"
        description={`You’ll be able to change ${companyName}’s data as ${user.name}. Every change is recorded with your name and shown to the company admin.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmWrite(false)}>
              Stay read-only
            </Button>
            <Button id="impersonation-write-confirm" variant="danger" loading={write.isPending} onClick={() => write.mutate()}>
              Enable write mode
            </Button>
          </>
        }
      >
        <div id="impersonation-write-dialog" className="space-y-2 text-[0.8125rem] text-ink-2">
          <p>Passwords, two-factor, billing and full data export stay blocked.</p>
          {imp.reason && (
            <p className="text-xs text-muted">
              Reason given: <span className="text-ink-2">{imp.reason}</span>
            </p>
          )}
          {write.isError && (
            <p role="alert" className="text-danger-700 dark:text-danger-500">
              {write.error.message}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
