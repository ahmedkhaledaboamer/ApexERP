export const PATHS = {
  index: '/',
  login: '/login',
  /** Public sign-up (product level, no workspace). */
  signup: '/signup',
  /** Sign-in page of one workspace (its public branding), e.g. /w/crest. */
  workspaceLogin: '/w/:subdomain',
  workspaceLoginAlt: '/w/:subdomain/login',
  legalTerms: '/legal/terms',
  legalPrivacy: '/legal/privacy',
  dashboard: '/dashboard',
  followUps: '/follow-ups',
  account: '/account',
  leads: '/leads',
  leadNew: '/leads/new',
  leadImport: '/leads/import',
  pipeline: '/leads/pipeline',
  leadDetail: '/leads/:id',
  leadEdit: '/leads/:id/edit',
  customers: '/crm/customers',
  customerDetail: '/crm/customers/:id',
  contacts: '/crm/contacts',
  contracts: '/crm/contracts',
  quotations: '/sales/quotations',
  quotationNew: '/sales/quotations/new',
  quotationDetail: '/sales/quotations/:id',
  salesTargets: '/sales/targets',
  salesReports: '/sales/reports',
  myTasks: '/tasks/my',
  taskBoard: '/tasks/board',
  taskList: '/tasks/list',
  taskCalendar: '/tasks/calendar',
  projects: '/projects',
  projectDetail: '/projects/:id',
  departments: '/departments',
  orgChart: '/departments/org-chart',
  departmentDetail: '/departments/:id',
  services: '/services',
  serviceDetail: '/services/:id',
  servicePackages: '/services/packages',
  serviceTemplates: '/services/templates',
  /** Events module (plan module `events`). */
  events: '/events',
  eventCalendar: '/events/calendar',
  eventDetail: '/events/:id',
  eventTemplates: '/events/templates',
  /** Cross-event sections: attendees directory, booth leads, event analytics. */
  eventAttendees: '/events/attendees',
  eventBoothLeads: '/events/booth-leads',
  eventAnalytics: '/events/analytics',
  /** Cross-event libraries: speakers directory, venues, vendors. */
  eventSpeakers: '/events/speakers',
  eventSpeakerDetail: '/events/speakers/:id',
  eventVenues: '/events/venues',
  eventVenueDetail: '/events/venues/:id',
  eventVendors: '/events/vendors',
  eventVendorDetail: '/events/vendors/:id',
  /** Cross-event: sponsors & exhibitors (organized events), travel & logistics. */
  eventSponsors: '/events/sponsors',
  eventLogistics: '/events/logistics',
  eventCheckIn: '/events/:id/check-in',
  eventCapture: '/events/:id/capture',
  eventBadges: '/events/:id/badges',
  /** Public registration page of an event (no sign-in, no workspace). */
  publicEvent: '/e/:token',
  /** Public ticket (QR) of an attendee, by its ticket code. */
  publicTicket: '/t/:code',
  /** Public feedback survey of an attendee, by its survey token. */
  publicSurvey: '/s/:token',
  /** HR › Recruitment and Training (plan module `hr`). */
  hrRecruitment: '/hr/recruitment',
  hrTraining: '/hr/training',
  /** HR › Performance reviews (every employee: own reviews; managers; HR: cycles, templates). ?tab=, ?review=, ?cycle=. */
  hrPerformance: '/hr/performance',
  /** HR › Engagement surveys / eNPS (every employee answers: ?answer=; HR full and Department Heads: results ?tab=, ?survey=). */
  hrEngagement: '/hr/engagement',
  /** HR › 360° feedback (every employee: requests to answer, nominations; managers / HR: rounds). ?tab=, ?invitation=, ?round=. */
  hrFeedback: '/hr/feedback',
  /** HR › Employees (+ profile), Employee contracts, Company assets. */
  hrEmployees: '/hr/employees',
  hrEmployeeDetail: '/hr/employees/:id',
  /** HR › Onboarding & offboarding (?tab=journeys|mine|templates; My tasks for every role). */
  hrJourneys: '/hr/journeys',
  hrJourneyDetail: '/hr/journeys/:id',
  hrContracts: '/hr/contracts',
  hrAssets: '/hr/assets',
  /** HR › Attendance and Leave (self-service for every employee; ?tab=, ?request=). */
  hrAttendance: '/hr/attendance',
  hrLeave: '/hr/leave',
  /** HR › Salary Management (HR full: runs, payslips, loans, settlements; others: My payslips). ?tab=, ?run=, ?payslip=. */
  hrSalary: '/hr/salary',
  hrPayslip: '/hr/salary/payslips/:id',
  /** HR › Reports (HR full and Department Heads; ?tab=). */
  hrReports: '/hr/reports',
  /** HR › My HR: the self-service portal of every employee (any role with an employee record; plan-gated only). */
  hrMe: '/hr/me',
  hrMyPayslip: '/hr/me/payslips/:id',
  /** A printable HR letter (the employee's own, or any for HR full). */
  hrLetter: '/hr/letters/:id',
  /** HR › Employee requests (HR full): profile changes, letter requests, letter templates, verify (?tab=). */
  hrRequests: '/hr/requests',
  /** HR › Discipline (HR full + Department Head team, read-only): warnings and disciplinary actions (?record=). */
  hrDiscipline: '/hr/discipline',
  /** A printable warning letter of a record (HR full or the employee; ?language=en|ar|bilingual&digits=). */
  hrWarningLetter: '/hr/discipline/:id/letter',
  /** HR › Policies (HR full + Department Head team numbers) and a policy's acknowledgement dashboard. */
  hrPolicies: '/hr/policies',
  hrPolicyDetail: '/hr/policies/:id',
  /** My HR › My policies (every employee: read and acknowledge; ?policy=). */
  hrMyPolicies: '/hr/me/policies',
  /** Accounts & finance › ledger core (plan module `accounting`; accounting full edits, view reads). ?account=, ?entry=, ?new=1, ?tab=trial-balance. */
  financeOverview: '/finance',
  financeAccounts: '/finance/accounts',
  financeJournal: '/finance/journal',
  financeSettings: '/finance/settings',
  /** Accounts & finance › Invoices (?tab=invoices|credit-notes|recurring, ?status=, ?from=quotation|contract|won&id=, ?credit_note=). */
  financeInvoices: '/finance/invoices',
  financeInvoiceNew: '/finance/invoices/new',
  financeInvoiceDetail: '/finance/invoices/:id',
  financeInvoiceEdit: '/finance/invoices/:id/edit',
  /** Accounts & finance › Payments (?tab=payments|pdc|links, ?payment=, ?pdc=, ?record=1&customer=&invoice=) and a printable receipt. */
  financePayments: '/finance/payments',
  financeReceipt: '/finance/payments/:id/receipt',
  /** Accounts & finance › Receivables (?tab=aging|statements|credit|reminders, ?customer=) and a printable statement (?from=&to=). */
  financeReceivables: '/finance/receivables',
  financeStatement: '/finance/receivables/statements/:id',
  /** Accounts & finance › Purchases & payables: suppliers (+ printable statement ?from=&to=), purchase orders (?view=mine|awaiting, ?status=; any employee requests), bills (?tab=bills|payments|debit-notes|payables, ?status=, ?pay=1), bill editor (?po=), payment voucher. */
  financeSuppliers: '/finance/suppliers',
  financeSupplierStatement: '/finance/suppliers/:id/statement',
  financePurchaseOrders: '/finance/purchase-orders',
  financePurchaseOrderNew: '/finance/purchase-orders/new',
  financePurchaseOrderDetail: '/finance/purchase-orders/:id',
  financePurchaseOrderEdit: '/finance/purchase-orders/:id/edit',
  financePurchaseOrderPrint: '/finance/purchase-orders/:id/print',
  financeBills: '/finance/bills',
  financeBillNew: '/finance/bills/new',
  financeBillDetail: '/finance/bills/:id',
  financeBillEdit: '/finance/bills/:id/edit',
  financeBillVoucher: '/finance/bill-payments/:id/voucher',
  /** Accounts & finance › the caller's approvals inbox (POs, bills, expense claims awaiting them; plan gate only — department heads without accounting access too). */
  financeApprovals: '/finance/approvals',
  /** Accounts & finance › Expenses (?tab=expenses|claims|petty|policy, ?expense=, ?claim=, ?fund=, ?new=1; claims: every employee). */
  financeExpenses: '/finance/expenses',
  /** Accounts & finance › Banking (?tab=accounts|transfers|reconcile|rules|payroll, ?account=). */
  financeBanking: '/finance/banking',
  /** Accounts & finance › Sales commissions (?tab=statements|plans, ?statement=, ?month=). */
  financeCommissions: '/finance/commissions',
  /** Accounts & finance › Financial statements (?tab=pnl|balance-sheet|cash-flow|general-ledger|trial-balance|year-end; accounting full / view). */
  financeStatements: '/finance/statements',
  /** Accounts & finance › Tax (?tab=vat|estimate, ?return=, ?box=; accounting full / view) and a printable VAT return. */
  financeTax: '/finance/tax',
  financeVatReturnPrint: '/finance/tax/vat-returns/:id/print',
  /** Accounts & finance › Budgets & forecast (?tab=budgets|vs-actual|forecast, ?budget=, ?department=, ?month=; plan gate only — department heads see their own department, the API scopes it). */
  financePlanning: '/finance/planning',
  /** Accounts & finance › Profitability (?tab=projects|events|customers|departments|settings, ?period=, ?from=&to=, ?dept=; accounting full / view) and one project (?from=&to=). */
  financeProfitability: '/finance/profitability',
  financeProfitabilityProject: '/finance/profitability/projects/:id',
  /** Insights & admin › Reports hub (every report by area, favourites, recently viewed) and Company performance (?period=, ?from=&to=). */
  reportsHub: '/reports',
  companyPerformance: '/reports/performance',
  /** A rep's own commission statements (any sales role; accounting not needed). */
  myCommissions: '/sales/my-commissions',
  /** Public payment page of a payment link (no sign-in, no workspace). */
  publicPay: '/pay/:token',
  /** Public verification of an HR letter (no sign-in; the QR code on the letter; ?code=&workspace= in development). */
  publicLetterVerify: '/verify/letter',
  /** Platform console: outside any workspace (TenantProvider exempts /platform). */
  platform: '/platform',
  platformLogin: '/platform/login',
  /** Insights & admin › Integrations (plan module `integrations`, settings column). `?tab=sync-log|email-log`, `?open=<key>`. */
  integrations: '/integrations',
  /** Insights & admin › AI assistant (plan module `ai`, every role; `?c=<conversation id>`). */
  aiAssistant: '/ai',
} as const

