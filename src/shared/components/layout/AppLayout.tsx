import { Outlet } from 'react-router-dom'
import { can } from '@/shared/lib/permissions'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { quickAddLeadSet } from '@/store/uiSlice'
import { LeadQuickAdd } from '@/modules/leads/components/LeadQuickAdd'
import { Toaster } from '@/shared/components/ui/Toast'
import { SessionTimeout } from '@/modules/account/components/SessionTimeout'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { CommandPalette } from './CommandPalette'

/** Sidebar, header, the routed page on the canvas, plus global overlays. */
export function AppLayout() {
  const dispatch = useAppDispatch()
  const user = useCurrentUser()
  const quickAddOpen = useAppSelector((s) => s.ui.quickAddLeadOpen)
  const canCreateLead = !!user && can(user.role, 'sales', 'create')

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
      <SessionTimeout />
      {canCreateLead && <LeadQuickAdd open={quickAddOpen} onClose={() => dispatch(quickAddLeadSet(false))} />}
    </div>
  )
}
