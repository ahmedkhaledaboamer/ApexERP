import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ModuleKey } from '@/shared/types'
import { useAppSelector } from '@/store/hooks'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { ComingSoonPage } from '@/shared/components/layout/ComingSoonPage'
import { navMatch } from '@/shared/components/layout/navigation'
import { PATHS } from '@/app/paths'
import { ModuleNotIncluded } from '@/modules/tenancy/components/ModuleNotIncluded'
import { itemPlanModule, routeDecision } from '@/modules/billing/gating'
import { useGateContext } from '@/modules/billing/hooks'
import { GateSkeleton } from '@/modules/billing/components/ModuleGate'

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
import MyTasksPage from '@/modules/tasks/pages/MyTasksPage'
import TaskBoardPage from '@/modules/tasks/pages/TaskBoardPage'
import TaskListPage from '@/modules/tasks/pages/TaskListPage'
import TaskCalendarPage from '@/modules/tasks/pages/TaskCalendarPage'
import ProjectsPage from '@/modules/tasks/pages/ProjectsPage'
import ProjectDetailPage from '@/modules/tasks/pages/ProjectDetailPage'
import DepartmentsPage from '@/modules/departments/pages/DepartmentsPage'
import OrgChartPage from '@/modules/departments/pages/OrgChartPage'
import DepartmentDetailPage from '@/modules/departments/pages/DepartmentDetailPage'
import ServiceCatalogPage from '@/modules/services/pages/ServiceCatalogPage'
import ServiceDetailPage from '@/modules/services/pages/ServiceDetailPage'
import PackagesPage from '@/modules/services/pages/PackagesPage'
import ProjectTemplatesPage from '@/modules/services/pages/ProjectTemplatesPage'
import { SETTINGS_PATHS, SettingsLayout } from '@/modules/settings/components/SettingsLayout'
import UsersPage from '@/modules/settings/pages/UsersPage'
import CompanyProfilePage from '@/modules/settings/pages/CompanyProfilePage'
import BrandingPage from '@/modules/settings/pages/BrandingPage'
import SignupPage from '@/modules/auth/pages/SignupPage'
import WorkspaceLoginPage from '@/modules/auth/pages/WorkspaceLoginPage'
import LegalPage from '@/modules/signup/pages/LegalPage'
import BillingPage from '@/modules/settings/pages/BillingPage'
import ListsPage from '@/modules/settings/pages/ListsPage'
import TemplatesPage from '@/modules/settings/pages/TemplatesPage'
import TargetsSettingsPage from '@/modules/settings/pages/TargetsSettingsPage'
import AutomationPage from '@/modules/settings/pages/AutomationPage'
import SecurityPage from '@/modules/settings/pages/SecurityPage'
import AuditLogPage from '@/modules/settings/pages/AuditLogPage'

/** Super-Admin Console: its own chunk (and its own layout), never part of the company bundle. */
const PlatformApp = lazy(() => import('@/modules/platform/PlatformApp'))

/** Every module's routes, behind the session guard and (per route) a permission guard. */
export function AppRouter() {
  const sales = (page: ReactNode) => <RequirePermission module="sales">{page}</RequirePermission>
  const servicesGuard = (page: ReactNode) => <RequirePermission module="services">{page}</RequirePermission>
  const deptGuard = (page: ReactNode) => <RequirePermission module="departments">{page}</RequirePermission>
  const tasksGuard = (page: ReactNode) => <RequirePermission module="tasks">{page}</RequirePermission>
  return (
    <Routes>
      <Route path={PATHS.index} element={<IndexRedirect />} />
      <Route path={PATHS.login} element={<LoginPage />} />
      <Route path={PATHS.signup} element={<SignupPage />} />
      <Route path={PATHS.workspaceLogin} element={<WorkspaceLoginPage />} />
      <Route path={PATHS.workspaceLoginAlt} element={<WorkspaceLoginPage />} />
      <Route path={PATHS.legalTerms} element={<LegalPage kind="terms" />} />
      <Route path={PATHS.legalPrivacy} element={<LegalPage kind="privacy" />} />
      {/* Platform console (/platform/*): no workspace, no tenant session, no AppLayout; lazy-loaded. */}
      <Route
        path={`${PATHS.platform}/*`}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading console…</div>}>
            <PlatformApp />
          </Suspense>
        }
      />
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
          <Route path="company-profile" element={<CompanyProfilePage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="lists" element={<ListsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="targets" element={<TargetsSettingsPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>

        <Route path={PATHS.services} element={servicesGuard(<ServiceCatalogPage />)} />
        <Route path={PATHS.servicePackages} element={servicesGuard(<PackagesPage />)} />
        <Route path={PATHS.serviceTemplates} element={servicesGuard(<ProjectTemplatesPage />)} />
        <Route path={PATHS.serviceDetail} element={servicesGuard(<ServiceDetailPage />)} />

        <Route path={PATHS.myTasks} element={tasksGuard(<MyTasksPage />)} />
        <Route path={PATHS.taskBoard} element={tasksGuard(<TaskBoardPage />)} />
        <Route path={PATHS.taskList} element={tasksGuard(<TaskListPage />)} />
        <Route path={PATHS.taskCalendar} element={tasksGuard(<TaskCalendarPage />)} />
        <Route path={PATHS.projects} element={tasksGuard(<ProjectsPage />)} />
        <Route path={PATHS.projectDetail} element={tasksGuard(<ProjectDetailPage />)} />
        <Route path={PATHS.departments} element={deptGuard(<DepartmentsPage />)} />
        <Route path={PATHS.orgChart} element={deptGuard(<OrgChartPage />)} />
        <Route path={PATHS.departmentDetail} element={deptGuard(<DepartmentDetailPage />)} />

        {/* Spec screens not built yet: a placeholder that explains what's coming. */}
        <Route path="*" element={<PlannedPage />} />
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

/**
 * Route-level guard (billing/gating.ts › routeDecision): modules outside the plan render the upgrade
 * page; roles without view access to the module go to the dashboard.
 */
export function RequirePermission({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const ctx = useGateContext()
  const decision = routeDecision({ module }, ctx)
  if (decision === 'loading') return <GateSkeleton />
  if (decision === 'upgrade') return <ModuleNotIncluded module={module} />
  if (decision === 'forbidden') return <Navigate to={PATHS.dashboard} replace />
  return <>{children}</>
}

/** Unbuilt screens: the "coming soon" placeholder, unless the plan doesn't include the module. */
function PlannedPage() {
  const { pathname } = useLocation()
  const ctx = useGateContext()
  const item = navMatch(pathname)?.item
  const decision = item ? routeDecision(item, ctx) : 'allow'
  if (decision === 'loading') return <GateSkeleton />
  if (item && decision === 'upgrade') return <ModuleNotIncluded module={itemPlanModule(item)!} />
  return <ComingSoonPage />
}
