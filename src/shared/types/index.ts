/** Domain types shared by the store, the mock API and the pages. */

export type Role =
  | 'Company Admin'
  | 'Management'
  | 'Sales Manager'
  | 'Sales Agent'
  | 'Marketing Manager'
  | 'Accountant'
  | 'HR Manager'
  | 'Department Head'
  | 'Employee'

export type ModuleKey = 'sales' | 'services' | 'marketing' | 'accounting' | 'hr' | 'reports' | 'settings' | 'departments' | 'tasks'

export type Scope = 'full' | 'team' | 'own' | 'view' | 'hidden' | 'marketing' | 'finance' | 'hr'

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'export'

export interface User {
  id: string
  /** Company (tenant) of the user's active membership. Set by the server; the client never sends it. */
  companyId: string
  name: string
  email: string
  role: Role
  title: string
  managerId: string | null
  /** Mobile in the company country's format (see shared/lib/phone.ts). */
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
  /** leads.won_at: when the Won flow converted the lead (null / absent until then). */
  wonAt?: string | null
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
  /** leads.event_id: the event the lead registered at (Events module; source "Event"). */
  eventId?: string | null
  /** leads.campaign_id: the marketing campaign the lead came from (cost per lead); null = none. */
  campaignId?: string | null
}

export interface Contact {
  id: string
  leadId: string
  /** contacts.customer_id: set when the lead is won (the contact keeps leadId; nothing is copied). */
  customerId?: string | null
  name: string
  title: string
  mobile: string
  email: string
  isDecisionMaker: boolean
}

/** `system` = logged by the app itself (e.g. the Won flow); never picked by users. */
export type ActivityType = 'call' | 'email' | 'whatsapp' | 'visit' | 'meeting' | 'system'

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
  /** customers.status: active | paused | vip | churned (labels in shared/domain/enums.ts). */
  status: import('@/shared/domain/enums').CustomerStatus
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
  /** Access token (Authorization: Bearer). */
  token: string
  /** Long-lived token for POST /auth/refresh (absent for support sessions: they can't be extended). */
  refreshToken?: string
  /** ISO time the access token expires; the client refreshes a minute before (app/authSession.ts). */
  expiresAt?: string
  user: User
  /** The tenant the session belongs to (resolved by the server from the user's membership). */
  tenant: import('@/modules/tenancy/types').Company
  /** Set while a platform operator is impersonating this user. */
  impersonation?: import('@/modules/tenancy/types').ImpersonationInfo | null
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
  /** Task figures from the shared task selectors (as of today, regardless of the period). */
  tasks: {
    /** Open tasks I own or follow (myTasks). */
    myOpenTasks: number
    /** My open tasks past their due date. */
    myOverdueTasks: number
    /** My open tasks due from today to the end of this week (dueThisWeek). */
    dueThisWeek: number
    /** Overdue tasks in my tasks scope (overdueTasks): mine for own scope, the team's or everyone's otherwise. */
    teamOverdueTasks: number
    /** Tasks scope of the viewer, so the client can label the team figure. */
    scope: 'full' | 'team' | 'own' | 'hidden'
    /** My next open tasks (overdue first, then by due date; undated last), at most 5. */
    next: {
      id: string
      title: string
      /** yyyy-MM-dd or null. */
      dueDate: string | null
      priority: import('@/modules/tasks/enums').TaskPriority
      status: import('@/modules/tasks/enums').TaskStatus
      /** tasks.blocked_at is set. */
      blocked?: boolean
      overdue: boolean
      /** Linked record (project / lead / customer / event) label, if any. */
      linkLabel: string | null
      ownerName: string
    }[]
  }
}
