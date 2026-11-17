/** Domain types shared by the store, the mock API and the pages. */

export type Role =
  | 'System Admin'
  | 'Management'
  | 'Sales Manager'
  | 'Sales Agent'
  | 'Marketing Manager'
  | 'Accountant'
  | 'HR Manager'
  | 'Department Head'
  | 'Employee'

export type ModuleKey = 'sales' | 'services' | 'marketing' | 'accounting' | 'hr' | 'reports' | 'settings' | 'departments'

export type Scope = 'full' | 'team' | 'own' | 'view' | 'hidden' | 'marketing' | 'finance' | 'hr'

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'export'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  title: string
  managerId: string | null
  /** UAE mobile, +971 5X XXX XXXX. */
  mobile: string
  departmentId: string
  /** Deactivated users can't sign in; they're never deleted so their history keeps its owner. */
  active: boolean
  twoFactorEnabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

/**
 * Lead status: the `key` of an item in the statuses lookup (Settings > Fixed lists).
 * Labels, order, probability and open/closed meaning come from `useLookups()`.
 */
export type LeadStatus = string

/** Source type: the `key` of an item in the sources lookup (Settings > Fixed lists). */
export type SourceType = string

/** Service catalog category: a key of the serviceCategories lookup (Settings > Fixed lists). */
export type ServiceCategory = string

export interface Lead {
  id: string
  company: string
  contactName: string
  contactEmail: string
  mobile: string
  industry: string
  subIndustry: string
  sourceType: SourceType
  /** Link or name, kept separate from the source type (e.g. the event or directory). */
  sourceDetail: string
  status: LeadStatus
  /** When the lead entered its current stage; drives "days in stage". */
  stageChangedAt: string
  ownerId: string
  /** Estimated deal value in AED. */
  value: number
  nextFollowUpDate: string | null
  createdAt: string
  doNotContact: boolean
  /** Required when moving to Interested or Meeting. */
  nextStep: string
  /** Required when moving to Lost or Not interested. */
  lossReason: string
  /** Set once a Won lead has been converted into a customer. */
  customerId: string | null
  /** What the company itself offers, as tags (instead of a long free-text field). */
  companyServices: string[]
  /** Catalog services of interest (service ids). */
  serviceIds: string[]
  /** Recommended catalog service (AI suggestion; the agent can change it). Never free text. */
  recommendedServiceId: string | null
  /**
   * Legacy free-text recommendation that couldn't be matched to a catalog item during migration.
   * Shown as "unmatched" until someone picks a catalog service (which clears it).
   */
  recommendedServiceText: string | null
  /** Automatic interest score, 0 to 100. */
  score: number
}

export interface Contact {
  id: string
  leadId: string
  name: string
  title: string
  mobile: string
  email: string
  isDecisionMaker: boolean
}

export type ActivityType = 'call' | 'email' | 'whatsapp' | 'visit' | 'meeting'

export interface Activity {
  id: string
  leadId: string
  type: ActivityType
  summary: string
  userId: string
  at: string
}

export interface Note {
  id: string
  leadId: string
  body: string
  authorId: string
  createdAt: string
}

export type TaskStatus = 'To do' | 'In progress' | 'Done'
export type Priority = 'Low' | 'Medium' | 'High'

export interface LeadTask {
  id: string
  leadId: string
  title: string
  ownerId: string
  dueDate: string
  status: TaskStatus
  priority: Priority
}

/** A won company (spec: CRM). Created from the Won lead, so nothing is retyped. */
export interface Customer {
  id: string
  name: string
  industry: string
  subIndustry: string
  /** The Won lead this customer came from; contacts, activities and notes hang off it. */
  leadId: string
  ownerId: string
  createdAt: string
  /** Full URL, e.g. https://example.ae; '' when unknown. */
  website: string
  /** Street / building / area; '' until someone fills it in. */
  address: string
  emirate: 'Dubai' | 'Abu Dhabi' | 'Sharjah' | 'Ajman' | 'Umm Al Quwain' | 'Ras Al Khaimah' | 'Fujairah' | ''
  status: 'Active' | 'Paused' | 'VIP'
  /** Deal value (AED) of the Won lead at conversion. */
  wonValue: number
  /** When the lead was won. */
  wonAt: string
  sourceType: SourceType
  /** Catalog services discussed during the sale. */
  serviceIds: string[]
  /** What the company itself offers (carried from the lead). */
  companyServices: string[]
}

export interface Session {
  token: string
  user: User
}

/** Dashboard period: last 30 days, last quarter (13 weeks), year to date, last 12 months. */
export type DashboardPeriod = '30d' | 'quarter' | 'ytd' | '12m'

/** One bucket of a dashboard series (a day, week or month depending on the period). */
export interface SeriesPoint {
  /** Axis label, e.g. "Mar" or "3 Nov". */
  label: string
  /** Bucket start, yyyy-MM-dd. */
  start: string
  created: number
  won: number
  /** AED won in the bucket. */
  wonValue: number
  activities: number
}

export interface TargetLine {
  key: 'leads' | 'calls' | 'emails' | 'visits' | 'meetings' | 'proposals' | 'partnerships' | 'events'
  label: string
  actual: number
  target: number
}

/**
 * Dashboard figures for a period, scoped to what the caller may see.
 * "Prev" values cover the equal-length period just before (for YTD: the same dates last year).
 * Pipeline, follow-up and target figures are "as of now" and don't depend on the period.
 */
export interface DashboardSummary {
  period: DashboardPeriod
  /** Human label, e.g. "Last 30 days". */
  periodLabel: string
  /** Period bounds, yyyy-MM-dd. */
  from: string
  to: string
  openPipelineValue: number
  openLeads: number
  weightedForecast: number
  wonValue: number
  wonValuePrev: number
  wonCount: number
  totalLeads: number
  newLeads: number
  newLeadsPrev: number
  /** Won ÷ (won + lost + not interested) closed within the period, %. */
  winRate: number
  closedCount: number
  followUpsDueToday: number
  followUpsOverdue: number
  activities: number
  activitiesPrev: number
  /** Buckets across the period, oldest first. */
  series: SeriesPoint[]
  /** This month's activity targets vs actuals (spec: Settings > Targets). */
  targets: TargetLine[]
}
