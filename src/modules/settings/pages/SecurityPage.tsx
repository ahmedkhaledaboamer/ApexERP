import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { usePolicyQuery } from '@/modules/settings/hooks/useSecurity'
import { TwoFactorCard } from '@/modules/settings/security/TwoFactorCard'
import { SessionsCard } from '@/modules/settings/security/SessionsCard'
import { BackupsCard } from '@/modules/settings/security/BackupsCard'
import { PolicyCard } from '@/modules/settings/security/PolicyCard'

/**
 * Security: your own 2FA and sessions (anyone who can open Settings manages their own account),
 * plus company-wide backups and policy (System Admin edits; Management views).
 */
export default function SecurityPage() {
  const user = useCurrentUser()
  const canEdit = !!user && can(user.role, 'settings', 'edit')
  const policy = usePolicyQuery()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Security</h2>
        <p className="mt-0.5 text-[0.8125rem] text-muted">
          Two-factor sign-in, signed-in devices, backups and company rules. Every change here is recorded in the audit log.
        </p>
      </div>

      <section aria-labelledby="sec-account" className="space-y-3">
        <h3 id="sec-account" className="text-xs font-medium tracking-wide text-muted uppercase">
          Your account
        </h3>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <TwoFactorCard requiredByPolicy={policy.data?.requireTwoFactorForAdmins ?? false} />
          <SessionsCard />
        </div>
      </section>

      <section aria-labelledby="sec-company" className="space-y-3">
        <h3 id="sec-company" className="text-xs font-medium tracking-wide text-muted uppercase">
          Company
        </h3>
        <BackupsCard canEdit={canEdit} />
        <PolicyCard canEdit={canEdit} />
      </section>
    </div>
  )
}
