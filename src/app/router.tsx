import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ModuleKey, Scope } from '@/shared/types'
import { useAppSelector } from '@/store/hooks'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { ComingSoonPage } from '@/shared/components/layout/ComingSoonPage'
import { navMatch } from '@/shared/components/layout/navigation'
import { PATHS } from '@/app/paths'
import { ModuleNotIncluded } from '@/modules/tenancy/components/ModuleNotIncluded'
import { itemPlanModule, routeDecision } from '@/modules/billing/gating'
import { useGateContext } from '@/modules/billing/hooks'
import { GateSkeleton, ModuleGate } from '@/modules/billing/components/ModuleGate'

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
import { MARKETING_PATHS } from '@/modules/marketing/paths'
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
// Marketing (plan module `marketing`, Phase 2): loaded on first visit.
const CampaignsPage = lazy(() => import('@/modules/marketing/pages/CampaignsPage'))
const CampaignDetailPage = lazy(() => import('@/modules/marketing/pages/CampaignDetailPage'))
const BulkEmailsPage = lazy(() => import('@/modules/marketing/pages/BulkEmailsPage'))
const BulkEmailPage = lazy(() => import('@/modules/marketing/pages/BulkEmailPage'))
const AdsIntegrationsPage = lazy(() => import('@/modules/marketing/pages/AdsIntegrationsPage'))
const MarketingAnalyticsPage = lazy(() => import('@/modules/marketing/pages/MarketingAnalyticsPage'))
const ContentCalendarPage = lazy(() => import('@/modules/marketing/creative/pages/ContentCalendarPage'))
const DesignRequestsPage = lazy(() => import('@/modules/marketing/creative/pages/DesignRequestsPage'))
const BrandAssetsPage = lazy(() => import('@/modules/marketing/creative/pages/BrandAssetsPage'))
// Marketing › growth (lead generation, audiences, website & SEO). /f/:key and /p/:slug need no sign-in.
const LeadGenerationPage = lazy(() => import('@/modules/marketing/growth/pages/LeadGenerationPage'))
const CaptureFormPage = lazy(() => import('@/modules/marketing/growth/pages/LeadFormPage'))
const AudiencesPage = lazy(() => import('@/modules/marketing/growth/pages/AudiencesPage'))
const SeoPage = lazy(() => import('@/modules/marketing/growth/pages/SeoPage'))
const PublicFormPage = lazy(() => import('@/modules/marketing/growth/pages/PublicFormPage'))
const PublicLandingPage = lazy(() => import('@/modules/marketing/growth/pages/PublicLandingPage'))
// Events (plan module `events`, Phase 2): loaded on first visit. The public registration page needs no sign-in.
const EventsListPage = lazy(() => import('@/modules/events/pages/EventsListPage'))
const EventsCalendarPage = lazy(() => import('@/modules/events/pages/EventsCalendarPage'))
const EventDetailPage = lazy(() => import('@/modules/events/pages/EventDetailPage'))
const PublicRegistrationPage = lazy(() => import('@/modules/events/pages/PublicRegistrationPage'))
const EventTemplatesPage = lazy(() => import('@/modules/events/pages/EventTemplatesPage'))
const EventCheckInPage = lazy(() => import('@/modules/events/pages/EventCheckInPage'))
const EventBadgesPage = lazy(() => import('@/modules/events/pages/EventBadgesPage'))
const EventCapturePage = lazy(() => import('@/modules/events/pages/EventCapturePage'))
const AttendeesDirectoryPage = lazy(() => import('@/modules/events/pages/AttendeesDirectoryPage'))
const BoothLeadsPage = lazy(() => import('@/modules/events/pages/BoothLeadsPage'))
const EventAnalyticsPage = lazy(() => import('@/modules/events/pages/EventAnalyticsPage'))
const EventSponsorsPage = lazy(() => import('@/modules/events/pages/EventSponsorsPage'))
const EventLogisticsPage = lazy(() => import('@/modules/events/pages/EventLogisticsPage'))
const SpeakersPage = lazy(() => import('@/modules/events/pages/SpeakersPage'))
// HR › Employees, Employee contracts, Company assets.
const EmployeesPage = lazy(() => import('@/modules/hr/pages/EmployeesPage'))
const JourneysPage = lazy(() => import('@/modules/hr/journey/pages/JourneysPage'))
const JourneyDetailPage = lazy(() => import('@/modules/hr/journey/pages/JourneyDetailPage'))
const EmployeeDetailPage = lazy(() => import('@/modules/hr/pages/EmployeeDetailPage'))
const HrContractsPage = lazy(() => import('@/modules/hr/pages/ContractsPage'))
const HrAssetsPage = lazy(() => import('@/modules/hr/pages/AssetsPage'))
// HR › Recruitment, Training.
const RecruitmentPage = lazy(() => import('@/modules/hr/pages/RecruitmentPage'))
const TrainingPage = lazy(() => import('@/modules/hr/pages/TrainingPage'))
const PerformancePage = lazy(() => import('@/modules/hr/performance/PerformancePage'))
// HR › Attendance, Leave (self-service for every employee: plan-gated only, the API scopes the data).
const AttendancePage = lazy(() => import('@/modules/hr/time/pages/AttendancePage'))
const LeavePage = lazy(() => import('@/modules/hr/time/pages/LeavePage'))
// HR › Salary Management.
const SalaryPage = lazy(() => import('@/modules/hr/payroll/pages/SalaryPage'))
const PayslipPage = lazy(() => import('@/modules/hr/payroll/pages/PayslipPage'))
const HrReportsPage = lazy(() => import('@/modules/hr/reports/HrReportsPage'))
// HR › Self-service (My HR portal, own payslips, letters) and the HR inbox of employee requests.
const MyHrPage = lazy(() => import('@/modules/hr/selfservice/pages/MyHrPage'))
const MyPayslipPage = lazy(() => import('@/modules/hr/selfservice/pages/MyPayslipPage'))
const LetterPage = lazy(() => import('@/modules/hr/selfservice/pages/LetterPage'))
const HrRequestsPage = lazy(() => import('@/modules/hr/selfservice/pages/HrRequestsPage'))
const FinanceOverviewPage = lazy(() => import('@/modules/finance/ledger/pages/FinanceOverviewPage'))
const ChartOfAccountsPage = lazy(() => import('@/modules/finance/ledger/pages/ChartOfAccountsPage'))
const JournalPage = lazy(() => import('@/modules/finance/ledger/pages/JournalPage'))
const FinanceSettingsPage = lazy(() => import('@/modules/finance/ledger/pages/FinanceSettingsPage'))
const InvoicesPage = lazy(() => import('@/modules/finance/invoices/pages/InvoicesPage'))
const InvoiceDetailPage = lazy(() => import('@/modules/finance/invoices/pages/InvoiceDetailPage'))
const InvoiceEditorPage = lazy(() => import('@/modules/finance/invoices/pages/InvoiceEditorPage'))
// Accounts & finance › Collections: payments, PDC, payment links, receivables. /pay/:token needs no sign-in.
const PaymentsPage = lazy(() => import('@/modules/finance/collections/pages/PaymentsPage'))
const ReceiptPage = lazy(() => import('@/modules/finance/collections/pages/ReceiptPage'))
const ReceivablesPage = lazy(() => import('@/modules/finance/collections/pages/ReceivablesPage'))
const StatementPage = lazy(() => import('@/modules/finance/collections/pages/StatementPage'))
const PublicPayPage = lazy(() => import('@/modules/finance/collections/pages/PublicPayPage'))
const SpeakerDetailPage = lazy(() => import('@/modules/events/pages/SpeakerDetailPage'))
const VenuesPage = lazy(() => import('@/modules/events/pages/VenuesPage'))
const VenueDetailPage = lazy(() => import('@/modules/events/pages/VenueDetailPage'))
const VendorsPage = lazy(() => import('@/modules/events/pages/VendorsPage'))
const VendorDetailPage = lazy(() => import('@/modules/events/pages/VendorDetailPage'))
const PublicTicketPage = lazy(() => import('@/modules/events/pages/PublicTicketPage'))
const PublicSurveyPage = lazy(() => import('@/modules/events/pages/PublicSurveyPage'))

