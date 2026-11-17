/**
 * Services module API shapes (spec: Services — the catalog quotations are built from).
 * `category` and `industries` hold lookup keys (Settings > Fixed lists).
 */

export type PricingType = 'Fixed' | 'Monthly' | 'Hourly'
export const PRICING_TYPES: PricingType[] = ['Fixed', 'Monthly', 'Hourly']

/** A catalog service. Deactivated, never deleted, so old quotations keep their data. */
export interface Service {
  id: string
  name: string
  /** serviceCategories lookup key. */
  category: string
  description: string
  /** industries lookup keys this service suits (AI suggestions, filtering). */
  industries: string[]
  pricingType: PricingType
  price: number
  /** ISO currency; AED by default. */
  currency: string
  /** Typical delivery time in working days (0 for recurring services). */
  deliveryDays: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ServiceInput = Omit<Service, 'id' | 'active' | 'createdAt' | 'updatedAt'> & { active?: boolean }
export type ServiceUpdateInput = Partial<ServiceInput>

/** How much a service is used across the app. */
export interface ServiceUsage {
  /** Leads whose recommended service is this one. */
  leadsRecommending: number
  /** Leads that list it among services of interest. */
  leadsInterested: number
  /** Quotations with at least one line for it. */
  quotations: number
  /** Customers with a (non-cancelled) contract that includes it. */
  customers: number
}

export interface ServiceRow extends Service {
  usage: ServiceUsage
  /** Number of tasks in its project template (0 = none). */
  templateTasks: number
  templateHours: number
  /** Packages that include it. */
  packageCount: number
}

/** Delivery role a template task is assigned to by default. */
export type DeliveryRole =
  | 'Project manager'
  | 'Solutions consultant'
  | 'Developer'
  | 'AI engineer'
  | 'Data analyst'
  | 'Designer'
  | 'QA'
  | 'Trainer'

export const DELIVERY_ROLES: DeliveryRole[] = [
  'Project manager',
  'Solutions consultant',
  'Developer',
  'AI engineer',
  'Data analyst',
  'Designer',
  'QA',
  'Trainer',
]

export interface TemplateTask {
  id: string
  title: string
  role: DeliveryRole
  /** Working-day offset from project start when the task begins. */
  dayOffset: number
  /** Estimated effort in hours. */
  hours: number
}

/** Ready-made delivery tasks for a service; a won deal creates its project from this (next step). */
export interface ProjectTemplate {
  serviceId: string
  /** In delivery order. */
  tasks: TemplateTask[]
  updatedAt: string | null
  updatedBy: string | null
}

export interface ProjectTemplateInput {
  /** Full ordered list; new tasks have no id. */
  tasks: (Omit<TemplateTask, 'id'> & { id?: string })[]
}

export interface ServiceDetail extends ServiceRow {
  template: ProjectTemplate
  packages: { id: string; name: string; active: boolean }[]
  /** Leads recommending it (most recent first, up to 10). */
  recommendingLeads: { id: string; company: string; status: string; ownerName: string }[]
  /** Quotations containing it (most recent first, up to 10). */
  recentQuotations: { id: string; number: string; company: string; status: string; total: number; createdAt: string }[]
  /** Customers who bought it. */
  customers: { id: string; name: string }[]
}

export interface PackageItem {
  serviceId: string
  quantity: number
}

/** A bundle of services sold at a package price. */
export interface ServicePackage {
  id: string
  name: string
  description: string
  items: PackageItem[]
  packagePrice: number
  currency: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PackageRow extends ServicePackage {
  /** Σ service price × quantity at today's catalog prices. */
  listPrice: number
  /** listPrice − packagePrice (≥ 0 when the package is a discount). */
  saving: number
  savingPct: number
  /** Item details for display. */
  lines: { serviceId: string; name: string; category: string; pricingType: PricingType; price: number; quantity: number; active: boolean }[]
}

export type PackageInput = Omit<ServicePackage, 'id' | 'active' | 'createdAt' | 'updatedAt'> & { active?: boolean }
export type PackageUpdateInput = Partial<PackageInput>

/** Template totals: hours, and duration = latest (dayOffset + task length in days at 8h/day). */
export function templateTotals(tasks: Pick<TemplateTask, 'dayOffset' | 'hours'>[]): { hours: number; days: number } {
  const hours = tasks.reduce((s, t) => s + (Number(t.hours) || 0), 0)
  const days = tasks.reduce((m, t) => Math.max(m, (Number(t.dayOffset) || 0) + Math.max(1, Math.ceil((Number(t.hours) || 0) / 8))), 0)
  return { hours, days }
}
