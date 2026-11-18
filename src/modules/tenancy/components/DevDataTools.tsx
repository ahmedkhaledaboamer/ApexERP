import { useEffect, useState, useSyncExternalStore } from 'react'
import { format } from 'date-fns'
import { RotateCcw } from 'lucide-react'
import { DEV_MOCK_PERSISTENCE } from '@/modules/tenancy/dev'
import { Button } from '@/shared/components/ui/Button'
import { MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { Modal } from '@/shared/components/ui/Modal'

/**
 * Dev tools for the mock DB persisted in IndexedDB (shared/mocks/persist/browser.ts): a status
 * line and "Reset demo data". Rendered only when DEV_MOCK_PERSISTENCE; the persistence module is
 * loaded with a dynamic import behind `import.meta.env.DEV`, so production builds never include it.
 */

type PersistModule = typeof import('@/shared/mocks/persist/browser')
type PersistStatus = ReturnType<PersistModule['getPersistStatus']>

const noop = () => () => {}
const none = () => null

function usePersistModule(): PersistModule | null {
  const [mod, setMod] = useState<PersistModule | null>(null)
  useEffect(() => {
    if (!(import.meta.env.DEV && DEV_MOCK_PERSISTENCE)) return
    let alive = true
    void import('@/shared/mocks/persist/browser').then((m) => {
      if (alive) setMod(m)
    })
    return () => {
      alive = false
    }
  }, [])
  return mod
}

function usePersistStatus(mod: PersistModule | null): PersistStatus | null {
  return useSyncExternalStore(mod?.subscribePersistStatus ?? noop, mod?.getPersistStatus ?? none)
}

function statusText(s: PersistStatus | null): string {
  if (!s) return 'Demo data saved in this browser'
  if (s.error) return `Demo data not saved: ${s.error}`
  if (s.lastSavedAt) return `Demo data saved in this browser · last saved ${format(s.lastSavedAt, 'HH:mm')}`
  return 'Demo data saved in this browser · no changes yet'
}

/** Menu section (inside the dev workspace switcher). `onReset` opens the confirm dialog. */
export function DevDataSection({ onReset }: { onReset: () => void }) {
  const status = usePersistStatus(usePersistModule())
  return (
    <>
      <MenuLabel>Dev tools</MenuLabel>
      <p className="px-2 pb-1 text-[0.6875rem] text-muted" aria-live="polite">
        {statusText(status)}
      </p>
      <MenuItem danger icon={<RotateCcw />} onSelect={onReset}>
        Reset demo data
      </MenuItem>
    </>
  )
}

export function ResetDemoDataModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = usePersistModule()
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      size="sm"
      title="Reset demo data?"
      description="Deletes the demo data saved in this browser and reloads the app. Both demo companies start again from their original seed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!mod}
            onClick={() => {
              setBusy(true)
              void mod?.resetDemoData()
            }}
          >
            Reset demo data
          </Button>
        </>
      }
    >
      <p className="text-[0.8125rem] text-muted">
        Everything you created or changed (leads, customers, tasks, settings, users, sign-ups) is lost. Other open tabs keep
        their old data until they reload.
      </p>
    </Modal>
  )
}
