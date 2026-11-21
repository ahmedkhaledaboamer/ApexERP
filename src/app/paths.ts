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
  /** Platform console: outside any workspace (TenantProvider exempts /platform). */
  platform: '/platform',
  platformLogin: '/platform/login',
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
