import { lazy, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { can } from '@/shared/lib/permissions'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { quickAddLeadSet } from '@/store/uiSlice'
import { PATHS } from '@/app/paths'
import { LeadQuickAdd } from '@/modules/leads/components/LeadQuickAdd'
import { Toaster } from '@/shared/components/ui/Toast'
import { SessionTimeout } from '@/modules/account/components/SessionTimeout'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { CommandPalette } from './CommandPalette'
import { WonDialogHost } from '@/modules/won/components/WonDialog'
import { TaskDrawerHost } from '@/modules/tasks/components/TaskDrawerHost'
import { ImpersonationBanner } from '@/modules/tenancy/components/ImpersonationBanner'
import { AnnouncementBanner } from '@/modules/tenancy/components/AnnouncementBanner'
import { BillingSync } from '@/modules/billing/components/BillingSync'
import { BillingBanner } from '@/modules/billing/components/BillingBanner'
import { UpgradePromptHost } from '@/modules/billing/components/UpgradePromptHost'
import { useEntitlements } from '@/modules/billing/hooks'
import { useReadOnly } from '@/shared/lib/readOnly'
import CancelledPage from '@/modules/billing/pages/CancelledPage'

/**
 * Dev-only billing simulator (simulated clock, status, usage). `import.meta.env.DEV` is statically
 * false in a production build, so this branch and its dynamic import are dropped from the bundle.
 */
const BillingSimulator =
  import.meta.env.DEV && import.meta.env.VITE_API_MOCK !== 'false' && import.meta.env.MODE !== 'test'
    ? lazy(() => import('@/modules/billing/dev/BillingSimulator'))
    : null

/** Sidebar, header, the routed page on the canvas, plus global overlays. */
export function AppLayout() {
  const dispatch = useAppDispatch()
  const user = useCurrentUser()
  const quickAddOpen = useAppSelector((s) => s.ui.quickAddLeadOpen)
  const readOnly = useReadOnly()
  const { status } = useEntitlements()
  const { pathname } = useLocation()
  // Sales is in every plan; the role decides. No quick add while the workspace is read-only.
  const canCreateLead = !!user && can(user.role, 'sales', 'create') && !readOnly
  // Cancelled: every page becomes "Export your data" (the account page stays reachable).
  const cancelled = status === 'cancelled' && pathname !== PATHS.account

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ImpersonationBanner />
        <Header />
        <BillingBanner />
        <AnnouncementBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{cancelled ? <CancelledPage /> : <Outlet />}</main>
      </div>
      <CommandPalette />
      <Toaster />
      <SessionTimeout />
      <WonDialogHost />
      <TaskDrawerHost />
      <BillingSync />
      <UpgradePromptHost />
      {canCreateLead && <LeadQuickAdd open={quickAddOpen} onClose={() => dispatch(quickAddLeadSet(false))} />}
      {BillingSimulator && (
        <Suspense fallback={null}>
          <BillingSimulator />
        </Suspense>
      )}
    </div>
  )
}
