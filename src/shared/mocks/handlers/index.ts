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
import { financePurchasesHandlers } from './financePurchases'
import { financeExpensesHandlers } from './financeExpenses'
import { financeBankingHandlers } from './financeBanking'
import { financeCommissionsHandlers } from './financeCommissions'
import { financeStatementsHandlers } from './financeStatements'
import { financeProfitabilityHandlers } from './financeProfitability'
import { financeTaxHandlers, financeBudgetsHandlers } from './financeTax'
import { reportsPerformanceHandlers } from './reportsPerformance'

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
  // Reports › Company performance and Reports hub (/reports/performance, /reports/hub/*).
  ...reportsPerformanceHandlers,
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
  // Accounts & finance › Purchases & payables: suppliers, purchase orders, bills, debit notes, bill payments, payables, approval rules (/finance/suppliers/*, /finance/purchase-orders/*, /finance/bills/*, /finance/debit-notes, /finance/bill-payments/*, /finance/payment-runs, /finance/payables/*, /finance/purchases/meta, /finance/event-costs, /finance/approval-rules).
  ...financePurchasesHandlers,
  // Accounts & finance › Expenses, expense claims, petty cash (/finance/expenses/*, /finance/expense-categories/*, /finance/expense-policy, /finance/expense-claims/*, /finance/petty-cash/*).
  ...financeExpensesHandlers,
  // Accounts & finance › Banking (bank accounts, transfers, statements, reconciliation, rules) and payroll posting (/finance/bank-*, /finance/payroll-postings/*).
  ...financeBankingHandlers,
  // Accounts & finance › Sales commissions (/finance/commission-plans/*, /finance/commission-statements/*, /finance/commissions/mine).
  ...financeCommissionsHandlers,
  // Accounts & finance › Financial statements and year-end close (/finance/statements/*, /finance/year-end/*).
  ...financeStatementsHandlers,
  // Accounts & finance › Profitability: projects, events, customers, department P&L (/finance/profitability/*).
  ...financeProfitabilityHandlers,
  // Accounts & finance › Tax (VAT returns, corporate tax / zakat) and planning (budgets, cash-flow forecast) (/finance/tax/*, /finance/vat-returns/*, /finance/budgets/*, /finance/forecast/*).
  ...financeTaxHandlers,
  ...financeBudgetsHandlers,
  ...billingHandlers,
  // Last: it ends with a catch-all for unknown /platform/* paths.
  ...platformHandlers,
]
