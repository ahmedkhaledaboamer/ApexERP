import { useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Laptop, LogOut, MapPin, Monitor, MonitorSmartphone, Smartphone } from 'lucide-react'
import type { SecuritySession } from '@/modules/settings/security/types'
import { useRevokeOtherSessions, useRevokeSession, useSessionsQuery } from '@/modules/settings/hooks/useSecurity'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

type Confirm = { kind: 'one'; session: SecuritySession } | { kind: 'others'; count: number } | null

function DeviceIcon({ device }: { device: string }) {
  const d = device.toLowerCase()
  const Icon = /iphone|android|pixel|galaxy/.test(d) ? Smartphone : /mac|laptop/.test(d) ? Laptop : Monitor
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken/60 text-muted">
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

/** Devices signed in to your account; any of them (except this one) can be signed out. */
export function SessionsCard() {
  const query = useSessionsQuery()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const toast = useToast()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const others = (query.data ?? []).filter((s) => !s.current).length

  function run() {
    if (!confirm) return
    if (confirm.kind === 'one') {
      revoke.mutate(confirm.session.id, {
        onSuccess: () => {
          toast.success('Session signed out', `${confirm.session.device} · ${confirm.session.browser}`)
          setConfirm(null)
        },
        onError: (e) => toast.error('Couldn’t sign out that session', e.message),
      })
    } else {
      revokeOthers.mutate(undefined, {
        onSuccess: (r) => {
          toast.success(`Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`)
          setConfirm(null)
        },
        onError: (e) => toast.error('Couldn’t sign out other sessions', e.message),
      })
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Active sessions"
        description="Browsers and devices signed in to your account."
        action={
          others > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'others', count: others })}>
              <LogOut />
              Sign out others
            </Button>
          )
        }
      />
      <CardBody className="px-0 pb-1">
        {query.isPending ? (
          <div className="space-y-3 px-5 pb-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState title="No active sessions" body="Sign in from a device and it shows up here." />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {query.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:flex-nowrap">
                <DeviceIcon device={s.device} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-ink">
                    {s.device} · {s.browser}
                    {s.current && (
                      <Badge tone="green" variant="dot">
                        This device
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden />
                      {s.location}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="num">{s.ip}</span>
                    <span aria-hidden>·</span>
                    <span title={fmtDate(s.lastActiveAt, 'd MMM yyyy, HH:mm')}>
                      {s.current ? 'Active now' : `Active ${formatDistanceToNowStrict(new Date(s.lastActiveAt), { addSuffix: true })}`}
                    </span>
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setConfirm({ kind: 'one', session: s })}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm?.kind === 'others' ? 'Sign out all other sessions?' : 'Sign out this session?'}
        description={
          confirm?.kind === 'others'
            ? `${confirm.count} other device${confirm.count === 1 ? '' : 's'} will need to sign in again. You stay signed in here.`
            : confirm?.kind === 'one'
              ? `${confirm.session.device} · ${confirm.session.browser} in ${confirm.session.location} will need to sign in again.`
              : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={revoke.isPending || revokeOthers.isPending} onClick={run}>
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">This is recorded in the audit log.</p>
      </Modal>
    </Card>
  )
}
