import { type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ModuleKey } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import { useAppSelector, useCurrentUser } from '@/store/hooks'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { ComingSoonPage } from '@/shared/components/layout/ComingSoonPage'
import { PATHS } from '@/app/paths'

import LoginPage from '@/modules/auth/pages/LoginPage'
import DashboardPage from '@/modules/dashboard/pages/DashboardPage'
import LeadsListPage from '@/modules/leads/pages/LeadsListPage'
import LeadsPipelinePage from '@/modules/leads/pages/LeadsPipelinePage'
import LeadDetailPage from '@/modules/leads/pages/LeadDetailPage'
import LeadFormPage from '@/modules/leads/pages/LeadFormPage'
import LeadImportPage from '@/modules/leads/import/LeadImportPage'
import FollowUpsPage from '@/modules/leads/followups/FollowUpsPage'
import SalesTargetsPage from '@/modules/targets/pages/SalesTargetsPage'
import CustomersPage from '@/modules/crm/pages/CustomersPage'
import CustomerProfilePage from '@/modules/crm/pages/CustomerProfilePage'
import ContactsPage from '@/modules/crm/pages/ContactsPage'
import ContractsPage from '@/modules/crm/pages/ContractsPage'
import QuotationsPage from '@/modules/quotations/pages/QuotationsPage'
import QuotationEditorPage from '@/modules/quotations/pages/QuotationEditorPage'
import SalesReportsPage from '@/modules/reports/pages/SalesReportsPage'
import MyAccountPage from '@/modules/account/pages/MyAccountPage'
import DepartmentsPage from '@/modules/departments/pages/DepartmentsPage'
import OrgChartPage from '@/modules/departments/pages/OrgChartPage'
import DepartmentDetailPage from '@/modules/departments/pages/DepartmentDetailPage'
import ServiceCatalogPage from '@/modules/services/pages/ServiceCatalogPage'
import ServiceDetailPage from '@/modules/services/pages/ServiceDetailPage'
import PackagesPage from '@/modules/services/pages/PackagesPage'
import ProjectTemplatesPage from '@/modules/services/pages/ProjectTemplatesPage'
import { SETTINGS_PATHS, SettingsLayout } from '@/modules/settings/components/SettingsLayout'
import UsersPage from '@/modules/settings/pages/UsersPage'
import ListsPage from '@/modules/settings/pages/ListsPage'
import TemplatesPage from '@/modules/settings/pages/TemplatesPage'
import TargetsSettingsPage from '@/modules/settings/pages/TargetsSettingsPage'
import AutomationPage from '@/modules/settings/pages/AutomationPage'
import SecurityPage from '@/modules/settings/pages/SecurityPage'
import AuditLogPage from '@/modules/settings/pages/AuditLogPage'

/** Every module's routes, behind the session guard and (per route) a permission guard. */
export function AppRouter() {
  const sales = (page: ReactNode) => <RequirePermission module="sales">{page}</RequirePermission>
  const servicesGuard = (page: ReactNode) => <RequirePermission module="services">{page}</RequirePermission>
  const deptGuard = (page: ReactNode) => <RequirePermission module="departments">{page}</RequirePermission>
  return (
    <Routes>
      <Route path={PATHS.index} element={<IndexRedirect />} />
      <Route path={PATHS.login} element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path={PATHS.dashboard} element={<DashboardPage />} />
        <Route path={PATHS.followUps} element={sales(<FollowUpsPage />)} />
        <Route path={PATHS.account} element={<MyAccountPage />} />

        <Route path={PATHS.leads} element={sales(<LeadsListPage />)} />
        <Route path={PATHS.leadNew} element={sales(<LeadFormPage />)} />
        <Route path={PATHS.leadImport} element={sales(<LeadImportPage />)} />
        <Route path={PATHS.pipeline} element={sales(<LeadsPipelinePage />)} />
        <Route path={PATHS.leadDetail} element={sales(<LeadDetailPage />)} />
        <Route path={PATHS.leadEdit} element={sales(<LeadFormPage />)} />

        <Route path={PATHS.customers} element={sales(<CustomersPage />)} />
        <Route path={PATHS.customerDetail} element={sales(<CustomerProfilePage />)} />
        <Route path={PATHS.contacts} element={sales(<ContactsPage />)} />
        <Route path={PATHS.contracts} element={sales(<ContractsPage />)} />

        <Route path={PATHS.quotations} element={sales(<QuotationsPage />)} />
        <Route path={PATHS.quotationNew} element={sales(<QuotationEditorPage />)} />
        <Route path={PATHS.quotationDetail} element={sales(<QuotationEditorPage />)} />

        <Route path={PATHS.salesTargets} element={sales(<SalesTargetsPage />)} />
        <Route
          path={PATHS.salesReports}
          element={
            <RequirePermission module="reports">
              <SalesReportsPage />
            </RequirePermission>
          }
        />

        <Route
          path={SETTINGS_PATHS.root}
          element={
            <RequirePermission module="settings">
              <SettingsLayout />
            </RequirePermission>
          }
        >
          <Route index element={<Navigate to={SETTINGS_PATHS.users} replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="lists" element={<ListsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="targets" element={<TargetsSettingsPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
        </Route>

        <Route path={PATHS.services} element={servicesGuard(<ServiceCatalogPage />)} />
        <Route path={PATHS.servicePackages} element={servicesGuard(<PackagesPage />)} />
        <Route path={PATHS.serviceTemplates} element={servicesGuard(<ProjectTemplatesPage />)} />
        <Route path={PATHS.serviceDetail} element={servicesGuard(<ServiceDetailPage />)} />

        <Route path={PATHS.departments} element={deptGuard(<DepartmentsPage />)} />
        <Route path={PATHS.orgChart} element={deptGuard(<OrgChartPage />)} />
        <Route path={PATHS.departmentDetail} element={deptGuard(<DepartmentDetailPage />)} />

        {/* Spec screens not built yet: a placeholder that explains what's coming. */}
        <Route path="*" element={<ComingSoonPage />} />
      </Route>
    </Routes>
  )
}

/** `/`: send signed-in users to the dashboard and everyone else to sign in. */
export function IndexRedirect() {
  const signedIn = useAppSelector((s) => s.auth.session !== null)
  return <Navigate to={signedIn ? PATHS.dashboard : PATHS.login} replace />
}

/** Guards the app shell: no session, no access — back to /login, remembering where you were. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const signedIn = useAppSelector((s) => s.auth.session !== null)
  const location = useLocation()
  if (!signedIn) {
    return <Navigate to={PATHS.login} replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}

/** Route-level permission guard: roles without view access to the module go to the dashboard. */
export function RequirePermission({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const user = useCurrentUser()
  if (!user || !can(user.role, module, 'view')) return <Navigate to={PATHS.dashboard} replace />
  return <>{children}</>
}
