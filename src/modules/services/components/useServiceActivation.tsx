import { useState } from 'react'
import { Info } from 'lucide-react'
import type { ServiceRow } from '@/modules/services/types'
import { useSetServiceActive } from '@/modules/services/hooks/useServices'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * Activate / deactivate a service. Reactivating is immediate; deactivating asks first and shows
 * where the service is used. Render `modal` once in the page.
 */
export function useServiceActivation() {
  const mutation = useSetServiceActive()
  const toast = useToast()
  const [confirming, setConfirming] = useState<ServiceRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  function run(s: ServiceRow, active: boolean) {
    setPendingId(s.id)
    mutation.mutate(
      { id: s.id, active },
      {
        onSuccess: () => {
          toast.success(active ? 'Service reactivated' : 'Service deactivated', s.name)
          setConfirming(null)
        },
        onError: (e) => toast.error(active ? 'Couldn’t reactivate the service' : 'Couldn’t deactivate the service', e.message),
        onSettled: () => setPendingId(null),
      },
    )
  }

  function setActive(s: ServiceRow, active: boolean) {
    if (active) run(s, true)
    else setConfirming(s)
  }

  const s = confirming
  const uses = s
    ? [
        [s.usage.leadsRecommending + s.usage.leadsInterested, 'lead mention', 'lead mentions'],
        [s.usage.quotations, 'quotation', 'quotations'],
        [s.usage.customers, 'customer', 'customers'],
        [s.packageCount, 'package', 'packages'],
      ].filter(([n]) => (n as number) > 0) as [number, string, string][]
    : []

  const modal = (
    <Modal
      open={!!s}
      onClose={() => setConfirming(null)}
      size="sm"
      title={s ? `Deactivate “${s.name}”?` : 'Deactivate service?'}
      description="It disappears from pickers for new leads, quotations and packages. You can reactivate it any time."
      footer={
        <>
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            Keep active
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => s && run(s, false)}>
            Deactivate
          </Button>
        </>
      }
    >
      {s && (
        <div className="space-y-3 text-[0.8125rem]">
          {uses.length > 0 ? (
            <>
              <p className="text-ink-2">It’s currently used in:</p>
              <ul className="grid grid-cols-2 gap-2">
                {uses.map(([n, one, many]) => (
                  <li key={one} className="rounded-lg border border-line bg-sunken/60 px-3 py-2">
                    <span className="num block text-base font-semibold text-ink">{n}</span>
                    <span className="text-muted">{n === 1 ? one : many}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-ink-2">It isn’t used on any lead, quotation, customer or package yet.</p>
          )}
          <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-info-700 dark:bg-info-500/10 dark:text-info-500">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Old quotations keep their data. Services are never deleted.
          </p>
        </div>
      )}
    </Modal>
  )

  return { setActive, pendingId, modal }
}
