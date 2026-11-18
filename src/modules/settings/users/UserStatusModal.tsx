import { useEffect, useState } from 'react'
import { AlertTriangle, Users } from 'lucide-react'
import type { SettingsUserRow } from '@/modules/settings/users/types'
import { useDeactivateUser, useReactivateUser } from '@/modules/settings/hooks/useSettingsUsers'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

interface Props {
  /** The user to deactivate or reactivate (decided by their current status); null closes. */
  user: SettingsUserRow | null
  onClose: () => void
}

/** Confirm deactivate / reactivate. Deactivating warns about open leads (they stay assigned). */
export function UserStatusModal({ user, onClose }: Props) {
  const deactivate = useDeactivateUser()
  const reactivate = useReactivateUser()
  const toast = useToast()
  /** Open-lead count the server reported (409) when it differs from what the list showed. */
  const [serverLeads, setServerLeads] = useState<number | null>(null)

  useEffect(() => {
    setServerLeads(null)
    deactivate.reset()
    reactivate.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!user) return null

  const deactivating = user.active
  const openLeads = serverLeads ?? user.openLeads
  const pending = deactivate.isPending || reactivate.isPending
  const error = deactivate.error ?? reactivate.error

  function confirm() {
    if (!user) return
    if (deactivating) {
      deactivate.mutate(
        { id: user.id, confirm: openLeads > 0 },
        {
          onSuccess: (res) => {
            if (res.status === 'confirm') {
              setServerLeads(res.openLeads)
              return
            }
            toast.success('User deactivated', `${user.name} can no longer sign in.`)
            onClose()
          },
        },
      )
    } else {
      reactivate.mutate(user.id, {
        onSuccess: () => {
          toast.success('User reactivated', `${user.name} can sign in again.`)
          onClose()
        },
      })
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={deactivating ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
      description={
        deactivating
          ? 'They won’t be able to sign in. Their records, history and audit trail are kept; users are never deleted.'
          : 'They can sign in again with their existing email, role and settings.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write variant={deactivating ? 'danger' : 'primary'} loading={pending} onClick={confirm}>
            {deactivating ? (openLeads > 0 ? 'Deactivate anyway' : 'Deactivate') : 'Reactivate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">
              {user.role} · {user.departmentName}
            </p>
          </div>
        </div>
        {deactivating && openLeads > 0 && (
          <div className="flex gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">
                {openLeads} open lead{openLeads === 1 ? '' : 's'}
              </span>{' '}
              stay assigned to {user.name.split(' ')[0]}. Reassign them from Leads so follow-ups aren’t missed.
            </p>
          </div>
        )}
        {deactivating && user.directReports > 0 && (
          <div className="flex gap-2.5 rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[0.8125rem] text-ink-2">
            <Users className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <p>
              {user.directReports} {user.directReports === 1 ? 'person reports' : 'people report'} to them. Give{' '}
              {user.directReports === 1 ? 'them' : 'each'} a new direct manager afterwards.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  )
}