/** Every module's routes, behind the session guard and (per route) a permission guard. */
export function AppRouter() {
  const sales = (page: ReactNode) => <RequirePermission module="sales">{page}</RequirePermission>
  const servicesGuard = (page: ReactNode) => <RequirePermission module="services">{page}</RequirePermission>
  const deptGuard = (page: ReactNode) => <RequirePermission module="departments">{page}</RequirePermission>
  const tasksGuard = (page: ReactNode) => <RequirePermission module="tasks">{page}</RequirePermission>
  const hrPeopleGuard = (page: ReactNode) => (
    <RequirePermission module="hr">
      <Suspense fallback={<GateSkeleton />}>{page}</Suspense>
    </RequirePermission>
  )
  const marketing = (page: ReactNode) => (
    <RequirePermission module="marketing">
      <Suspense fallback={<GateSkeleton />}>{page}</Suspense>
    </RequirePermission>
  )
  // Events: plan-gated (upgrade page without the module); access inside follows the marketing column + event teams.
  const eventsGuard = (page: ReactNode) => (
    <ModuleGate module="events">
      <Suspense fallback={<GateSkeleton />}>{page}</Suspense>
    </ModuleGate>
  )
  return (
    <Routes>
      <Route path={PATHS.index} element={<IndexRedirect />} />
      <Route
        path={PATHS.publicSurvey}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicSurveyPage />
          </Suspense>
        }
      />
      <Route
        path={PATHS.publicTicket}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicTicketPage />
          </Suspense>
        }
      />
      <Route
        path={PATHS.publicEvent}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicRegistrationPage />
          </Suspense>
        }
      />
      <Route
        path={PATHS.publicPay}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicPayPage />
          </Suspense>
        }
      />
      <Route
        path={MARKETING_PATHS.publicForm}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicFormPage />
          </Suspense>
        }
      />
      <Route
        path={MARKETING_PATHS.publicLanding}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicLandingPage />
          </Suspense>
        }
      />
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

        <Route path={MARKETING_PATHS.campaigns} element={marketing(<CampaignsPage />)} />
        <Route path={MARKETING_PATHS.campaignDetail} element={marketing(<CampaignDetailPage />)} />
        <Route path={MARKETING_PATHS.emails} element={marketing(<BulkEmailsPage />)} />
        <Route path={MARKETING_PATHS.emailDetail} element={marketing(<BulkEmailPage />)} />
        <Route path={MARKETING_PATHS.leadGeneration} element={marketing(<LeadGenerationPage />)} />
        <Route path={MARKETING_PATHS.leadForm} element={marketing(<CaptureFormPage />)} />
        <Route path={MARKETING_PATHS.audiences} element={marketing(<AudiencesPage />)} />
        <Route path={MARKETING_PATHS.seo} element={marketing(<SeoPage />)} />
        <Route path={MARKETING_PATHS.content} element={marketing(<ContentCalendarPage />)} />
        <Route path={MARKETING_PATHS.assets} element={marketing(<BrandAssetsPage />)} />
        {/* Design requests: every user may ask for a design, so the route is plan-gated only (no Marketing role check). */}
        <Route
          path={MARKETING_PATHS.designRequests}
          element={
            <ModuleGate module="marketing">
              <Suspense fallback={<GateSkeleton />}>
                <DesignRequestsPage />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route path={MARKETING_PATHS.ads} element={marketing(<AdsIntegrationsPage />)} />
        <Route path={MARKETING_PATHS.analytics} element={marketing(<MarketingAnalyticsPage />)} />
        {/* The old Marketing reports page lives on in Marketing analytics (same access rule). */}
        <Route path={MARKETING_PATHS.reports} element={<Navigate to={MARKETING_PATHS.analytics} replace />} />

        <Route path={PATHS.events} element={eventsGuard(<EventsListPage />)} />
        <Route path={PATHS.eventCalendar} element={eventsGuard(<EventsCalendarPage />)} />
        <Route path={PATHS.eventTemplates} element={eventsGuard(<EventTemplatesPage />)} />
        <Route path={PATHS.eventAttendees} element={eventsGuard(<AttendeesDirectoryPage />)} />
        <Route path={PATHS.eventBoothLeads} element={eventsGuard(<BoothLeadsPage />)} />
        <Route path={PATHS.eventAnalytics} element={eventsGuard(<EventAnalyticsPage />)} />
        {/* Libraries: plan-gated only — reading is for marketing view/full AND event teams (the API decides; 403 → a notice). */}
        <Route path={PATHS.eventSpeakers} element={eventsGuard(<SpeakersPage />)} />
        <Route path={PATHS.eventSpeakerDetail} element={eventsGuard(<SpeakerDetailPage />)} />
        <Route path={PATHS.eventVenues} element={eventsGuard(<VenuesPage />)} />
        <Route path={PATHS.eventVenueDetail} element={eventsGuard(<VenueDetailPage />)} />
        <Route path={PATHS.eventVendors} element={eventsGuard(<VendorsPage />)} />
        <Route path={PATHS.eventVendorDetail} element={eventsGuard(<VendorDetailPage />)} />
        <Route path={PATHS.eventSponsors} element={eventsGuard(<EventSponsorsPage />)} />
        <Route path={PATHS.eventLogistics} element={eventsGuard(<EventLogisticsPage />)} />
        <Route path={PATHS.eventDetail} element={eventsGuard(<EventDetailPage />)} />
        <Route path={PATHS.eventCheckIn} element={eventsGuard(<EventCheckInPage />)} />
        <Route path={PATHS.eventBadges} element={eventsGuard(<EventBadgesPage />)} />
        <Route path={PATHS.eventCapture} element={eventsGuard(<EventCapturePage />)} />
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
        {/* HR › Employees, Employee contracts, Company assets: plan module + hr column (full / team / own). */}
        <Route path={PATHS.hrEmployees} element={hrPeopleGuard(<EmployeesPage />)} />
        <Route path={PATHS.hrEmployeeDetail} element={hrPeopleGuard(<EmployeeDetailPage />)} />
        {/* HR › Onboarding & offboarding: plan-gated only (My tasks is the assignee inbox of every role); the API scopes the rest. */}
        <Route path={PATHS.hrJourneys} element={<ModuleGate module="hr"><Suspense fallback={<GateSkeleton />}><JourneysPage /></Suspense></ModuleGate>} />
        <Route path={PATHS.hrJourneyDetail} element={hrPeopleGuard(<JourneyDetailPage />)} />
        <Route path={PATHS.hrContracts} element={hrPeopleGuard(<HrContractsPage />)} />
        <Route path={PATHS.hrAssets} element={hrPeopleGuard(<HrAssetsPage />)} />
        {/* HR › Salary Management: plan module + hr column (full runs payroll; team / own see their own payslips). */}
        <Route path={PATHS.hrSalary} element={hrPeopleGuard(<SalaryPage />)} />
        <Route path={PATHS.hrPayslip} element={hrPeopleGuard(<PayslipPage />)} />
        {/* HR › Attendance, Leave: every employee clocks in / requests leave for themselves (even with hr hidden), so plan-gated only. */}
        <Route
          path={PATHS.hrAttendance}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <AttendancePage />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path={PATHS.hrLeave}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <LeavePage />
              </Suspense>
            </ModuleGate>
          }
        />
        {/* HR › Recruitment, Training: plan module + hr column (full / team / own; the API scopes the data). */}
        <Route
          path={PATHS.hrRecruitment}
          element={
            <RequirePermission module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <RecruitmentPage />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path={PATHS.hrTraining}
          element={
            <RequirePermission module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <TrainingPage />
              </Suspense>
            </RequirePermission>
          }
        />
        {/* HR › Performance: every employee does their own self-review and sees their shared results (even with hr hidden), and direct managers review their reports, so plan-gated only; the API scopes the rows. */}
        <Route
          path={PATHS.hrPerformance}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <PerformancePage />
              </Suspense>
            </ModuleGate>
          }
        />

        {/* HR › Reports: plan module + hr column full / team (an employee's own scope has no reports). */}
        <Route
          path={PATHS.hrReports}
          element={
            <RequirePermission module="hr" scopes={['full', 'team']}>
              <Suspense fallback={<GateSkeleton />}>
                <HrReportsPage />
              </Suspense>
            </RequirePermission>
          }
        />

        {/* HR › My HR (portal, own payslips, letters): every employee, even with hr hidden, so plan-gated only (the API scopes the data). */}
        <Route
          path={PATHS.hrMe}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <MyHrPage />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path={PATHS.hrMyPayslip}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <MyPayslipPage />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path={PATHS.hrLetter}
          element={
            <ModuleGate module="hr">
              <Suspense fallback={<GateSkeleton />}>
                <LetterPage />
              </Suspense>
            </ModuleGate>
          }
        />
        {/* HR › Employee requests (profile changes, letters, templates, verify): HR full only. */}
        <Route
          path={PATHS.hrRequests}
          element={
            <RequirePermission module="hr" scopes={['full']}>
              <Suspense fallback={<GateSkeleton />}>
                <HrRequestsPage />
              </Suspense>
            </RequirePermission>
          }
        />

        {/* Accounts & finance › ledger core: plan module `accounting` + accounting column (full edits; Sales Manager views). */}
        {(
          [
            [PATHS.financeOverview, <FinanceOverviewPage key="o" />],
            [PATHS.financeAccounts, <ChartOfAccountsPage key="a" />],
            [PATHS.financeJournal, <JournalPage key="j" />],
            [PATHS.financeSettings, <FinanceSettingsPage key="s" />],
            // Accounts & finance › Invoices, credit notes, recurring (Sales Manager: view only; the editor answers "only finance" to view roles).
            [PATHS.financeInvoices, <InvoicesPage key="inv" />],
            [PATHS.financeInvoiceNew, <InvoiceEditorPage key="inv-new" />],
            [PATHS.financeInvoiceDetail, <InvoiceDetailPage key="inv-d" />],
            [PATHS.financeInvoiceEdit, <InvoiceEditorPage key="inv-e" />],
            // Accounts & finance › Collections (Sales Manager: view only; writes answer 403 and the buttons are hidden).
            [PATHS.financePayments, <PaymentsPage key="pay" />],
            [PATHS.financeReceipt, <ReceiptPage key="rct" />],
            [PATHS.financeReceivables, <ReceivablesPage key="rcv" />],
            [PATHS.financeStatement, <StatementPage key="stmt" />],
          ] as const
        ).map(([path, page]) => (
          <Route
            key={path}
            path={path}
            element={
              <RequirePermission module="accounting">
                <Suspense fallback={<GateSkeleton />}>{page}</Suspense>
              </RequirePermission>
            }
          />
        ))}

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
export function RequirePermission({ module, scopes, children }: { module: ModuleKey; scopes?: readonly Scope[]; children: ReactNode }) {
  const ctx = useGateContext()
  const decision = routeDecision({ module, scopes }, ctx)
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
