export const PATHS = {
  index: '/',
  login: '/login',
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
  departments: '/departments',
  orgChart: '/departments/org-chart',
  departmentDetail: '/departments/:id',
  services: '/services',
  serviceDetail: '/services/:id',
  servicePackages: '/services/packages',
  serviceTemplates: '/services/templates',
} as const

const enc = encodeURIComponent

export function leadPath(id: string): string {
  return `/leads/${enc(id)}`
}
export function leadEditPath(id: string): string {
  return `/leads/${enc(id)}/edit`
}
export function customerPath(id: string): string {
  return `/crm/customers/${enc(id)}`
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
