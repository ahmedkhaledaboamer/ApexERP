import { accountHandlers } from './account'
import { alertsHandlers } from './alerts'
import { authHandlers } from './auth'
import { billingHandlers } from './billing'
import { brandingHandlers } from './branding'
import { platformHandlers } from './platform'
import { companyProfileHandlers } from './companyProfile'
import { crmHandlers } from './crm'
import { dashboardHandlers } from './dashboard'
import { departmentHandlers } from './departments'
import { wonHandlers } from './won'
import { tasksHandlers } from './tasks'
import { projectsHandlers } from './projects'
import { leadImportHandlers } from './leadImport'
import { leadHandlers } from './leads'
import { marketingHandlers } from './marketing'
import { marketingGrowthHandlers } from './marketingGrowth'
import { adsHandlers } from './ads'
import { marketingCreativeHandlers } from './marketingCreative'
import { eventsHandlers } from './events'
import { eventsAdvancedHandlers } from './eventsAdvanced'
import { eventSectionsHandlers } from './eventSections'
import { eventSponsorsLogisticsHandlers } from './eventSponsorsLogistics'
import { eventLibraryHandlers } from './eventLibrary'
import { messagesHandlers } from './messages'
import { quotationsHandlers } from './quotations'
import { reportsHandlers } from './reports'
import { securityHandlers } from './security'
import { serviceHandlers } from './services'
import { settingsHandlers } from './settings'
import { settingsUsersHandlers } from './settingsUsers'
import { targetsHandlers } from './targets'
import { templatesHandlers } from './templates'
import { hrTalentHandlers } from './hrTalent'
import { hrPeopleHandlers } from './hrPeople'
import { hrTimeHandlers } from './hrTime'
import { hrPayrollHandlers } from './hrPayroll'
import { hrReportsHandlers } from './hrReports'
import { hrSelfServiceHandlers } from './hrSelfService'
import { hrJourneyHandlers } from './hrJourney'
import { hrPerformanceHandlers } from './hrPerformance'
import { financeLedgerHandlers } from './financeLedger'
import { financeInvoicesHandlers } from './financeInvoices'
import { financeCollectionsHandlers } from './financeCollections'

/**
 * Every mocked endpoint. Each module adds its handlers here.
 * leadImport comes before leads so `/leads/import...` isn't read as `/leads/:id`.
 * The dev billing simulation (/dev/billing/*) is registered in development only.
 */
export const handlers = [
  ...authHandlers,
  ...companyProfileHandlers,
  ...brandingHandlers,
  ...settingsHandlers,
  ...settingsUsersHandlers,
  ...securityHandlers,
  ...accountHandlers,
  ...templatesHandlers,
  ...wonHandlers,
  ...leadImportHandlers,
  ...leadHandlers,
  ...messagesHandlers,
  ...dashboardHandlers,
  ...departmentHandlers,
  ...tasksHandlers,
  ...projectsHandlers,
  ...alertsHandlers,
  ...serviceHandlers,
  ...targetsHandlers,
  ...crmHandlers,
  ...quotationsHandlers,
  ...reportsHandlers,
  ...marketingHandlers,
  ...marketingGrowthHandlers,
  ...adsHandlers,
  ...marketingCreativeHandlers,
  // Cross-event sections first: `/events/attendees`, `/events/booth-leads`, `/events/analytics` aren't `/events/:id`.
  ...eventSectionsHandlers,
  // Sponsors & exhibitors, Travel & logistics: `/events/sponsors`, `/events/logistics` aren't `/events/:id` either.
  ...eventSponsorsLogisticsHandlers,
  // Speakers directory, venues, vendors: `/event-speakers`, `/event-venues`, `/event-vendors`.
  ...eventLibraryHandlers,
  ...eventsAdvancedHandlers,
  ...eventsHandlers,
  // HR › Recruitment, Training (/hr/recruitment/*, /hr/training/*).
  ...hrTalentHandlers,
  // HR › Employees, Employee contracts, Company assets (/hr/employees, /hr/documents, /hr/contracts, /hr/assets).
  ...hrPeopleHandlers,
  // HR › Attendance, Leave, Public holidays (/hr/attendance/*, /hr/leave/*, /hr/holidays).
  ...hrTimeHandlers,
  // HR › Salary Management (/hr/payroll/*).
  ...hrPayrollHandlers,
  // HR › Reports (/hr/reports/*).
  ...hrReportsHandlers,
  // HR › Self-service portal, profile changes, HR letters (/hr/me, /hr/profile-changes, /hr/letters/*, /hr/self-service/*).
  ...hrSelfServiceHandlers,
  // HR › Onboarding & offboarding (/hr/journeys/*).
  ...hrJourneyHandlers,
  // HR › Performance reviews (/hr/performance/*).
  ...hrPerformanceHandlers,
  // Accounts & finance › ledger core and setup (/finance/settings, /finance/accounts, /finance/journal, /finance/reports/*, /finance/overview).
  ...financeLedgerHandlers,
  // Accounts & finance › Invoices, credit notes, recurring invoices, ZATCA (/finance/invoices/*, /finance/credit-notes/*, /finance/recurring-invoices/*).
  ...financeInvoicesHandlers,
  // Accounts & finance › Collections: payments, PDC, payment links, receivables, dunning (/finance/payments/*, /finance/pdcs/*, /finance/payment-links/*, /finance/receivables/*, /finance/customers/*, /public/pay/:token).
  ...financeCollectionsHandlers,
  ...billingHandlers,
  // Last: it ends with a catch-all for unknown /platform/* paths.
  ...platformHandlers,
]