const enc = encodeURIComponent

export function workspaceLoginPath(subdomain: string): string {
  return `/w/${enc(subdomain)}`
}

export function leadPath(id: string): string {
  return `/leads/${enc(id)}`
}
export function leadEditPath(id: string): string {
  return `/leads/${enc(id)}/edit`
}
export function customerPath(id: string): string {
  return `/crm/customers/${enc(id)}`
}
export function projectPath(id: string): string {
  return `/projects/${enc(id)}`
}
export function departmentPath(id: string): string {
  return `/departments/${enc(id)}`
}
export function servicePath(id: string): string {
  return `/services/${enc(id)}`
}
export function quotationPath(id: string): string {
  return `/sales/quotations/${enc(id)}`
}
/** New quotation, optionally prefilled for a lead or customer. */
export function newQuotationPath(opts: { leadId?: string; customerId?: string } = {}): string {
  const q = new URLSearchParams()
  if (opts.leadId) q.set('leadId', opts.leadId)
  if (opts.customerId) q.set('customerId', opts.customerId)
  const s = q.toString()
  return s ? `/sales/quotations/new?${s}` : '/sales/quotations/new'
}
export function eventPath(id: string, tab?: string): string {
  return tab ? `/events/${enc(id)}?tab=${enc(tab)}` : `/events/${enc(id)}`
}
/** An employee profile, optionally on a tab (overview, documents, contract, assets, activity). */
export function letterPath(id: string): string {
  return `/hr/letters/${enc(id)}`
}
export function myPayslipPath(id: string): string {
  return `/hr/me/payslips/${enc(id)}`
}
export function payslipPath(id: string): string {
  return `/hr/salary/payslips/${enc(id)}`
}
export function employeePath(id: string, tab?: string): string {
  return tab ? `/hr/employees/${enc(id)}?tab=${enc(tab)}` : `/hr/employees/${enc(id)}`
}
export function speakerPath(id: string): string {
  return `/events/speakers/${enc(id)}`
}
export function venuePath(id: string): string {
  return `/events/venues/${enc(id)}`
}
export function vendorPath(id: string): string {
  return `/events/vendors/${enc(id)}`
}
/** The public registration page of an event (its registration token). */
export function publicEventPath(token: string): string {
  return `/e/${enc(token)}`
}
export function eventCheckInPath(id: string): string {
  return `/events/${enc(id)}/check-in`
}
export function eventCapturePath(id: string): string {
  return `/events/${enc(id)}/capture`
}
export function eventBadgesPath(id: string): string {
  return `/events/${enc(id)}/badges`
}
export function publicTicketPath(code: string): string {
  return `/t/${enc(code)}`
}
export function publicSurveyPath(token: string): string {
  return `/s/${enc(token)}`
}

