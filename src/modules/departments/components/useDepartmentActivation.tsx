import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { FolderTree, Info, Users } from 'lucide-react'
import { departmentPath } from '@/app/paths'
import type { DepartmentRow } from '@/modules/departments/types'
import { useSetDepartmentActive } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { apiStatus, plural } from '@/modules/departments/components/DepartmentBits'
import { MoveMembersDialog } from '@/modules/departments/components/MoveMembersDialog'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

export type ActivationTarget = Pick<DepartmentRow, 'id' | 'name' | 'headId' | 'active' | 'memberCount' | 'childCount'>

/**
 * Deactivate / reactivate a department. Departments are never deleted; members and active
 * sub-departments must leave first, so a blocked deactivation (client check or the server's 409)
 * explains why and opens "Move members" with everyone ticked. Render `modal` once. Full scope.
 */
export function useDepartmentActivation() {
  const mutation = useSetDepartmentActive()
  const usersQuery = useUsersQuery()
  const toast = useToast()
  const [confirming, setConfirming] = useState<ActivationTarget | null>(null)
  const [blocked, setBlocked] = useState<{ dept: ActivationTarget; message?: string } | null>(null)
  const [moving, setMoving] = useState<{ dept: ActivationTarget; ids: string[] } | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  function run(d: ActivationTarget, active: boolean) {
    setPendingId(d.id)
    mutation.mutate(
      { id: d.id, active },
      {
        onSuccess: () => {
          toast.success(active ? 'Department reactivated' : 'Department deactivated', d.name)
          setConfirming(null)
        },
        onError: (e) => {
          setConfirming(null)
          if (!active && apiStatus(e) === 409) setBlocked({ dept: d, message: e.message })
          else toast.error(active ? 'Couldn’t reactivate the department' : 'Couldn’t deactivate the department', e.message)
        },
        onSettled: () => setPendingId(null),
      },
    )
  }

  function setActive(d: ActivationTarget, active: boolean) {
    if (active) run(d, true)
    else if (d.memberCount > 0 || d.childCount > 0) setBlocked({ dept: d })
    else setConfirming(d)
  }

  function openMove(d: ActivationTarget) {
    const ids = (usersQuery.data ?? []).filter((u) => u.departmentId === d.id && u.active !== false).map((u) => u.id)
    setBlocked(null)
    setMoving({ dept: d, ids })
  }

  const b = blocked?.dept
  const c = confirming

  const modal = (
    <>
      {createPortal(
        <Modal
          open={!!c}
          onClose={() => setConfirming(null)}
          size="sm"
          title={c ? `Deactivate “${c.name}”?` : 'Deactivate department?'}
          description="It disappears from pickers and the org chart. History and audit entries are kept, and you can reactivate it any time."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Keep active
              </Button>
              <Button write variant="danger" loading={mutation.isPending} onClick={() => c && run(c, false)}>
                Deactivate
              </Button>
            </>
          }
        >
          <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-[0.8125rem] text-info-700 dark:bg-info-500/10 dark:text-info-500">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Departments are never deleted. Its head is cleared when it’s deactivated.
          </p>
        </Modal>,
        document.body,
      )}
      {createPortal(
        <Modal
          open={!!b}
          onClose={() => setBlocked(null)}
          size="sm"
          title={b ? `Move people out of “${b.name}” first` : 'Move people out first'}
          description={blocked?.message ?? 'A department can only be deactivated once it has no members and no active sub-departments.'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBlocked(null)}>
                Close
              </Button>
              {b && (b.memberCount > 0 || b.childCount === 0) && (
                <Button write onClick={() => openMove(b)}>
                  <Users />
                  Move members…
                </Button>
              )}
            </>
          }
        >
          {b && (
            <ul className="space-y-2 text-[0.8125rem]">
              {b.memberCount > 0 && (
                <li className="flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2">
                  <Users className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span>
                    <span className="font-medium text-ink">{plural(b.memberCount, 'member')}</span>
                    <span className="block text-muted">Move them to another department. Everyone is ticked when the dialog opens.</span>
                  </span>
                </li>
              )}
              {b.childCount > 0 && (
                <li className="flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2">
                  <FolderTree className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span>
                    <span className="font-medium text-ink">{plural(b.childCount, 'active sub-department')}</span>
                    <span className="block text-muted">
                      Give each one a new parent (Edit on the sub-department) or deactivate it first.{' '}
                      <Link to={`${departmentPath(b.id)}?tab=subs`} className="font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => setBlocked(null)}>
                        See sub-departments
                      </Link>
                    </span>
                  </span>
                </li>
              )}
            </ul>
          )}
        </Modal>,
        document.body,
      )}
      {moving && (
        <MoveMembersDialog
          open
          onClose={() => setMoving(null)}
          from={moving.dept}
          preselectedIds={moving.ids}
          intro={
            <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-[0.8125rem] text-info-700 dark:bg-info-500/10 dark:text-info-500">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Move everyone out, then {moving.dept.name} can be deactivated.
            </p>
          }
          onMoved={(n) => {
            const d = moving.dept
            const left = d.memberCount - n
            if (left <= 0 && d.childCount === 0) setConfirming({ ...d, headId: null, memberCount: 0 })
          }}
        />
      )}
    </>
  )

  return { setActive, pendingId, modal }
}
