import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Eye, Timer } from 'lucide-react'
import type { PlatformCompanyUser } from '@/modules/platform/types'
import { startImpersonation } from '@/modules/platform/api'
import { usePlatform, usePlatformSettings } from '@/modules/platform/hooks'
import { MIN_IMPERSONATION_REASON } from '@/modules/platform/format'
import { ConfirmReasonDialog } from '@/modules/platform/components/ConfirmReasonDialog'
import { PATHS } from '@/app/paths'
import { setWorkspace } from '@/shared/lib/tenantContext'
import { useAppDispatch } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'

/**
 * Start a support session as one company user: a REQUIRED reason (≥ 10 characters, shown to the
 * company admin), read-only by default, time-limited. The answer is a company Session; signing in
 * with it is an impersonation-start transition (query cache + stored user data wiped), and the
 * platform session stays in state.tenant.platform for the way back.
 */
export function ImpersonateDialog({
  user,
  companyName,
  onClose,
}: {
  user: PlatformCompanyUser | null
  companyName: string
  onClose: () => void
}) {
  const { token } = usePlatform()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const settings = usePlatformSettings(!!user)
  const minutes = settings.data?.impersonationMinutes ?? null

  const start = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) => startImpersonation(token, userId, reason),
    onSuccess: (session) => {
      setWorkspace(session.tenant.subdomain)
      dispatch(signedIn(session))
      navigate(PATHS.dashboard, { replace: true })
    },
  })

  return (
    <ConfirmReasonDialog
      id="impersonation-dialog"
      open={!!user}
      onClose={() => {
        start.reset()
        onClose()
      }}
      title={user ? `View as ${user.name}` : 'Support session'}
      description={`Open ${companyName} as this user to help with a support request.`}
      confirmLabel="Start support session"
      minReason={MIN_IMPERSONATION_REASON}
      reasonHint={`Required, at least ${MIN_IMPERSONATION_REASON} characters. The company admin sees it in their audit log.`}
      pending={start.isPending}
      error={start.isError ? start.error.message : null}
      onConfirm={(reason) => user && start.mutate({ userId: user.id, reason })}
    >
      <ul className="space-y-2 rounded-lg border border-line bg-canvas p-3 text-[0.8125rem] text-ink-2" id="impersonation-terms">
        <li className="flex gap-2">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="font-medium text-ink">Read-only by default.</span> You can switch to write mode inside the session after a second
            confirmation. Passwords, two-factor, billing and full data export stay blocked.
          </span>
        </li>
        <li className="flex gap-2">
          <Timer className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span id="impersonation-duration" data-minutes={minutes ?? undefined}>
            <span className="font-medium text-ink">Time-limited.</span>{' '}
            {minutes ? `The session ends automatically after ${minutes} minutes.` : 'The session ends automatically after a set time.'} Everything you do
            is recorded with your name.
          </span>
        </li>
        {user && (
          <li className="text-xs text-muted">
            Signing in as <span className="font-medium text-ink-2">{user.name}</span> · {user.role} · {user.email}
          </li>
        )}
      </ul>
    </ConfirmReasonDialog>
  )
}