/** Accounts & finance › Purchases & payables links. */
export const financePurchaseOrderPath = (id: string): string => `/finance/purchase-orders/${enc(id)}`
export const financeBillPath = (id: string): string => `/finance/bills/${enc(id)}`
export const financeBillVoucherPath = (id: string): string => `/finance/bill-payments/${enc(id)}/voucher`
export function financeSupplierStatementPath(vendorId: string, from?: string, to?: string): string {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const s = q.toString()
  return `/finance/suppliers/${enc(vendorId)}/statement${s ? `?${s}` : ''}`
}
/** An invoice (Accounts & finance › Invoices). */
/** A payment's printable receipt (Accounts & finance › Payments). */
export function financeReceiptPath(id: string): string {
  return `/finance/payments/${enc(id)}/receipt`
}
/** A customer's printable statement of account. */
export function financeStatementPath(customerId: string, from?: string, to?: string): string {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const s = q.toString()
  return `/finance/receivables/statements/${enc(customerId)}${s ? `?${s}` : ''}`
}
export function financeInvoicePath(id: string): string {
  return `/finance/invoices/${enc(id)}`
}
/** A VAT return's printable page (Accounts & finance › Tax). */
export function financeVatReturnPrintPath(id: string): string {
  return `/finance/tax/vat-returns/${enc(id)}/print`
}
/** One project's profitability (Accounts & finance › Profitability), optionally for a period. */
export function financeProfitabilityProjectPath(id: string, from?: string, to?: string): string {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const s = q.toString()
  return `/finance/profitability/projects/${enc(id)}${s ? `?${s}` : ''}`
}
/** "Invoice this" from a quotation, contract or won deal (opens the prefilled source dialog on the invoices page). */
export function invoiceFromSourcePath(kind: 'quotation' | 'contract' | 'won', id: string): string {
  return `/finance/invoices?from=${kind}&id=${enc(id)}`
}
