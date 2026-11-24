import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
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
import { MARKETING_PATHS } from '@/modules/marketing/paths'
import { SETTINGS_PATHS, SettingsLayout } from '@/modules/settings/components/SettingsLayout'

/*
 * Every routed page is lazy (its own chunk, loaded on first visit), so the entry chunk holds only the
 * shell: providers, AppLayout, guards. Pages without their own <Suspense> are caught by <LazyOutlet>
 * (a pathless layout route) — inside the app shell with the page skeleton, so the nav stays put.
 */
const LoginPage = lazy(() => import('@/modules/auth/pages/LoginPage'))
const DashboardPage = lazy(() => import('@/modules/dashboard/pages/DashboardPage'))
const LeadsListPage = lazy(() => import('@/modules/leads/pages/LeadsListPage'))
const LeadsPipelinePage = lazy(() => import('@/modules/leads/pages/LeadsPipelinePage'))
const LeadDetailPage = lazy(() => import('@/modules/leads/pages/LeadDetailPage'))
const LeadFormPage = lazy(() => import('@/modules/leads/pages/LeadFormPage'))
const LeadImportPage = lazy(() => import('@/modules/leads/import/LeadImportPage'))
const FollowUpsPage = lazy(() => import('@/modules/leads/followups/FollowUpsPage'))
const SalesTargetsPage = lazy(() => import('@/modules/targets/pages/SalesTargetsPage'))
const CustomersPage = lazy(() => import('@/modules/crm/pages/CustomersPage'))
const CustomerProfilePage = lazy(() => import('@/modules/crm/pages/CustomerProfilePage'))
const ContactsPage = lazy(() => import('@/modules/crm/pages/ContactsPage'))
const ContractsPage = lazy(() => import('@/modules/crm/pages/ContractsPage'))
const QuotationsPage = lazy(() => import('@/modules/quotations/pages/QuotationsPage'))
const QuotationEditorPage = lazy(() => import('@/modules/quotations/pages/QuotationEditorPage'))
const SalesReportsPage = lazy(() => import('@/modules/reports/pages/SalesReportsPage'))
const MyAccountPage = lazy(() => import('@/modules/account/pages/MyAccountPage'))
const MyTasksPage = lazy(() => import('@/modules/tasks/pages/MyTasksPage'))
const TaskBoardPage = lazy(() => import('@/modules/tasks/pages/TaskBoardPage'))
const TaskListPage = lazy(() => import('@/modules/tasks/pages/TaskListPage'))
const TaskCalendarPage = lazy(() => import('@/modules/tasks/pages/TaskCalendarPage'))
const ProjectsPage = lazy(() => import('@/modules/tasks/pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('@/modules/tasks/pages/ProjectDetailPage'))
const DepartmentsPage = lazy(() => import('@/modules/departments/pages/DepartmentsPage'))
const OrgChartPage = lazy(() => import('@/modules/departments/pages/OrgChartPage'))
const DepartmentDetailPage = lazy(() => import('@/modules/departments/pages/DepartmentDetailPage'))
const ServiceCatalogPage = lazy(() => import('@/modules/services/pages/ServiceCatalogPage'))
const ServiceDetailPage = lazy(() => import('@/modules/services/pages/ServiceDetailPage'))
const PackagesPage = lazy(() => import('@/modules/services/pages/PackagesPage'))
const ProjectTemplatesPage = lazy(() => import('@/modules/services/pages/ProjectTemplatesPage'))
const UsersPage = lazy(() => import('@/modules/settings/pages/UsersPage'))
const CompanyProfilePage = lazy(() => import('@/modules/settings/pages/CompanyProfilePage'))
const BrandingPage = lazy(() => import('@/modules/settings/pages/BrandingPage'))
const SignupPage = lazy(() => import('@/modules/auth/pages/SignupPage'))
const WorkspaceLoginPage = lazy(() => import('@/modules/auth/pages/WorkspaceLoginPage'))
const LegalPage = lazy(() => import('@/modules/signup/pages/LegalPage'))
const BillingPage = lazy(() => import('@/modules/settings/pages/BillingPage'))
const ListsPage = lazy(() => import('@/modules/settings/pages/ListsPage'))
const TemplatesPage = lazy(() => import('@/modules/settings/pages/TemplatesPage'))
const TargetsSettingsPage = lazy(() => import('@/modules/settings/pages/TargetsSettingsPage'))
const AutomationPage = lazy(() => import('@/modules/settings/pages/AutomationPage'))
const SecurityPage = lazy(() => import('@/modules/settings/pages/SecurityPage'))
const AuditLogPage = lazy(() => import('@/modules/settings/pages/AuditLogPage'))

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
// HR › Engagement surveys (eNPS) and 360° feedback (answering is self-service: plan-gated only, the API scopes the data).
const EngagementPage = lazy(() => import('@/modules/hr/engagement/EngagementPage'))
const FeedbackPage = lazy(() => import('@/modules/hr/engagement/FeedbackPage'))
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
// HR › Discipline, Policies (+ My policies, warning letters) and the public letter verification page (no sign-in).
const DisciplinePage = lazy(() => import('@/modules/hr/compliance/pages/DisciplinePage'))
const WarningLetterPage = lazy(() => import('@/modules/hr/compliance/pages/WarningLetterPage'))
const PoliciesPage = lazy(() => import('@/modules/hr/compliance/pages/PoliciesPage'))
const PolicyDetailPage = lazy(() => import('@/modules/hr/compliance/pages/PolicyDetailPage'))
const MyPoliciesPage = lazy(() => import('@/modules/hr/compliance/pages/MyPoliciesPage'))
const PublicLetterVerifyPage = lazy(() => import('@/modules/hr/selfservice/pages/PublicLetterVerifyPage'))
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
// Accounts & finance › Purchases & payables: suppliers, purchase orders (every employee), bills, payment vouchers.
const SuppliersPage = lazy(() => import('@/modules/finance/purchases/pages/SuppliersPage'))
const SupplierStatementPage = lazy(() => import('@/modules/finance/purchases/pages/SupplierStatementPage'))
const PurchaseOrdersPage = lazy(() => import('@/modules/finance/purchases/pages/PurchaseOrdersPage'))
const PurchaseOrderEditorPage = lazy(() => import('@/modules/finance/purchases/pages/PurchaseOrderEditorPage'))
const PurchaseOrderDetailPage = lazy(() => import('@/modules/finance/purchases/pages/PurchaseOrderDetailPage'))
const PurchaseOrderPrintPage = lazy(() => import('@/modules/finance/purchases/pages/PurchaseOrderPrintPage'))
const BillsPage = lazy(() => import('@/modules/finance/purchases/pages/BillsPage'))
const BillEditorPage = lazy(() => import('@/modules/finance/purchases/pages/BillEditorPage'))
const BillDetailPage = lazy(() => import('@/modules/finance/purchases/pages/BillDetailPage'))
const PaymentVoucherPage = lazy(() => import('@/modules/finance/purchases/pages/PaymentVoucherPage'))
const ApprovalsInboxPage = lazy(() => import('@/modules/finance/purchases/pages/ApprovalsInboxPage'))
// Accounts & finance › Expenses: company expenses, employee expense claims (every employee), petty cash, categories & policy.
const ExpensesPage = lazy(() => import('@/modules/finance/expenses/pages/ExpensesPage'))
// Accounts & finance › Banking (accounts, transfers, reconciliation, payroll postings) and Sales commissions; "My commissions" for reps.
const BankingPage = lazy(() => import('@/modules/finance/banking/pages/BankingPage'))
const CommissionsPage = lazy(() => import('@/modules/finance/commissions/pages/CommissionsPage'))
const MyCommissionsPage = lazy(() => import('@/modules/finance/commissions/pages/MyCommissionsPage'))
// Accounts & finance › Financial statements (P&L, balance sheet, cash flow, general ledger, trial balance, year-end close).
const FinancialStatementsPage = lazy(() => import('@/modules/finance/statements/pages/FinancialStatementsPage'))
// Accounts & finance › Profitability; Insights & admin › Reports hub and Company performance.
const ProfitabilityPage = lazy(() => import('@/modules/finance/profitability/pages/ProfitabilityPage'))
const ProjectProfitabilityPage = lazy(() => import('@/modules/finance/profitability/pages/ProjectProfitabilityPage'))
// Accounts & finance › Tax (VAT returns, corporate tax / zakat) and Budgets & forecast.
const TaxPage = lazy(() => import('@/modules/finance/tax/pages/TaxPage'))
const VatReturnPrintPage = lazy(() => import('@/modules/finance/tax/pages/VatReturnPrintPage'))
const PlanningPage = lazy(() => import('@/modules/finance/planning/pages/PlanningPage'))
const ReportsHubPage = lazy(() => import('@/modules/reports/hub/ReportsHubPage'))
const CompanyPerformancePage = lazy(() => import('@/modules/reports/performance/PerformancePage'))
const SpeakerDetailPage = lazy(() => import('@/modules/events/pages/SpeakerDetailPage'))
const VenuesPage = lazy(() => import('@/modules/events/pages/VenuesPage'))
const VenueDetailPage = lazy(() => import('@/modules/events/pages/VenueDetailPage'))
const VendorsPage = lazy(() => import('@/modules/events/pages/VendorsPage'))
const VendorDetailPage = lazy(() => import('@/modules/events/pages/VendorDetailPage'))
const PublicTicketPage = lazy(() => import('@/modules/events/pages/PublicTicketPage'))
const PublicSurveyPage = lazy(() => import('@/modules/events/pages/PublicSurveyPage'))
// Insights & admin › Integrations (plan module `integrations`; settings column: Company Admin configures, Management views).
const IntegrationsPage = lazy(() => import('@/modules/integrations/pages/IntegrationsPage'))
// Insights & admin › AI assistant (plan module `ai`; every role, the API scopes what each user sees).
const AiAssistantPage = lazy(() => import('@/modules/ai-agent/pages/AiAssistantPage'))

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
        path={PATHS.publicLetterVerify}
        element={
          <Suspense fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>}>
            <PublicLetterVerifyPage />
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
      <Route element={<LazyOutlet fallback={<div className="grid h-full place-items-center text-[0.8125rem] text-muted">Loading…</div>} />}>
        <Route path={PATHS.login} element={<LoginPage />} />
        <Route path={PATHS.signup} element={<SignupPage />} />
        <Route path={PATHS.workspaceLogin} element={<WorkspaceLoginPage />} />
        <Route path={PATHS.workspaceLoginAlt} element={<WorkspaceLoginPage />} />
        <Route path={PATHS.legalTerms} element={<LegalPage kind="terms" />} />
        <Route path={PATHS.legalPrivacy} element={<LegalPage kind="privacy" />} />
      </Route>
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
        <Route element={<LazyOutlet />}>
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
          {/* A rep's own commission statements: sales access + the accounting plan module (no accounting role needed). */}
          <Route
            path={PATHS.myCommissions}
            element={sales(
              <ModuleGate module="accounting">
                <Suspense fallback={<GateSkeleton />}>
                  <MyCommissionsPage />
                </Suspense>
              </ModuleGate>,
            )}
          />

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
          {/* Insights & admin › Reports hub and Company performance: reports column (sections inside follow each role's scopes). */}
          <Route
            path={PATHS.reportsHub}
            element={
              <RequirePermission module="reports">
                <Suspense fallback={<GateSkeleton />}>
                  <ReportsHubPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path={PATHS.companyPerformance}
            element={
              <RequirePermission module="reports">
                <Suspense fallback={<GateSkeleton />}>
                  <CompanyPerformancePage />
                </Suspense>
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
            {/* Its own boundary, so loading a settings page keeps the settings nav on screen. */}
            <Route element={<LazyOutlet />}>
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
          {/* HR › Engagement and 360° feedback: every employee answers surveys and gives feedback (even with hr hidden), so plan-gated only; the API scopes results (HR full, Department Heads). */}
          <Route
            path={PATHS.hrEngagement}
            element={
              <ModuleGate module="hr">
                <Suspense fallback={<GateSkeleton />}>
                  <EngagementPage />
                </Suspense>
              </ModuleGate>
            }
          />
          <Route
            path={PATHS.hrFeedback}
            element={
              <ModuleGate module="hr">
                <Suspense fallback={<GateSkeleton />}>
                  <FeedbackPage />
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
          {/* HR › Discipline and Policies: HR full writes, Department Heads read their team (the API scopes the rows). */}
          <Route path={PATHS.hrDiscipline} element={<RequirePermission module="hr" scopes={['full', 'team']}><Suspense fallback={<GateSkeleton />}><DisciplinePage /></Suspense></RequirePermission>} />
          <Route path={PATHS.hrPolicies} element={<RequirePermission module="hr" scopes={['full', 'team']}><Suspense fallback={<GateSkeleton />}><PoliciesPage /></Suspense></RequirePermission>} />
          <Route path={PATHS.hrPolicyDetail} element={<RequirePermission module="hr" scopes={['full', 'team']}><Suspense fallback={<GateSkeleton />}><PolicyDetailPage /></Suspense></RequirePermission>} />
          {/* The employee's own warning letter and policies: every employee, even with hr hidden, so plan-gated only (the API scopes them). */}
          <Route path={PATHS.hrWarningLetter} element={<ModuleGate module="hr"><Suspense fallback={<GateSkeleton />}><WarningLetterPage /></Suspense></ModuleGate>} />
          <Route path={PATHS.hrMyPolicies} element={<ModuleGate module="hr"><Suspense fallback={<GateSkeleton />}><MyPoliciesPage /></Suspense></ModuleGate>} />

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
              // Accounts & finance › Purchases & payables (Sales Manager: view only).
              [PATHS.financeSuppliers, <SuppliersPage key="sup" />],
              [PATHS.financeSupplierStatement, <SupplierStatementPage key="sup-st" />],
              [PATHS.financeBills, <BillsPage key="bills" />],
              [PATHS.financeBillNew, <BillEditorPage key="bill-new" />],
              [PATHS.financeBillEdit, <BillEditorPage key="bill-e" />],
              [PATHS.financeBillVoucher, <PaymentVoucherPage key="pv" />],
              // Accounts & finance › Banking and Commissions (Sales Manager: view; approves commission step 1).
              [PATHS.financeBanking, <BankingPage key="bank" />],
              [PATHS.financeCommissions, <CommissionsPage key="com" />],
              // Accounts & finance › Financial statements (Sales Manager: view; closing a year: Company Admin / Accountant).
              [PATHS.financeStatements, <FinancialStatementsPage key="fst" />],
              // Accounts & finance › Profitability (Sales Manager: view, without the labour allocation).
              [PATHS.financeProfitability, <ProfitabilityPage key="prf" />],
              [PATHS.financeProfitabilityProject, <ProjectProfitabilityPage key="prf-p" />],
              // Accounts & finance › Tax: VAT returns, corporate tax / zakat (Sales Manager: view).
              [PATHS.financeTax, <TaxPage key="tax" />],
              [PATHS.financeVatReturnPrint, <VatReturnPrintPage key="tax-p" />],
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

          {/* Accounts & finance › Budgets & forecast: plan-gated only — department heads read their own department's budget vs actual without accounting access (the API scopes the rest). */}
          <Route
            path={PATHS.financePlanning}
            element={
              <ModuleGate module="accounting">
                <Suspense fallback={<GateSkeleton />}>
                  <PlanningPage />
                </Suspense>
              </ModuleGate>
            }
          />

          {/* Accounts & finance › Expenses: plan-gated only — every employee files claims; company expenses need accounting (the API scopes the rest). */}
          <Route
            path={PATHS.financeExpenses}
            element={
              <ModuleGate module="accounting">
                <Suspense fallback={<GateSkeleton />}>
                  <ExpensesPage />
                </Suspense>
              </ModuleGate>
            }
          />

          {/* Accounts & finance › Purchase orders (self-service: every employee requests for their own department) and bill detail (approvers without accounting access): plan gate only — the API scopes what each user sees. */}
          {(
            [
              [PATHS.financePurchaseOrders, <PurchaseOrdersPage key="po" />],
              [PATHS.financePurchaseOrderNew, <PurchaseOrderEditorPage key="po-new" />],
              [PATHS.financePurchaseOrderDetail, <PurchaseOrderDetailPage key="po-d" />],
              [PATHS.financePurchaseOrderEdit, <PurchaseOrderEditorPage key="po-e" />],
              [PATHS.financePurchaseOrderPrint, <PurchaseOrderPrintPage key="po-p" />],
              [PATHS.financeBillDetail, <BillDetailPage key="bill-d" />],
              // The caller's approvals inbox (department heads reach it from My HR / the user menu without accounting access).
              [PATHS.financeApprovals, <ApprovalsInboxPage key="appr" />],
            ] as const
          ).map(([path, page]) => (
            <Route
              key={path}
              path={path}
              element={
                <ModuleGate module="accounting">
                  <Suspense fallback={<GateSkeleton />}>{page}</Suspense>
                </ModuleGate>
              }
            />
          ))}

          {/* Insights & admin › Integrations: plan module `integrations` (upgrade page without it) + settings view. Per-user calendar sync lives on Tasks › Calendar for every role. */}
          <Route
            path={PATHS.integrations}
            element={
              <ModuleGate module="integrations">
                <RequirePermission module="settings">
                  <Suspense fallback={<GateSkeleton />}>
                    <IntegrationsPage />
                  </Suspense>
                </RequirePermission>
              </ModuleGate>
            }
          />

          {/* Insights & admin › AI assistant: plan module `ai` (upgrade page without it); every role — tools only use what the role can see. */}
          <Route
            path={PATHS.aiAssistant}
            element={
              <ModuleGate module="ai">
                <Suspense fallback={<GateSkeleton />}>
                  <AiAssistantPage />
                </Suspense>
              </ModuleGate>
            }
          />

          {/* Spec screens not built yet: a placeholder that explains what's coming. */}
          <Route path="*" element={<PlannedPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

/** Pathless layout route: a Suspense boundary for the lazy pages below it (default: the in-shell page skeleton). */
function LazyOutlet({ fallback = <GateSkeleton /> }: { fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Outlet />
    </Suspense>
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
