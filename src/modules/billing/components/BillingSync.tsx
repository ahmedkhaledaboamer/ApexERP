import { useEffect } from 'react'
import { useEntitlementsQuery } from '@/modules/billing/hooks'
import { READ_ONLY_HINT, SUPPORT_READ_ONLY_HINT, setWorkspaceReadOnly } from '@/shared/lib/readOnly'
import { useImpersonation } from '@/modules/tenancy/hooks'
import { useAppDispatch } from '@/store/hooks'
import { tenantStatusChanged } from '@/store/tenantSlice'

/**
 * Mounted once in the app shell: polls the entitlements (every 60 s and on focus), publishes the
 * read-only flag to every write button, and switches to the "workspace deleted" screen.
 */
export function BillingSync() {
  const dispatch = useAppDispatch()
  const { data } = useEntitlementsQuery({ poll: true })
  const billingReadOnly = data?.readOnly ?? false
  // A support session is read-only until the operator confirms write mode (the API enforces it too).
  const supportReadOnly = useImpersonation()?.mode === 'read'
  const readOnly = billingReadOnly || supportReadOnly
  const hint = billingReadOnly ? READ_ONLY_HINT : SUPPORT_READ_ONLY_HINT
  const deleted = data?.status === 'deleted'

  useEffect(() => setWorkspaceReadOnly(readOnly, hint), [readOnly, hint])
  // Signed out / left the shell: nothing is read-only until the next company's entitlements load.
  useEffect(() => () => setWorkspaceReadOnly(false), [])
  useEffect(() => {
    if (deleted) dispatch(tenantStatusChanged({ status: 'deleted' }))
  }, [deleted, dispatch])

  return null
}
