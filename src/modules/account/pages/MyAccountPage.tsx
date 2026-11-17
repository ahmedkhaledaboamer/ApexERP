import type { ReactNode } from 'react'
import { Building2, CalendarClock, Info, LogIn, Mail, Phone, ShieldCheck, Timer, UserRound } from 'lucide-react'
import { useAccountPolicy, useAccountQuery } from '@/modules/account/hooks/useAccount'
import { ChangePasswordCard } from '@/modules/account/components/ChangePasswordCard'
import { usePolicyQuery } from '@/modules/settings/hooks/useSecurity'
import { TwoFactorCard } from '@/modules/settings/security/TwoFactorCard'
import { SessionsCard } from '@/modules/settings/security/SessionsCard'
import { useCurrentUser } from '@/store/hooks'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/** Your own profile, password, two-factor, signed-in devices and the session rules that apply to you. */
export default function MyAccountPage() {
  const sessionUser = useCurrentUser()
  const account = useAccountQuery()
  const policyQuery = usePolicyQuery()
  const policy = useAccountPolicy()
  const user = account.data?.user ?? sessionUser

  if (!user) return null

  return (
    <>
      <PageHeader
        icon={<Avatar name={user.name} size="xl" />}
        title={user.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{user.title}</span>
            <span aria-hidden className="text-subtle">
              ·
            </span>
            <Badge tone="brand">{user.role}</Badge>
            {user.twoFactorEnabled && (
              <Badge tone="green" icon={<ShieldCheck />}>
                2FA on
              </Badge>
            )}
          </span>
        }
      />
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
          <aside className="space-y-5 lg:order-last">
            <Card>
              <CardHeader icon={<UserRound />} title="Profile" description="How you appear to colleagues across the app." />
              <CardBody className="pb-3">
                <PropertyList className="-mt-1">
                  <Property label="Email" icon={<Mail />}>
                    <span className="block truncate" title={user.email}>
                      {user.email}
                    </span>
                  </Property>
                  <Property label="Mobile" icon={<Phone />}>
                    <span className="num">{user.mobile || '—'}</span>
                  </Property>
                  <Property label="Department" icon={<Building2 />}>
                    <Loaded loading={account.isPending}>{account.data?.departmentName ?? '—'}</Loaded>
                  </Property>
                  <Property label="Manager" icon={<UserRound />}>
                    <Loaded loading={account.isPending}>
                      {account.data?.managerName ? (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Avatar name={account.data.managerName} size="xs" />
                          <span className="truncate">{account.data.managerName}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Loaded>
                  </Property>
                  <Property label="Last sign-in" icon={<LogIn />}>
                    <Loaded loading={account.isPending}>{fmtDate(account.data?.lastLoginAt, 'd MMM yyyy, HH:mm')}</Loaded>
                  </Property>
                  <Property label="Member since" icon={<CalendarClock />}>
                    {fmtDate(user.createdAt)}
                  </Property>
                </PropertyList>
                <p className="mt-2 flex items-start gap-2 rounded-lg bg-sunken/60 px-3 py-2 text-xs text-muted">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                  Ask a System Admin to change these details.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={<Timer />} title="Session timeout" description="Set for everyone by your System Admin." />
              <CardBody>
                {policyQuery.isPending ? (
                  <Skeleton className="h-12 w-full rounded-lg" />
                ) : (
                  <>
                    <p className="text-[0.8125rem] text-ink">
                      You’ll be signed out after{' '}
                      <span className="font-semibold">
                        {policy.sessionTimeoutMinutes} minute{policy.sessionTimeoutMinutes === 1 ? '' : 's'}
                      </span>{' '}
                      of inactivity.
                    </p>
                    <p className="mt-1.5 text-xs text-muted">
                      A warning appears a minute before, so you can stay signed in. Activity in any tab keeps you signed in.
                    </p>
                  </>
                )}
              </CardBody>
            </Card>
          </aside>

          <div className="min-w-0 space-y-5">
            <ChangePasswordCard minLength={policy.passwordMinLength} changedAt={account.data?.passwordChangedAt} />
            <TwoFactorCard requiredByPolicy={policyQuery.data?.requireTwoFactorForAdmins ?? false} />
            <SessionsCard />
          </div>
        </div>
      </PageBody>
    </>
  )
}

function Loaded({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="h-4 w-28" /> : <>{children}</>
}
